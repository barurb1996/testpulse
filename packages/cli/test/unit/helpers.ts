import path from 'path'
import { fileURLToPath } from 'url'
import { analyzeDirectory } from '../../src/analyzer.js'

export const here = path.dirname(fileURLToPath(import.meta.url))
export const cliRoot = path.resolve(here, '..', '..')
export const corpus = path.join(cliRoot, 'test', 'corpus')
export const repoRoot = path.resolve(cliRoot, '..', '..')

/** rule ids reported per file basename for a directory */
export async function rulesByFile(dir: string, opts: { skipIgnores?: boolean } = { skipIgnores: true }): Promise<Map<string, Set<string>>> {
  const out = await analyzeDirectory(dir, opts)
  const map = new Map<string, Set<string>>()
  for (const r of out.results) map.set(path.relative(dir, r.file).replace(/\\/g, '/'), new Set(r.issues.map(i => i.rule)))
  return map
}
