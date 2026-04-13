import { readdir, readFile } from 'fs/promises'
import path from 'path'
import { parsePlaywright } from './parsers/playwright.js'
import type { AnalysisResult } from './types.js'

export async function analyzeDirectory(dir: string): Promise<AnalysisResult[]> {
  const files = await readdir(dir, { recursive: true })
  const specFiles = files.filter((f: string) => 
    typeof f === 'string' && f.endsWith('.spec.ts')
  )

  const results: AnalysisResult[] = []

  for (const file of specFiles) {
    const fullPath = path.join(dir, file as string)
    const source = await readFile(fullPath, 'utf-8')
    const issues = parsePlaywright(source, fullPath)
    results.push({ file: fullPath, issues })
  }

  return results
}
