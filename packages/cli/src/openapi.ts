import { readFile } from 'fs/promises'
import yaml from 'js-yaml'

const VERBS = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options', 'trace']

export interface OpenApiTarget {
  verb: string
  path: string
  operationId?: string
  summary?: string
  domain?: string
  /** Operation requires authentication (op-level `security` overrides global; `[]` = public). */
  secured?: boolean
  /** Declared response status codes, e.g. ['200','401','403']. */
  responseCodes?: string[]
  /** Path contains an object identifier parameter (BOLA/IDOR surface). */
  hasObjectId?: boolean
  /** Request inputs with validation constraints (required/format/maxLength/enum/min/max/pattern). */
  constrainedInputs?: string[]
}

type Json = Record<string, any>

function deref(root: Json, node: Json | undefined, depth = 0): Json | undefined {
  if (!node || depth > 6) return node
  if (typeof node.$ref === 'string' && node.$ref.startsWith('#/')) {
    let cur: any = root
    for (const part of node.$ref.slice(2).split('/')) cur = cur?.[part.replace(/~1/g, '/').replace(/~0/g, '~')]
    return deref(root, cur, depth + 1)
  }
  return node
}

const CONSTRAINT_KEYS = ['format', 'maxLength', 'minLength', 'enum', 'minimum', 'maximum', 'pattern', 'maxItems', 'minItems']

function schemaConstraints(root: Json, schema: Json | undefined, name: string, out: string[], depth = 0): void {
  const sc = deref(root, schema)
  if (!sc || depth > 4) return
  if (CONSTRAINT_KEYS.some(k => sc[k] !== undefined)) out.push(name)
  if (sc.properties) {
    const required = new Set<string>(sc.required ?? [])
    for (const [prop, child] of Object.entries<Json>(sc.properties)) {
      const before = out.length
      schemaConstraints(root, child, `${name}.${prop}`, out, depth + 1)
      if (out.length === before && required.has(prop)) out.push(`${name}.${prop}`)
    }
  }
  if (sc.items) schemaConstraints(root, sc.items, `${name}[]`, out, depth + 1)
}

function constrainedInputsOf(root: Json, pathItem: Json, op: Json): string[] {
  const out: string[] = []
  const params = [...(pathItem.parameters ?? []), ...(op.parameters ?? [])]
  for (const raw of params) {
    const param = deref(root, raw)
    if (!param) continue
    // path params are always required by definition, so `required` only signals a constraint for other locations
    const before = out.length
    schemaConstraints(root, param.schema, `${param.in}:${param.name}`, out)
    if (out.length === before && param.required && param.in !== 'path') out.push(`${param.in}:${param.name}`)
  }
  const body = deref(root, op.requestBody)
  const content = body?.content as Json | undefined
  if (content) {
    const media = content['application/json'] ?? Object.values(content)[0]
    schemaConstraints(root, media?.schema, 'body', out)
    if (body?.required && out.every(o => !o.startsWith('body'))) out.push('body')
  }
  return [...new Set(out)]
}

function domainFromPath(p: string): string | undefined {
  const segs = p.split('/').filter(Boolean)
  for (const seg of segs) {
    if (seg.startsWith('{') || /^v\d+$/.test(seg) || seg === 'api') continue
    return seg
  }
  return undefined
}

function normalisePath(p: string): string {
  let out = p.replace(/\{[^}]+\}/g, ':id').replace(/\?.*$/, '').replace(/\/+/g, '/')
  if (!out.startsWith('/')) out = '/' + out
  return out
}

export async function parseOpenApiFile(filePath: string): Promise<OpenApiTarget[]> {
  const raw = await readFile(filePath, 'utf-8')
  const parsed = (filePath.endsWith('.json') ? JSON.parse(raw) : yaml.load(raw)) as Json

  const targets: OpenApiTarget[] = []
  const paths = parsed.paths ?? {}

  for (const [rawPath, methods] of Object.entries(paths)) {
    const normalisedPath = normalisePath(rawPath)
    for (const [verb, opRaw] of Object.entries<Json>(methods as Record<string, Json>)) {
      if (!VERBS.includes(verb.toLowerCase())) continue
      const op = opRaw ?? {}
      const globalSecurity = Array.isArray(parsed.security) && parsed.security.length > 0
      const secured = Array.isArray(op.security) ? op.security.length > 0 && !op.security.every((r: Json) => Object.keys(r).length === 0) : globalSecurity
      const tagDomain = op.tags && op.tags.length > 0 ? op.tags[0] : undefined
      targets.push({
        verb: verb.toUpperCase(),
        path: normalisedPath,
        operationId: op.operationId,
        summary: op.summary,
        domain: tagDomain ?? domainFromPath(normalisedPath),
        secured,
        responseCodes: Object.keys(op.responses ?? {}),
        hasObjectId: /\{[^}]*(id|uuid|key|ref|number)[^}]*\}/i.test(rawPath),
        constrainedInputs: constrainedInputsOf(parsed, methods as Json, op)
      })
    }
  }

  return targets
}
