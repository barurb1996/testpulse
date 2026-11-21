import { readFile } from 'fs/promises'
import path from 'path'
import { isHelperNamespace } from '../helper-names.js'
import { classifyCall, type TestKind } from '../security/classify.js'
import { parseFeature, type KarateScenario, type KarateFeature } from './karate.js'

export const ASSERTION_TOKENS = /\b(match|status|assert|responseStatus)\b|\bretry\s+until\b/
const CLASSPATH_CALL = /call\s+(?:read\s*\(\s*)?['"]classpath:([^'"]+?)['"]/g
const HELPER_ASSIGNMENT = /^\*\s*(?:set|def)\s+([\w.]+)\s*=\s*read\s*\(\s*['"]classpath:([^'"]+?)['"]\s*\)/
const HELPER_ALIAS = /^\*\s*def\s+([\w$]+)\s*=\s*([\w.$]+)\s*$/
const HELPER_CALL = /\bcall\s+([a-zA-Z_$][\w.$]*)(?=\s|\{|$)/g

const PATH_STEP = /^(?:path|url)\s+(.+)$/i
const METHOD_STEP = /^method\s+(get|post|put|delete|patch|head|options)\b/i

export interface DuplicateRef {
  file: string
  line: number
  name: string
}

export interface EndpointOverlap {
  verb: string
  endpoint: string
  others: DuplicateRef[]
}

export interface EndpointUsage {
  verb: string
  endpoint: string
  file: string
  line: number
  scenarioName: string
  via: 'direct' | 'helper'
  kinds: TestKind[]
  status: number | null
}

export interface KarateProjectContext {
  isFeatureAsserting: (absolutePath: string) => boolean
  resolveClasspath: (callerPath: string, ref: string) => string | null
  resolveHelperCall: (callerPath: string, identifier: string) => string | null
  extractClasspathCalls: (scenario: KarateScenario) => string[]
  extractHelperCalls: (scenario: KarateScenario) => string[]
  findDuplicatesFor: (filePath: string, line: number) => DuplicateRef[]
  findDataVariationsFor: (filePath: string, line: number) => DuplicateRef[]
  findEndpointOverlapsFor: (filePath: string, line: number) => EndpointOverlap[]
  collectAllEndpoints: () => EndpointUsage[]
}

function scenarioAsserts(scenario: KarateScenario): boolean {
  if (scenario.steps.some(s => s.keyword === 'Then')) return true
  if (scenario.steps.some(s => ASSERTION_TOKENS.test(s.text))) return true
  return false
}

function findClasspathRoot(featurePath: string): string | null {
  const parts = featurePath.split(path.sep)
  for (let i = parts.length - 1; i >= 2; i--) {
    if (parts[i - 2] === 'src' && parts[i - 1] === 'test' && (parts[i] === 'java' || parts[i] === 'resources')) {
      return parts.slice(0, i + 1).join(path.sep)
    }
  }
  return null
}

function canonicalRhs(rhs: string): string {
  const parts = rhs.split('.')
  return isHelperNamespace(parts[0]) && parts.length > 1 ? parts.slice(1).join('.') : rhs
}

function normaliseExact(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase()
}

function normaliseForDataVariation(text: string): string {
  return normaliseExact(text)
    .replace(/'[^']*'/g, '%STR%')
    .replace(/"[^"]*"/g, '%STR%')
    .replace(/#\([^)]*\)/g, '%VAR%')
    .replace(/\b\d+(?:\.\d+)?\b/g, '%NUM%')
}

function scenarioSignature(scenario: KarateScenario, normaliser: (s: string) => string): string {
  return scenario.steps.map(s => normaliser(s.text)).join('|')
}

/** Split `a, b, c` on commas that are not inside quotes or brackets. */
function splitTopLevelArgs(raw: string): string[] {
  const out: string[] = []
  let depth = 0, quote: string | null = null, cur = ''
  for (const ch of raw) {
    if (quote) { cur += ch; if (ch === quote) quote = null; continue }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue }
    if ('([{'.includes(ch)) depth++
    if (')]}'.includes(ch)) depth--
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue }
    cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

function normalisePathLiteral(raw: string): string {
  let s = raw.trim()
  // Karate multi-argument form: path 'tickets', ticketId, 'comments'  ->  /tickets/:id/comments
  const args = splitTopLevelArgs(s)
  if (args.length > 1) {
    s = args
      .map(a => {
        const lit = /^(['"])(.*)\1$/.exec(a)
        return lit ? lit[2].replace(/^\/+|\/+$/g, '') : ':id'
      })
      .join('/')
  }
  s = s.replace(/['"]\s*\+\s*[\w.$()[\]]+\s*\+\s*['"]/g, ':var')
  s = s.replace(/['"]\s*\+\s*[\w.$()[\]]+/g, ':var')
  s = s.replace(/[\w.$()[\]]+\s*\+\s*['"]/g, ':var')
  s = s.replace(/[\w.$()[\]]+\s*\+\s*:var/g, ':var')
  s = s.replace(/:var\s*\+\s*[\w.$()[\]]+/g, ':var')
  s = s.replace(/['"]/g, '')
  s = s.replace(/\?.*$/, '')
  s = s.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, ':uuid')
  s = s.replace(/\b\d+\b/g, ':id')
  s = s.replace(/\s+/g, '').replace(/\/+/g, '/').replace(/,+$/, '')
  if (!s || s.includes('+')) return ''
  if (!s.startsWith('/') && !s.startsWith('http')) s = '/' + s
  return s
}

type EndpointTuple = { verb: string; endpoint: string; line: number; kinds: TestKind[]; status: number | null }

function extractEndpoints(scenario: KarateScenario): EndpointTuple[] {
  const tuples: EndpointTuple[] = []
  let rollingPath: string | null = null
  for (let idx = 0; idx < scenario.steps.length; idx++) {
    const step = scenario.steps[idx]
    const pathMatch = PATH_STEP.exec(step.text)
    if (pathMatch) {
      rollingPath = normalisePathLiteral(pathMatch[1])
      continue
    }
    const methodMatch = METHOD_STEP.exec(step.text)
    if (methodMatch && rollingPath) {
      let boundary = scenario.steps.length
      for (let j = idx + 1; j < scenario.steps.length; j++) {
        if (METHOD_STEP.test(scenario.steps[j].text) || PATH_STEP.test(scenario.steps[j].text)) { boundary = j; break }
      }
      const { kinds, status } = classifyCall({ scenarioName: scenario.name, steps: scenario.steps, methodIndex: idx, nextBoundaryIndex: boundary })
      tuples.push({ verb: methodMatch[1].toUpperCase(), endpoint: rollingPath, line: step.line, kinds, status })
    }
  }
  return tuples.filter(t => t.endpoint && !t.endpoint.includes(' '))
}

interface ScenarioRecord {
  file: string
  line: number
  name: string
  tags: string[]
  exactSig: string
  dataSig: string
  endpoints: EndpointTuple[]
  classpathRefs: string[]
  helperRefs: string[]
}

export async function buildKarateContext(featurePaths: string[]): Promise<KarateProjectContext> {
  const featuresByPath = new Map<string, { asserts: boolean; classpathRoot: string | null }>()
  const helperMap = new Map<string, string>()
  const aliasesByFile = new Map<string, Map<string, string>>()
  const classpathRoots = new Set<string>()

  const records: ScenarioRecord[] = []

  for (const fp of featurePaths) {
    try {
      const source = await readFile(fp, 'utf-8')
      const feature = parseFeature(source)
      const anyAsserts = feature.scenarios.some(scenarioAsserts)
      const root = findClasspathRoot(fp)
      featuresByPath.set(fp, { asserts: anyAsserts, classpathRoot: root })
      if (root) classpathRoots.add(root)

      const fileAliases = new Map<string, string>()
      for (const line of source.split(/\r?\n/)) {
        const trimmed = line.trim()
        const m = HELPER_ASSIGNMENT.exec(trimmed)
        if (m && root) {
          helperMap.set(m[1], path.resolve(root, m[2]))
          continue
        }
        const alias = HELPER_ALIAS.exec(trimmed)
        if (alias) fileAliases.set(alias[1], canonicalRhs(alias[2]))
      }
      if (fileAliases.size > 0) aliasesByFile.set(fp, fileAliases)

      for (const scenario of feature.scenarios) {
        if (scenario.steps.length < 2) continue

        const classpathRefs: string[] = []
        const helperRefs: string[] = []
        for (const step of scenario.steps) {
          const cpRe = /call\s+(?:read\s*\(\s*)?['"]classpath:([^'"]+?)['"]/g
          let m: RegExpExecArray | null
          while ((m = cpRe.exec(step.text)) !== null) classpathRefs.push(m[1])

          if (!/call\s+read\s*\(/.test(step.text)) {
            const helpRe = /\bcall\s+([a-zA-Z_$][\w.$]*)(?=\s|\{|$)/g
            while ((m = helpRe.exec(step.text)) !== null) {
              if (m[1].includes('.')) helperRefs.push(m[1])
            }
          }
        }

        records.push({
          file: fp,
          line: scenario.line,
          name: scenario.name,
          tags: scenario.tags,
          exactSig: scenarioSignature(scenario, normaliseExact),
          dataSig: scenarioSignature(scenario, normaliseForDataVariation),
          endpoints: extractEndpoints(scenario),
          classpathRefs,
          helperRefs
        })
      }
    } catch {
      featuresByPath.set(fp, { asserts: false, classpathRoot: null })
    }
  }

  const exactGroups = new Map<string, ScenarioRecord[]>()
  const dataGroups = new Map<string, ScenarioRecord[]>()
  for (const rec of records) {
    const exactBucket = exactGroups.get(rec.exactSig) ?? []
    exactBucket.push(rec)
    exactGroups.set(rec.exactSig, exactBucket)

    const dataBucket = dataGroups.get(rec.dataSig) ?? []
    dataBucket.push(rec)
    dataGroups.set(rec.dataSig, dataBucket)
  }

  type EndpointKey = string
  const endpointGroups = new Map<EndpointKey, ScenarioRecord[]>()
  for (const rec of records) {
    const keysSeen = new Set<EndpointKey>()
    for (const ep of rec.endpoints) {
      const key = `${ep.verb} ${ep.endpoint}`
      if (keysSeen.has(key)) continue
      keysSeen.add(key)
      const bucket = endpointGroups.get(key) ?? []
      bucket.push(rec)
      endpointGroups.set(key, bucket)
    }
  }

  const recordByKey = new Map<string, ScenarioRecord>()
  for (const rec of records) recordByKey.set(`${rec.file}#${rec.line}`, rec)

  const toRef = (r: ScenarioRecord): DuplicateRef => ({ file: r.file, line: r.line, name: r.name })

  const exactSigByKey = new Map<string, string>()
  for (const rec of records) exactSigByKey.set(`${rec.file}#${rec.line}`, rec.exactSig)

  const rootsList = Array.from(classpathRoots)

  const resolveClasspath = (callerPath: string, ref: string): string | null => {
    const info = featuresByPath.get(callerPath)
    const ordered: string[] = []
    if (info?.classpathRoot) ordered.push(info.classpathRoot)
    for (const r of rootsList) if (!ordered.includes(r)) ordered.push(r)
    for (const root of ordered) {
      const candidate = path.resolve(root, ref)
      if (featuresByPath.has(candidate)) return candidate
    }
    return null
  }

  const lookupHelper = (identifier: string): string | null => {
    if (helperMap.has(identifier)) return helperMap.get(identifier)!
    const dotIdx = identifier.indexOf('.')
    if (dotIdx === -1) return null
    return helperMap.get(identifier.slice(dotIdx + 1)) ?? null
  }

  const resolveHelperCall = (callerPath: string, identifier: string): string | null => {
    const direct = lookupHelper(identifier)
    if (direct) return direct
    const aliases = aliasesByFile.get(callerPath)
    if (!aliases) return null
    const firstDot = identifier.indexOf('.')
    const head = firstDot === -1 ? identifier : identifier.slice(0, firstDot)
    const tail = firstDot === -1 ? '' : identifier.slice(firstDot)
    const aliasTarget = aliases.get(head)
    if (!aliasTarget) return null
    return lookupHelper(aliasTarget + tail)
  }

  const extractClasspathCalls = (scenario: KarateScenario): string[] => {
    const refs: string[] = []
    for (const step of scenario.steps) {
      CLASSPATH_CALL.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = CLASSPATH_CALL.exec(step.text)) !== null) refs.push(m[1])
    }
    return refs
  }

  const extractHelperCalls = (scenario: KarateScenario): string[] => {
    const ids: string[] = []
    for (const step of scenario.steps) {
      if (/call\s+read\s*\(/.test(step.text)) continue
      HELPER_CALL.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = HELPER_CALL.exec(step.text)) !== null) {
        if (m[1].includes('.')) ids.push(m[1])
      }
    }
    return ids
  }

  const isFeatureAsserting = (absolutePath: string): boolean => {
    return featuresByPath.get(absolutePath)?.asserts ?? false
  }

  const findDuplicatesFor = (filePath: string, line: number): DuplicateRef[] => {
    const rec = recordByKey.get(`${filePath}#${line}`)
    if (!rec) return []
    const group = exactGroups.get(rec.exactSig) ?? []
    return group.filter(o => !(o.file === filePath && o.line === line)).map(toRef)
  }

  const findDataVariationsFor = (filePath: string, line: number): DuplicateRef[] => {
    const rec = recordByKey.get(`${filePath}#${line}`)
    if (!rec) return []
    const exactGroup = exactGroups.get(rec.exactSig) ?? []
    if (exactGroup.length >= 2) return []
    const dataGroup = dataGroups.get(rec.dataSig) ?? []
    return dataGroup.filter(o => !(o.file === filePath && o.line === line)).map(toRef)
  }

  const findEndpointOverlapsFor = (filePath: string, line: number): EndpointOverlap[] => {
    const rec = recordByKey.get(`${filePath}#${line}`)
    if (!rec) return []
    const overlaps: EndpointOverlap[] = []
    const keysSeen = new Set<string>()
    for (const ep of rec.endpoints) {
      const key = `${ep.verb} ${ep.endpoint}`
      if (keysSeen.has(key)) continue
      keysSeen.add(key)
      const bucket = endpointGroups.get(key) ?? []
      const others = bucket.filter(o => !(o.file === filePath && o.line === line)).map(toRef)
      if (others.length > 0) overlaps.push({ verb: ep.verb, endpoint: ep.endpoint, others })
    }
    return overlaps
  }

  const recordsByFile = new Map<string, ScenarioRecord[]>()
  for (const rec of records) {
    const bucket = recordsByFile.get(rec.file) ?? []
    bucket.push(rec)
    recordsByFile.set(rec.file, bucket)
  }

  const MAX_DEPTH = 4

  type Collected = Array<EndpointTuple & { via: 'direct' | 'helper' }>

  function endpointsForRecord(rec: ScenarioRecord, visited: Set<string>, depth: number): Collected {
    const out: Collected = []
    for (const ep of rec.endpoints) out.push({ ...ep, via: 'direct' })

    for (const ref of rec.classpathRefs) {
      const resolved = resolveClasspath(rec.file, ref)
      if (resolved) {
        for (const childEp of endpointsForFile(resolved, visited, depth + 1)) out.push({ ...childEp, via: 'helper' })
      }
    }
    for (const id of rec.helperRefs) {
      const resolved = resolveHelperCall(rec.file, id)
      if (resolved) {
        for (const childEp of endpointsForFile(resolved, visited, depth + 1)) out.push({ ...childEp, via: 'helper' })
      }
    }
    return out
  }

  // Helper files are aggregated as a whole: any scenario inside may be the one called.
  function endpointsForFile(filePath: string, visited: Set<string>, depth: number): Collected {
    if (depth > MAX_DEPTH) return []
    if (visited.has(filePath)) return []
    visited.add(filePath)
    const out: Collected = []
    for (const rec of recordsByFile.get(filePath) ?? []) out.push(...endpointsForRecord(rec, visited, depth))
    return out
  }

  const collectAllEndpoints = (): EndpointUsage[] => {
    const seen = new Map<string, EndpointUsage>()
    for (const rec of records) {
      if (rec.tags.includes('@ignore')) continue
      const featureInfo = featuresByPath.get(rec.file)
      if (!featureInfo) continue

      const visited = new Set<string>([rec.file])
      const eps = endpointsForRecord(rec, visited, 0)
      for (const ep of eps) {
        const key = `${ep.verb} ${ep.endpoint} :: ${rec.file}#${rec.line}`
        if (seen.has(key)) continue
        seen.set(key, {
          verb: ep.verb,
          endpoint: ep.endpoint,
          file: rec.file,
          line: rec.line,
          scenarioName: rec.name,
          via: ep.via,
          kinds: ep.kinds,
          status: ep.status
        })
      }
    }
    return Array.from(seen.values())
  }

  return {
    isFeatureAsserting,
    resolveClasspath,
    resolveHelperCall,
    extractClasspathCalls,
    extractHelperCalls,
    findDuplicatesFor,
    findDataVariationsFor,
    findEndpointOverlapsFor,
    collectAllEndpoints
  }
}

export type { KarateFeature }
