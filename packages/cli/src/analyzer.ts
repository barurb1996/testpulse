import { readdir, readFile } from 'fs/promises'
import path from 'path'
import { parsePlaywright } from './parsers/playwright.js'
import { parseKarate } from './parsers/karate.js'
import { parseCucumberSteps, looksLikeCucumberStepFile } from './parsers/cucumber-steps.js'
import { parseCucumberJava, looksLikeCucumberJavaStepFile } from './parsers/cucumber-java.js'
import { buildKarateContext, type KarateProjectContext } from './parsers/karate-project.js'
import type { AnalysisResult, Issue } from './types.js'

type Framework = 'playwright' | 'karate' | 'cucumber-ts' | 'cucumber-java' | null

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

export async function analyzeDirectory(dir: string): Promise<AnalysisResult[]> {
  const entries = await readdir(dir, { recursive: true })
  const candidates: { framework: Framework; absolutePath: string }[] = []

  for (const rel of entries) {
    if (typeof rel !== 'string') continue
    const absolutePath = path.join(dir, rel)
    const framework = await pickFramework(rel, absolutePath)
    if (!framework) continue
    candidates.push({ framework, absolutePath })
  }

  const karateFiles = candidates.filter(c => c.framework === 'karate').map(c => c.absolutePath)
  const karateCtx = karateFiles.length > 0 ? await buildKarateContext(karateFiles) : undefined

  const results: AnalysisResult[] = []
  for (const { framework, absolutePath } of candidates) {
    try {
      const source = await readFile(absolutePath, 'utf-8')
      const issues = runParser(framework, source, absolutePath, karateCtx)
      results.push({ file: absolutePath, issues })
    } catch {
      results.push({ file: absolutePath, issues: [] })
    }
  }

  return results
}
