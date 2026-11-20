/**
 * The repo-scan route reuses the CLI engine. `testpulse` is a workspace dependency, so it resolves through
 * node_modules (the previous relative path into packages/cli pointed at a directory that does not exist).
 * Specifiers are built at runtime so the API typechecks without the CLI having been built first;
 * the CLI must be built before the API runs (`pnpm --filter testpulse run build`).
 */
export interface CliEngine {
  analyzeDirectory: (dir: string, opts?: { skipIgnores?: boolean }) => Promise<{
    results: Array<{ file: string; issues: Array<{ line: number; rule: string; severity: string; message: string; fingerprint?: string; scenarioName?: string }> }>
    endpoints?: Array<{ verb: string; path: string; file?: string; line?: number; scenarioName?: string }>
  }>
  scanCodebase: (dir: string) => Promise<Array<{ relativePath: string; layer: string; content: string }>>
  loadJunitResults: (root: string, glob: string) => Promise<{
    files: string[]
    results: Array<{ suite: string; name: string; classname: string | null; status: string; durationMs: number | null; failureMessage: string | null; failureDetail: string | null }>
  }>
}

const spec = (file: string) => `testpulse/dist/${file}.js`

export async function loadCli(): Promise<CliEngine> {
  try {
    const [a, c, j] = await Promise.all([import(spec('analyzer')), import(spec('codebase')), import(spec('junit'))])
    return { analyzeDirectory: a.analyzeDirectory, scanCodebase: c.scanCodebase, loadJunitResults: j.loadJunitResults }
  } catch (err) {
    throw new Error(`CLI engine is not available (build it with "pnpm --filter testpulse run build"): ${err instanceof Error ? err.message : err}`)
  }
}
