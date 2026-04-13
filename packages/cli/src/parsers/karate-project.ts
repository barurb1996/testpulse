import { readFile } from 'fs/promises'
import path from 'path'
import { parseFeature, type KarateScenario } from './karate.js'

export const ASSERTION_TOKENS = /\b(match|status|assert|responseStatus)\b|\bretry\s+until\b/
const CLASSPATH_CALL = /call\s+(?:read\s*\(\s*)?['"]classpath:([^'"]+?)['"]/g
const HELPER_ASSIGNMENT = /^\*\s*(?:set|def)\s+([\w.]+)\s*=\s*read\s*\(\s*['"]classpath:([^'"]+?)['"]\s*\)/
const HELPER_CALL = /\bcall\s+([a-zA-Z_$][\w.$]*)(?=\s|\{|$)/g

export interface KarateProjectContext {
  isFeatureAsserting: (absolutePath: string) => boolean
  resolveClasspath: (callerPath: string, ref: string) => string | null
  resolveHelperCall: (identifier: string) => string | null
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

export async function buildKarateContext(featurePaths: string[]): Promise<KarateProjectContext> {
  const featuresByPath = new Map<string, { asserts: boolean; classpathRoot: string | null }>()
  const helperMap = new Map<string, string>()
  const classpathRoots = new Set<string>()

  for (const fp of featurePaths) {
    try {
      const source = await readFile(fp, 'utf-8')
      const feature = parseFeature(source)
      const anyAsserts = feature.scenarios.some(scenarioAsserts)
      const root = findClasspathRoot(fp)
      featuresByPath.set(fp, { asserts: anyAsserts, classpathRoot: root })
      if (root) classpathRoots.add(root)

      for (const line of source.split(/\r?\n/)) {
        const m = HELPER_ASSIGNMENT.exec(line.trim())
        if (m && root) {
          const identifier = m[1]
          const classpathRef = m[2]
          const resolved = path.resolve(root, classpathRef)
          helperMap.set(identifier, resolved)
        }
      }
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

  const resolveHelperCall = (identifier: string): string | null => {
    return helperMap.get(identifier) ?? null
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
