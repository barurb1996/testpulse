import { createHash } from 'crypto'
import { existsSync } from 'fs'
import { mkdir, readFile, writeFile } from 'fs/promises'
import path from 'path'
import { parse } from '@typescript-eslint/typescript-estree'
import { extractTestCases } from '../parsers/playwright-model.js'
import { parseFeature } from '../parsers/karate.js'
import { redactSecrets } from '../rules/security-hygiene.js'
import { callJudge, type Evaluation } from './client.js'
import { PROMPT_VERSION } from './prompt.js'
import type { Issue } from '../types.js'

export interface JudgedFile {
  file: string
  evaluations: Array<Evaluation & { line: number }>
  cached: boolean
}

export interface JudgeOptions {
  apiKey: string
  model: string
  baseUrl?: string
  cacheDir?: string
  maxFileChars?: number
}

const MAX_IMPORTS = 3
const IMPORT_CHARS = 8000

async function resolveLocalImports(source: string, filePath: string): Promise<Array<{ rel: string; text: string }>> {
  const dir = path.dirname(filePath)
  const found: Array<{ rel: string; text: string }> = []
  const re = /from\s+['"](\.{1,2}\/[^'"]+)['"]/g
  for (const m of source.matchAll(re)) {
    if (found.length >= MAX_IMPORTS) break
    const base = path.resolve(dir, m[1].replace(/\.js$/, ''))
    for (const ext of ['.ts', '.tsx', '.js', '/index.ts', '']) {
      const candidate = base + ext
      if (/\.(spec|test)\.[tj]sx?$/.test(candidate) || !existsSync(candidate)) continue
      try {
        found.push({ rel: path.relative(dir, candidate), text: (await readFile(candidate, 'utf-8')).slice(0, IMPORT_CHARS) })
        break
      } catch { /* not a readable file, try next extension */ }
    }
  }
  return found
}

function listTests(source: string, filePath: string): Array<{ name: string; line: number }> {
  if (filePath.endsWith('.feature')) {
    return parseFeature(source).scenarios.map(s => ({ name: s.name, line: s.line }))
  }
  try {
    const ast = parse(source, { loc: true, range: true, jsx: false })
    return extractTestCases(ast, source).map(t => ({ name: t.name, line: t.line }))
  } catch {
    return []
  }
}

export async function judgeFile(filePath: string, staticIssues: Issue[], opts: JudgeOptions): Promise<JudgedFile | null> {
  const raw = await readFile(filePath, 'utf-8')
  const tests = listTests(raw, filePath)
  if (tests.length === 0) return null

  const maxChars = opts.maxFileChars ?? 30_000
  const source = redactSecrets(raw.slice(0, maxChars))
  const imports = filePath.endsWith('.feature') ? [] : (await resolveLocalImports(raw, filePath)).map(i => ({ ...i, text: redactSecrets(i.text) }))

  const findings = staticIssues.length
    ? staticIssues.map(i => `- line ${i.line} [${i.rule}] ${i.message}`).join('\n')
    : '(none)'
  const content = [
    `<test_file path="${path.basename(filePath)}">\n${source}\n</test_file>`,
    ...imports.map(i => `<module_under_test path="${i.rel}">\n${i.text}\n</module_under_test>`),
    `<static_findings>\n${findings}\n</static_findings>`,
    `<tests_to_evaluate>\n${tests.map(t => `- "${t.name}" (line ${t.line})`).join('\n')}\n</tests_to_evaluate>`
  ].join('\n\n')

  const key = createHash('sha256').update(`${PROMPT_VERSION}|${opts.model}|${content}`).digest('hex')
  const cacheFile = opts.cacheDir ? path.join(opts.cacheDir, `${key}.json`) : null
  if (cacheFile && existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(await readFile(cacheFile, 'utf-8')) as Evaluation[]
      return { file: filePath, evaluations: attachLines(cached, tests), cached: true }
    } catch { /* corrupt cache entry: fall through and re-judge */ }
  }

  const evals = await callJudge(content, { apiKey: opts.apiKey, model: opts.model, baseUrl: opts.baseUrl })
  if (cacheFile) {
    await mkdir(opts.cacheDir!, { recursive: true })
    await writeFile(cacheFile, JSON.stringify(evals))
  }
  return { file: filePath, evaluations: attachLines(evals, tests), cached: false }
}

function attachLines(evals: Evaluation[], tests: Array<{ name: string; line: number }>): Array<Evaluation & { line: number }> {
  const byName = new Map(tests.map(t => [t.name, t.line]))
  return evals.map(e => ({ ...e, line: byName.get(e.test_name) ?? 0 }))
}
