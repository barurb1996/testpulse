import { readFile } from 'fs/promises'
import path from 'path'
import { parseFeature, type KarateScenario } from './karate.js'

export const ASSERTION_TOKENS = /\b(match|status|assert|responseStatus)\b|\bretry\s+until\b/
const CLASSPATH_CALL = /call\s+(?:read\s*\(\s*)?['"]classpath:([^'"]+?)['"]/g
const HELPER_ASSIGNMENT = /^\*\s*(?:set|def)\s+([\w.]+)\s*=\s*read\s*\(\s*['"]classpath:([^'"]+?)['"]\s*\)/
const HELPER_ALIAS = /^\*\s*def\s+([\w$]+)\s*=\s*([\w.$]+)\s*$/
const HELPER_CALL = /\bcall\s+([a-zA-Z_$][\w.$]*)(?=\s|\{|$)/g

export interface KarateProjectContext {
  isFeatureAsserting: (absolutePath: string) => boolean
  resolveClasspath: (callerPath: string, ref: string) => string | null
  resolveHelperCall: (callerPath: string, identifier: string) => string | null
  extractClasspathCalls: (scenario: KarateScenario) => string[]
  extractHelperCalls: (scenario: KarateScenario) => string[]
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

export async function buildKarateContext(featurePaths: string[]): Promise<KarateProjectContext> {
  const featuresByPath = new Map<string, { asserts: boolean; classpathRoot: string | null }>()
  const helperMap = new Map<string, string>()
  const aliasesByFile = new Map<string, Map<string, string>>()
  const classpathRoots = new Set<string>()

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
          const identifier = m[1]
          const classpathRef = m[2]
          helperMap.set(identifier, path.resolve(root, classpathRef))
          continue
        }
        const alias = HELPER_ALIAS.exec(trimmed)
        if (alias) {
          fileAliases.set(alias[1], canonicalRhs(alias[2]))
        }
      }
      if (fileAliases.size > 0) aliasesByFile.set(fp, fileAliases)
    } catch {
      featuresByPath.set(fp, { asserts: false, classpathRoot: null })
    }
  }

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

  return {
    isFeatureAsserting,
    resolveClasspath,
    resolveHelperCall,
    extractClasspathCalls,
    extractHelperCalls
  }
}
