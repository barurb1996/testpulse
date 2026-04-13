import { readdir, readFile } from 'fs/promises'
import path from 'path'
import { parsePlaywright } from './parsers/playwright.js'
import { parseKarate } from './parsers/karate.js'
import { buildKarateContext, type KarateProjectContext } from './parsers/karate-project.js'
import type { AnalysisResult, Issue } from './types.js'

type Framework = 'playwright' | 'karate' | null

function pickFramework(file: string): Framework {
  if (file.endsWith('.spec.ts') || file.endsWith('.spec.tsx')) return 'playwright'
  if (file.endsWith('.feature')) return 'karate'
  return null
}

function runParser(framework: Framework, source: string, filePath: string, karateCtx?: KarateProjectContext): Issue[] {
  if (framework === 'playwright') return parsePlaywright(source, filePath)
  if (framework === 'karate') return parseKarate(source, filePath, karateCtx)
  return []
}

export async function analyzeDirectory(dir: string): Promise<AnalysisResult[]> {
  const entries = await readdir(dir, { recursive: true })
  const candidates: { framework: Framework; absolutePath: string }[] = []

  for (const rel of entries) {
    if (typeof rel !== 'string') continue
    const framework = pickFramework(rel)
    if (!framework) continue
    candidates.push({ framework, absolutePath: path.join(dir, rel) })
  }

  const karateFiles = candidates.filter(c => c.framework === 'karate').map(c => c.absolutePath)
  const karateCtx = karateFiles.length > 0 ? await buildKarateContext(karateFiles) : undefined

  const results: AnalysisResult[] = []
  for (const { framework, absolutePath } of candidates) {
    const source = await readFile(absolutePath, 'utf-8')
    const issues = runParser(framework, source, absolutePath, karateCtx)
    results.push({ file: absolutePath, issues })
  }

  return results
}
