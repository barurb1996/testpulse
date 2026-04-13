import { readdir, readFile } from 'fs/promises'
import path from 'path'
import { parsePlaywright } from './parsers/playwright.js'
import { parseKarate } from './parsers/karate.js'
import type { AnalysisResult, Issue } from './types.js'

function pickParser(file: string): ((source: string, filePath: string) => Issue[]) | null {
  if (file.endsWith('.spec.ts') || file.endsWith('.spec.tsx')) return parsePlaywright
  if (file.endsWith('.feature')) return (src) => parseKarate(src)
  return null
}

export async function analyzeDirectory(dir: string): Promise<AnalysisResult[]> {
  const files = await readdir(dir, { recursive: true })
  const results: AnalysisResult[] = []

  for (const rel of files) {
    if (typeof rel !== 'string') continue
    const parser = pickParser(rel)
    if (!parser) continue

    const fullPath = path.join(dir, rel)
    const source = await readFile(fullPath, 'utf-8')
    const issues = parser(source, fullPath)
    results.push({ file: fullPath, issues })
  }

  return results
}
