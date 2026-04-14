import { readFile, readdir, stat } from 'fs/promises'
import path from 'path'
import { XMLParser } from 'fast-xml-parser'

export interface ScenarioResult {
  suite: string
  name: string
  classname: string | null
  status: 'pass' | 'fail' | 'skip' | 'error'
  durationMs: number | null
  failureMessage: string | null
  failureDetail: string | null
}

interface RawTestCase {
  '@_name'?: string
  '@_classname'?: string
  '@_time'?: string
  failure?: RawFailure | RawFailure[] | string
  error?: RawFailure | RawFailure[] | string
  skipped?: Record<string, unknown> | ''
}

interface RawFailure {
  '@_message'?: string
  '#text'?: string
}

interface RawTestSuite {
  '@_name'?: string
  testcase?: RawTestCase | RawTestCase[]
  testsuite?: RawTestSuite | RawTestSuite[]
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: false,
  trimValues: true
})

async function* walk(dir: string): AsyncGenerator<string> {
  let entries: string[]
  try { entries = await readdir(dir) } catch { return }
  for (const entry of entries) {
    const full = path.join(dir, entry)
    let s
    try { s = await stat(full) } catch { continue }
    if (s.isDirectory()) {
      yield* walk(full)
    } else {
      yield full
    }
  }
}

function matchesGlob(filePath: string, glob: string): boolean {
  if (glob.includes('*') || glob.includes('?')) {
    const escaped = glob
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '__DS__')
      .replace(/\*/g, '[^/]*')
      .replace(/__DS__/g, '.*')
      .replace(/\?/g, '[^/]')
    return new RegExp(`${escaped}$`).test(filePath)
  }
  return filePath === glob || filePath.endsWith(glob)
}

export async function findJunitFiles(rootDir: string, pattern: string): Promise<string[]> {
  const absolutePattern = path.isAbsolute(pattern) ? pattern : path.join(rootDir, pattern)
  const isGlob = pattern.includes('*') || pattern.includes('?')
  if (!isGlob) {
    try {
      const s = await stat(absolutePattern)
      if (s.isFile()) return [absolutePattern]
      if (s.isDirectory()) {
        const files: string[] = []
        for await (const f of walk(absolutePattern)) {
          if (f.endsWith('.xml')) files.push(f)
        }
        return files
      }
    } catch {
      return []
    }
  }
  const searchRoot = absolutePattern.includes('**')
    ? absolutePattern.split('**')[0].replace(/\/$/, '')
    : path.dirname(absolutePattern)
  const files: string[] = []
  for await (const f of walk(searchRoot)) {
    if (matchesGlob(f, absolutePattern)) files.push(f)
  }
  return files
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return []
  return Array.isArray(v) ? v : [v]
}

function failureBlock(tc: RawTestCase): { message: string | null; detail: string | null } {
  const raw = tc.failure ?? tc.error
  if (!raw) return { message: null, detail: null }
  if (typeof raw === 'string') return { message: null, detail: raw.slice(0, 2000) }
  const first = Array.isArray(raw) ? raw[0] : raw
  return {
    message: first['@_message'] ?? null,
    detail: first['#text'] ? first['#text'].slice(0, 2000) : null
  }
}

function parseDuration(time: string | undefined): number | null {
  if (!time) return null
  const n = Number(time)
  if (!Number.isFinite(n)) return null
  return Math.round(n * 1000)
}

function parseStatus(tc: RawTestCase): 'pass' | 'fail' | 'skip' | 'error' {
  if (tc.failure !== undefined) return 'fail'
  if (tc.error !== undefined) return 'error'
  if (tc.skipped !== undefined) return 'skip'
  return 'pass'
}

function collectFromSuite(suite: RawTestSuite, parentName: string | undefined, out: ScenarioResult[]): void {
  const suiteName = suite['@_name'] ?? parentName ?? 'unknown'
  for (const tc of asArray(suite.testcase)) {
    const failure = failureBlock(tc)
    out.push({
      suite: suiteName,
      name: tc['@_name'] ?? '(unnamed)',
      classname: tc['@_classname'] ?? null,
      status: parseStatus(tc),
      durationMs: parseDuration(tc['@_time']),
      failureMessage: failure.message,
      failureDetail: failure.detail
    })
  }
  for (const nested of asArray(suite.testsuite)) {
    collectFromSuite(nested, suiteName, out)
  }
}

export async function parseJunitFile(filePath: string): Promise<ScenarioResult[]> {
  const xml = await readFile(filePath, 'utf-8')
  let parsed: Record<string, unknown>
  try { parsed = parser.parse(xml) } catch { return [] }
  const out: ScenarioResult[] = []

  const root = parsed.testsuites ?? parsed.testsuite
  if (!root) return out

  if ((root as Record<string, unknown>).testsuite !== undefined) {
    for (const s of asArray((root as RawTestSuite).testsuite)) {
      collectFromSuite(s, undefined, out)
    }
  } else {
    collectFromSuite(root as RawTestSuite, undefined, out)
  }
  return out
}

export async function loadJunitResults(rootDir: string, pattern: string): Promise<{ files: string[]; results: ScenarioResult[] }> {
  const files = await findJunitFiles(rootDir, pattern)
  const results: ScenarioResult[] = []
  for (const f of files) {
    const parsed = await parseJunitFile(f)
    results.push(...parsed)
  }
  return { files, results }
}
