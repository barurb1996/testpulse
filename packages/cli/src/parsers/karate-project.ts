import { readFile } from 'fs/promises'
import path from 'path'
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

export interface KarateProjectContext {
  isFeatureAsserting: (absolutePath: string) => boolean
  resolveClasspath: (callerPath: string, ref: string) => string | null
  resolveHelperCall: (callerPath: string, identifier: string) => string | null
  extractClasspathCalls: (scenario: KarateScenario) => string[]
  extractHelperCalls: (scenario: KarateScenario) => string[]
  findDuplicatesFor: (filePath: string, line: number) => DuplicateRef[]
  findDataVariationsFor: (filePath: string, line: number) => DuplicateRef[]
  findEndpointOverlapsFor: (filePath: string, line: number) => EndpointOverlap[]
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
  return parts[0] === 'helpers' && parts.length > 1 ? parts.slice(1).join('.') : rhs
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

function normalisePathLiteral(raw: string): string {
  let s = raw.trim()
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1)
  }
  s = s.replace(/['"]\s*\+\s*[\w.$]+\s*\+\s*['"]/g, ':var')
  s = s.replace(/['"]\s*\+\s*[\w.$]+/g, ':var')
  s = s.replace(/[\w.$]+\s*\+\s*['"]/g, ':var')
  s = s.replace(/\?.*$/, '')
  s = s.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, ':uuid')
  s = s.replace(/\b\d+\b/g, ':id')
  s = s.replace(/\/+/g, '/')
  if (!s.startsWith('/') && !s.startsWith('http')) s = '/' + s
  return s
}

function extractEndpoints(scenario: KarateScenario): Array<{ verb: string; endpoint: string; line: number }> {
  const tuples: Array<{ verb: string; endpoint: string; line: number }> = []
  let rollingPath: string | null = null
  for (const step of scenario.steps) {
    const pathMatch = PATH_STEP.exec(step.text)
    if (pathMatch) {
      rollingPath = normalisePathLiteral(pathMatch[1])
      continue
    }
    const methodMatch = METHOD_STEP.exec(step.text)
    if (methodMatch && rollingPath) {
      tuples.push({ verb: methodMatch[1].toUpperCase(), endpoint: rollingPath, line: step.line })
    }
  }
  return tuples
}

interface ScenarioRecord {
  file: string
  line: number
  name: string
  tags: string[]
  exactSig: string
  dataSig: string
  endpoints: Array<{ verb: string; endpoint: string; line: number }>
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

      const featureTaggedIgnore = feature.tags.includes('@ignore')
      for (const scenario of feature.scenarios) {
        if (featureTaggedIgnore || scenario.tags.includes('@ignore')) continue
        if (scenario.steps.length < 2) continue
        records.push({
          file: fp,
          line: scenario.line,
          name: scenario.name,
          tags: scenario.tags,
          exactSig: scenarioSignature(scenario, normaliseExact),
          dataSig: scenarioSignature(scenario, normaliseForDataVariation),
          endpoints: extractEndpoints(scenario)
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

  return {
    isFeatureAsserting,
    resolveClasspath,
    resolveHelperCall,
    extractClasspathCalls,
    extractHelperCalls,
    findDuplicatesFor,
    findDataVariationsFor,
    findEndpointOverlapsFor
  }
}

export type { KarateFeature }
