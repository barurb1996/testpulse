import { readdir, readFile, stat } from 'fs/promises'
import path from 'path'
import { parsePlaywright } from './parsers/playwright.js'
import { parseKarate } from './parsers/karate.js'
import { parseCucumberSteps, looksLikeCucumberStepFile } from './parsers/cucumber-steps.js'
import { parseCucumberJava, looksLikeCucumberJavaStepFile } from './parsers/cucumber-java.js'
import { buildKarateContext, type KarateProjectContext } from './parsers/karate-project.js'
import { extractPlaywrightEndpoints } from './parsers/playwright-api.js'
import { scanAiApp } from './rules/ai-app.js'
import { scanSecurityHygiene } from './rules/security-hygiene.js'
import { fingerprintFor } from './utils/fingerprint.js'
import {
  loadConfig,
  isFileIgnored,
  shouldSkipRule,
  applySeverityOverride,
  type ResolvedConfig
} from './utils/config.js'
import type { AnalysisResult, EndpointCoverage, Issue } from './types.js'

const MAX_FILE_BYTES = 2 * 1024 * 1024

type Framework = 'playwright' | 'karate' | 'cucumber-ts' | 'cucumber-java' | null

export interface AnalyzeOptions {
  skipIgnores?: boolean
}

export interface AnalyzeOutcome {
  results: AnalysisResult[]
  suppressed: number
  staleIgnoreFingerprints: string[]
  endpoints: EndpointCoverage[]
  config: ResolvedConfig
}

function looksLikeJsOrTs(file: string): boolean {
  return /\.(ts|tsx|js|mjs|cjs)$/.test(file)
}

async function pickFramework(file: string, absolutePath: string): Promise<Framework> {
  if (file.endsWith('.spec.ts') || file.endsWith('.spec.tsx')) return 'playwright'
  if (file.endsWith('.feature')) return 'karate'
  if (file.endsWith('.java')) {
    try {
      const source = await readFile(absolutePath, 'utf-8')
      if (looksLikeCucumberJavaStepFile(absolutePath, source)) return 'cucumber-java'
    } catch { /* ignore */ }
    return null
  }
  if (looksLikeJsOrTs(file)) {
    try {
      const source = await readFile(absolutePath, 'utf-8')
      if (looksLikeCucumberStepFile(absolutePath, source)) return 'cucumber-ts'
    } catch { /* ignore */ }
    return null
  }
  return null
}

function runParser(framework: Framework, source: string, filePath: string, karateCtx?: KarateProjectContext): Issue[] {
  if (framework === 'playwright') return parsePlaywright(source, filePath)
  if (framework === 'karate') return parseKarate(source, filePath, karateCtx)
  if (framework === 'cucumber-ts') return parseCucumberSteps(source, filePath)
  if (framework === 'cucumber-java') return parseCucumberJava(source, filePath)
  return []
}

function enrichAndFilter(
  rawIssues: Issue[],
  absolutePath: string,
  sourceLines: string[],
  rootDir: string,
  resolved: ResolvedConfig,
  skipIgnores: boolean,
  seenFingerprints: Set<string>
): { kept: Issue[]; suppressedCount: number } {
  const relPath = path.relative(rootDir, absolutePath).replace(/\\/g, '/')
  const kept: Issue[] = []
  let suppressedCount = 0

  for (const issue of rawIssues) {
    if (shouldSkipRule(issue.rule, resolved.config)) continue

    const lineContent = sourceLines[issue.line - 1] ?? ''
    const fp = fingerprintFor(issue.rule, relPath, lineContent)
    seenFingerprints.add(fp)

    const enriched: Issue = {
      ...issue,
      fingerprint: fp,
      severity: applySeverityOverride(issue.rule, issue.severity, resolved.config)
    }

    if (!skipIgnores && resolved.ignoreSet.has(fp)) {
      suppressedCount++
      continue
    }

    kept.push(enriched)
  }

  return { kept, suppressedCount }
}

export async function analyzeDirectory(dir: string, opts: AnalyzeOptions = {}): Promise<AnalyzeOutcome> {
  const resolved = await loadConfig(dir)
  const entries = await readdir(dir, { recursive: true })
  const candidates: { framework: Framework; absolutePath: string; relPath: string }[] = []

  for (const rel of entries) {
    if (typeof rel !== 'string') continue
    const absolutePath = path.join(dir, rel)
    const framework = await pickFramework(rel, absolutePath)
    if (!framework) continue
    const relPath = path.relative(dir, absolutePath).replace(/\\/g, '/')
    if (isFileIgnored(relPath, resolved.fileGlobs)) continue
    candidates.push({ framework, absolutePath, relPath })
  }

  const karateFiles = candidates.filter(c => c.framework === 'karate').map(c => c.absolutePath)
  const karateCtx = karateFiles.length > 0 ? await buildKarateContext(karateFiles) : undefined

  const seenFingerprints = new Set<string>()
  let totalSuppressed = 0
  const results: AnalysisResult[] = []
  const playwrightEndpoints: EndpointCoverage[] = []

  for (const { framework, absolutePath } of candidates) {
    try {
      // Hostile or generated files (this also runs on cloned third-party repos): skip anything implausibly large.
      if ((await stat(absolutePath)).size > MAX_FILE_BYTES) { results.push({ file: absolutePath, issues: [] }); continue }
      const source = await readFile(absolutePath, 'utf-8')
      if (framework === 'playwright') playwrightEndpoints.push(...extractPlaywrightEndpoints(source, absolutePath))
      const parsed = runParser(framework, source, absolutePath, karateCtx)
      const credentialLines = new Set(
        parsed.filter(i => i.rule === 'karate-hardcoded-auth-token').map(i => i.line)
      )
      let hygieneRaw: Issue[] = []
      try {
        hygieneRaw = scanSecurityHygiene(source, { productionDomains: resolved.config?.productionDomains })
      } catch (err) {
        console.error(`testpulse: security-hygiene scan failed for ${path.relative(dir, absolutePath)}: ${err instanceof Error ? err.message : err}`)
      }
      const hygiene = hygieneRaw.filter(i => !(i.rule === 'hardcoded-secret' && credentialLines.has(i.line)))
      const raw = [...parsed, ...hygiene, ...scanAiApp(source)]
      const { kept, suppressedCount } = enrichAndFilter(
        raw,
        absolutePath,
        source.split(/\r?\n/),
        dir,
        resolved,
        opts.skipIgnores ?? false,
        seenFingerprints
      )
      totalSuppressed += suppressedCount
      results.push({ file: absolutePath, issues: kept })
    } catch {
      results.push({ file: absolutePath, issues: [] })
    }
  }

  const staleIgnoreFingerprints: string[] = []
  if (resolved.ignores) {
    for (const entry of resolved.ignores.ignores) {
      if (!seenFingerprints.has(entry.fingerprint)) staleIgnoreFingerprints.push(entry.fingerprint)
    }
  }

  const endpoints: EndpointCoverage[] = karateCtx
    ? karateCtx.collectAllEndpoints().map(e => ({
        verb: e.verb,
        path: e.endpoint,
        file: e.file,
        line: e.line,
        scenarioName: e.scenarioName,
        via: e.via,
        kinds: e.kinds,
        status: e.status
      }))
    : []

  endpoints.push(...playwrightEndpoints)

  return { results, suppressed: totalSuppressed, staleIgnoreFingerprints, endpoints, config: resolved }
}
