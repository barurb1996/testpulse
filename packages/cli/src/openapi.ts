import { readFile } from 'fs/promises'
import yaml from 'js-yaml'

const VERBS = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options', 'trace']

export interface OpenApiTarget {
  verb: string
  path: string
  operationId?: string
  summary?: string
  domain?: string
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
  const parsed = (filePath.endsWith('.json') ? JSON.parse(raw) : yaml.load(raw)) as {
    paths?: Record<string, Record<string, { operationId?: string; summary?: string; tags?: string[] }>>
  }

  const targets: OpenApiTarget[] = []
  const paths = parsed.paths ?? {}

  for (const [rawPath, methods] of Object.entries(paths)) {
    const normalisedPath = normalisePath(rawPath)
    for (const [verb, op] of Object.entries(methods)) {
      if (!VERBS.includes(verb.toLowerCase())) continue
      const tagDomain = op.tags && op.tags.length > 0 ? op.tags[0] : undefined
      targets.push({
        verb: verb.toUpperCase(),
        path: normalisedPath,
        operationId: op.operationId,
        summary: op.summary,
        domain: tagDomain ?? domainFromPath(normalisedPath)
      })
    }
  }

  return targets
}
