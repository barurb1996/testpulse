import { readFile } from 'fs/promises'
import path from 'path'
import { parseFeature, type KarateScenario } from './karate.js'

const ASSERTION_TOKENS = /\b(match|status|assert)\b/
const CLASSPATH_CALL = /call\s+(?:read\s*\(\s*)?['"]classpath:([^'"]+?)['"]/g

export interface KarateProjectContext {
  isFeatureAsserting: (absolutePath: string) => boolean
  resolveClasspath: (callerPath: string, ref: string) => string | null
  extractClasspathCalls: (scenario: KarateScenario) => string[]
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

  for (const fp of featurePaths) {
    try {
      const source = await readFile(fp, 'utf-8')
      const feature = parseFeature(source)
      const anyAsserts = feature.scenarios.some(scenarioAsserts)
      featuresByPath.set(fp, {
        asserts: anyAsserts,
        classpathRoot: findClasspathRoot(fp)
      })
    } catch {
      featuresByPath.set(fp, { asserts: false, classpathRoot: null })
    }
  }

  const resolveClasspath = (callerPath: string, ref: string): string | null => {
    const info = featuresByPath.get(callerPath)
    const roots: string[] = []
    if (info?.classpathRoot) roots.push(info.classpathRoot)
    for (const f of featuresByPath.values()) {
      if (f.classpathRoot && !roots.includes(f.classpathRoot)) roots.push(f.classpathRoot)
    }
    for (const root of roots) {
      const candidate = path.resolve(root, ref)
      if (featuresByPath.has(candidate)) return candidate
    }
    return null
  }

  const extractClasspathCalls = (scenario: KarateScenario): string[] => {
    const refs: string[] = []
    for (const step of scenario.steps) {
      CLASSPATH_CALL.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = CLASSPATH_CALL.exec(step.text)) !== null) {
        refs.push(m[1])
      }
    }
    return refs
  }

  const isFeatureAsserting = (absolutePath: string): boolean => {
    return featuresByPath.get(absolutePath)?.asserts ?? false
  }

  return { isFeatureAsserting, resolveClasspath, extractClasspathCalls }
}
