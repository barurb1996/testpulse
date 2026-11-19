#!/usr/bin/env node
import path from 'path'
import { execFileSync } from 'child_process'
import { writeFileSync } from 'fs'
import { readFile } from 'fs/promises'
import { judgeFile, type JudgedFile } from './judge/index.js'
import { toSarif, toJson } from './reporter/sarif.js'
import { computeSecurityCoverage, printMatrix } from './security/coverage.js'
import { analyzeDirectory as analyzeForCoverage } from './analyzer.js'
import { analyzeDirectory } from './analyzer.js'
import { reporter } from './reporter/index.js'
import { pushRun } from './pusher.js'
import { parseOpenApiFile } from './openapi.js'
import { loadJunitResults } from './junit.js'
import { findDocFiles, parseDocFile } from './docs.js'
import { scanCodebase, summarizeForPrompt } from './codebase.js'

const USAGE = `Usage: testpulse <path> [options]          analyse a directory
       testpulse ingest-openapi <file> [options]  upload an OpenAPI spec as coverage targets
       testpulse judge <path> [--changed-since <ref>] [--max-files N] [--min-score 1-5]  LLM review of test quality (needs ANTHROPIC_API_KEY)
       testpulse judge-eval <labels.json> [dir]  agreement of the judge with human scores
       testpulse security-coverage <path> --openapi <spec> [options]  endpoint x security-test matrix

Analyse options:
  --push <api-url>         POST results to a Testpulse API
  --project <slug>         project slug (required with --push / ingest-openapi)
  --no-exit                don't exit 1 on critical issues
  --no-ignore              ignore .testpulse/ignores.json (show everything)
  --print-fingerprints     show each issue's fingerprint inline
  --junit <glob>           parse JUnit XML result files and push per-scenario pass/fail
  --format <text|sarif|json>  output format (default text; sarif/json need --output or print to stdout)
  --output <file>          write sarif/json to a file instead of stdout
  --changed-since <ref>    only report files changed vs a git ref (e.g. origin/main)

ingest-openapi options:
  --push <api-url>         REQUIRED — where to upload the targets
  --project <slug>         REQUIRED — project to attach the targets to

Config files (project root):
  .testpulse/ignores.json  list of { fingerprint, rule?, reason? } to suppress
  .testpulse/config.json   { rules?: {<name>: "off" | { off?, severity? }},
                             ignoreFiles?: [<glob>, ...] }`

async function runIngestOpenApi(args: string[]): Promise<void> {
  let pushUrl: string | undefined
  let project: string | undefined
  const positional: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--push') pushUrl = args[++i]
    else if (a === '--project') project = args[++i]
    else positional.push(a)
  }
  const file = positional[0]
  if (!file || !pushUrl || !project) {
    console.error('Usage: testpulse ingest-openapi <file> --push <api-url> --project <slug>')
    process.exit(2)
  }

  const absolutePath = path.resolve(process.cwd(), file)
  console.log(`\nTestpulse — parsing ${absolutePath}\n`)
  const targets = await parseOpenApiFile(absolutePath)
  console.log(`Found ${targets.length} operations.`)

  const endpoint = pushUrl.replace(/\/$/, '') + `/api/projects/${encodeURIComponent(project)}/coverage-targets`
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source: path.basename(file), targets })
  })
  if (!res.ok) {
    const body = await res.text()
    console.error(`Upload failed: ${res.status} ${res.statusText} — ${body}`)
    process.exit(2)
  }
  const data = await res.json() as { inserted: number; total: number }
  console.log(`Uploaded ${data.inserted} new targets (total now: ${data.total}) to ${endpoint}`)
}

function changedFileSet(ref: string, dir: string): Set<string> {
  if (!/^[A-Za-z0-9_./~^@-]+$/.test(ref)) {
    console.error('--changed-since: invalid git ref')
    process.exit(2)
  }
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf-8' }).trim()
    const diff = execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMR', `${ref}...HEAD`], { cwd: top, encoding: 'utf-8' })
    return new Set(diff.split('\n').filter(Boolean).map(f => path.resolve(top, f)))
  } catch (err) {
    console.error(`--changed-since failed (is "${ref}" fetched? CI needs fetch-depth: 0): ${err instanceof Error ? err.message.split('\n')[0] : err}`)
    process.exit(2)
  }
}

async function runSecurityCoverage(args: string[]): Promise<void> {
  let spec: string | undefined
  let format: 'text' | 'json' = 'text'
  let failOn: 'critical' | 'warning' | undefined
  let minCoverage: number | undefined
  const positional: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--openapi') spec = args[++i]
    else if (a === '--format') format = args[++i] === 'json' ? 'json' : 'text'
    else if (a === '--fail-on') {
      const v = args[++i]
      if (v !== 'critical' && v !== 'warning') { console.error('--fail-on must be critical or warning'); process.exit(2) }
      failOn = v
    }
    else if (a === '--min-coverage') minCoverage = Number(args[++i])
    else positional.push(a)
  }
  const dir = positional[0]
  if (!dir || !spec) {
    console.error('Usage: testpulse security-coverage <tests-path> --openapi <spec.yaml|json> [--format text|json] [--fail-on critical|warning] [--min-coverage N]')
    process.exit(2)
  }
  if (minCoverage !== undefined && !(minCoverage >= 0 && minCoverage <= 100)) {
    console.error('--min-coverage must be 0-100'); process.exit(2)
  }

  const targets = await parseOpenApiFile(path.resolve(process.cwd(), spec))
  const outcome = await analyzeForCoverage(path.resolve(process.cwd(), dir), { skipIgnores: true })
  const report = computeSecurityCoverage(targets, outcome.endpoints)

  if (format === 'json') {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  } else {
    console.log(`\nTestpulse — security coverage (${targets.length} operations, ${outcome.endpoints.length} test calls)\n`)
    printMatrix(report)
    console.log(`\nSecurity coverage: ${report.coveragePct}% (${report.satisfiedChecks}/${report.applicableChecks} applicable checks)\n`)
    if (report.gaps.length > 0) {
      console.log('Gaps (highest risk first):')
      for (const g of report.gaps) {
        const icon = g.severity === 'critical' ? '✗' : g.severity === 'warning' ? '⚠' : 'ℹ'
        console.log(`  ${icon} [${g.check}] ${g.detail}`)
      }
      console.log()
    }
  }

  const blocking = failOn === 'critical'
    ? report.gaps.some(g => g.severity === 'critical')
    : failOn === 'warning'
      ? report.gaps.some(g => g.severity !== 'info')
      : false
  const belowMin = minCoverage !== undefined && report.coveragePct < minCoverage
  if (blocking || belowMin) process.exit(1)
}

function judgeSetup(label: string): { apiKey: string; model: string; baseUrl?: string } {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error(`${label} needs ANTHROPIC_API_KEY (bring your own key). Test code is sent to the Anthropic API with secrets redacted.`)
    process.exit(2)
  }
  return { apiKey, model: process.env.TESTPULSE_JUDGE_MODEL ?? 'claude-haiku-5-5', baseUrl: process.env.TESTPULSE_JUDGE_BASE_URL }
}

const JUDGEABLE = /\.(spec|test)\.[tj]sx?$|\.feature$/

async function runJudge(args: string[]): Promise<void> {
  let changedSince: string | undefined
  let maxFiles = 10
  let minScore: number | undefined
  let format: 'text' | 'json' = 'text'
  let useCache = true
  const positional: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--changed-since') changedSince = args[++i]
    else if (a === '--max-files') maxFiles = Number(args[++i])
    else if (a === '--min-score') minScore = Number(args[++i])
    else if (a === '--format') format = args[++i] === 'json' ? 'json' : 'text'
    else if (a === '--no-cache') useCache = false
    else positional.push(a)
  }
  if (!Number.isInteger(maxFiles) || maxFiles < 1) { console.error('--max-files must be a positive integer'); process.exit(2) }
  if (minScore !== undefined && !(minScore >= 1 && minScore <= 5)) { console.error('--min-score must be 1-5'); process.exit(2) }

  const dir = path.resolve(process.cwd(), positional[0] ?? './e2e')
  const cfg = judgeSetup('judge')
  const log = format === 'json' ? console.error : console.log

  const outcome = await analyzeDirectory(dir, { skipIgnores: false })
  let candidates = outcome.results.filter(r => JUDGEABLE.test(r.file))
  if (changedSince) {
    const changed = changedFileSet(changedSince, dir)
    candidates = candidates.filter(r => changed.has(r.file))
  }
  const skipped = Math.max(0, candidates.length - maxFiles)
  candidates = candidates.slice(0, maxFiles)

  log(`\nTestpulse judge — ${candidates.length} file(s), model ${cfg.model}${skipped ? ` (${skipped} more skipped by --max-files)` : ''}\n`)

  const cacheDir = useCache ? path.join(dir, '.testpulse', 'cache', 'judge') : undefined
  const judged: JudgedFile[] = []
  for (const c of candidates) {
    try {
      const j = await judgeFile(c.file, c.issues, { ...cfg, cacheDir })
      if (j) judged.push(j)
    } catch (err) {
      console.error(`  ✗ ${path.relative(dir, c.file)}: ${err instanceof Error ? err.message : err}`)
    }
  }

  const all = judged.flatMap(j => j.evaluations.map(e => ({ file: path.relative(dir, j.file), ...e })))
  const avg = all.length ? all.reduce((a, e) => a + e.score, 0) / all.length : 0
  const weak = all.filter(e => e.score <= 2)

  if (format === 'json') {
    process.stdout.write(JSON.stringify({ averageScore: avg, evaluations: all }, null, 2) + '\n')
  } else {
    for (const j of judged) {
      console.log(`  ${path.relative(dir, j.file)}${j.cached ? '  (cached)' : ''}`)
      for (const e of j.evaluations) {
        const icon = e.score <= 2 ? '✗' : e.score === 3 ? '⚠' : '✓'
        console.log(`    ${icon} ${e.score}/5 line ${e.line}: ${e.test_name}`)
        console.log(`        ${e.reasoning}`)
        for (const m of e.missing_cases) console.log(`        · missing: ${m}`)
        if (e.score <= 2 && e.suggested_test) console.log(`        → ${e.suggested_test.split('\n').join('\n          ')}`)
      }
      console.log()
    }
    console.log(`Judge average: ${avg.toFixed(2)}/5 over ${all.length} test(s) · ${weak.length} weak (<=2)\n`)
  }
  if (minScore !== undefined && all.some(e => e.score < minScore)) process.exit(1)
}

async function runJudgeEval(args: string[]): Promise<void> {
  const [labelsPath, dirArg] = args.filter(a => !a.startsWith('--'))
  if (!labelsPath) { console.error('Usage: testpulse judge-eval <labels.json> [tests-dir]  (labels: [{ "file": "rel/path", "name": "test name", "score": 1-5 }])'); process.exit(2) }
  const dir = path.resolve(process.cwd(), dirArg ?? '.')
  const labels = JSON.parse(await readFile(labelsPath, 'utf-8')) as Array<{ file: string; name: string; score: number }>
  const cfg = judgeSetup('judge-eval')
  const cacheDir = path.join(dir, '.testpulse', 'cache', 'judge')

  const byFile = new Map<string, typeof labels>()
  for (const l of labels) byFile.set(l.file, [...(byFile.get(l.file) ?? []), l])

  let n = 0, exact = 0, within1 = 0, absErr = 0, missing = 0
  const confusion = new Map<string, number>()
  for (const [file, ls] of byFile) {
    const j = await judgeFile(path.resolve(dir, file), [], { ...cfg, cacheDir })
    for (const l of ls) {
      const e = j?.evaluations.find(x => x.test_name === l.name)
      if (!e) { missing++; continue }
      n++
      const d = Math.abs(e.score - l.score)
      if (d === 0) exact++
      if (d <= 1) within1++
      absErr += d
      confusion.set(`${l.score}->${e.score}`, (confusion.get(`${l.score}->${e.score}`) ?? 0) + 1)
    }
  }
  console.log(`\nJudge agreement vs human labels (${n} compared, ${missing} unmatched)`)
  if (n > 0) {
    console.log(`  exact:    ${(100 * exact / n).toFixed(0)}%`)
    console.log(`  within 1: ${(100 * within1 / n).toFixed(0)}%`)
    console.log(`  MAE:      ${(absErr / n).toFixed(2)}`)
    console.log(`  human->judge: ${[...confusion.entries()].sort().map(([k, v]) => `${k}×${v}`).join('  ')}\n`)
  }
}

async function runIngestDocs(args: string[]): Promise<void> {
  let pushUrl: string | undefined
  let project: string | undefined
  let token: string | undefined
  const positional: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--push') pushUrl = args[++i]
    else if (a === '--project') project = args[++i]
    else if (a === '--token') token = args[++i]
    else positional.push(a)
  }
  const pattern = positional[0]
  if (!pattern || !pushUrl || !project) {
    console.error('Usage: testpulse ingest-docs <path-or-glob> --push <api-url> --project <slug> [--token <token>]')
    process.exit(2)
  }

  const files = await findDocFiles(process.cwd(), pattern)
  if (files.length === 0) {
    console.error(`No .txt / .md / .docx files found matching "${pattern}"`)
    process.exit(2)
  }
  console.log(`\nTestpulse — ingesting ${files.length} document(s)\n`)

  const headers: Record<string, string> = { 'content-type': 'application/json' }
  const tok = token ?? process.env.TESTPULSE_TOKEN
  if (tok) headers['authorization'] = `Bearer ${tok}`

  let uploaded = 0
  for (const file of files) {
    const parsed = await parseDocFile(file)
    console.log(`  ${parsed.filename} — ${parsed.charCount} chars, ${parsed.chunks.length} chunks`)

    const endpoint = pushUrl.replace(/\/$/, '') + `/api/projects/${encodeURIComponent(project)}/docs`
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        filename: parsed.filename,
        contentText: parsed.fullText.slice(0, 500_000),
        chunks: parsed.chunks,
        charCount: parsed.charCount,
        source: 'cli-ingest'
      })
    })
    if (!res.ok) {
      const body = await res.text()
      console.error(`  ✗ upload failed: ${res.status} — ${body}`)
      continue
    }
    uploaded++
  }
  console.log(`\nUploaded ${uploaded}/${files.length} document(s)`)
}

async function runScanCodebase(args: string[]): Promise<void> {
  let pushUrl: string | undefined
  let project: string | undefined
  let token: string | undefined
  let extract = false
  const positional: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--push') pushUrl = args[++i]
    else if (a === '--project') project = args[++i]
    else if (a === '--token') token = args[++i]
    else if (a === '--extract') extract = true
    else positional.push(a)
  }
  const targetDir = positional[0]
  if (!targetDir || !pushUrl || !project) {
    console.error('Usage: testpulse scan-codebase <path> --push <api-url> --project <slug> [--extract] [--token <token>]')
    process.exit(2)
  }

  const absolutePath = path.resolve(process.cwd(), targetDir)
  console.log(`\nTestpulse — scanning codebase at ${absolutePath}\n`)

  const files = await scanCodebase(absolutePath)
  if (files.length === 0) {
    console.error('No relevant source files found (controllers, services, models, middleware, config)')
    process.exit(2)
  }

  const byLayer = new Map<string, number>()
  for (const f of files) byLayer.set(f.layer, (byLayer.get(f.layer) ?? 0) + 1)
  console.log(`Found ${files.length} files:`)
  for (const [layer, count] of byLayer) console.log(`  ${layer}: ${count}`)
  console.log()

  const headers: Record<string, string> = { 'content-type': 'application/json' }
  const tok = token ?? process.env.TESTPULSE_TOKEN
  if (tok) headers['authorization'] = `Bearer ${tok}`
  const baseUrl = pushUrl.replace(/\/$/, '')

  if (extract) {
    console.log('Running LLM extraction…')
    const summary = summarizeForPrompt(files)
    const res = await fetch(`${baseUrl}/api/projects/${encodeURIComponent(project)}/codebase-scan`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ codebaseSummary: summary, fileCount: files.length })
    })
    if (!res.ok) {
      const body = await res.text()
      console.error(`Extraction failed: ${res.status} — ${body}`)
      process.exit(2)
    }
    const data = await res.json() as { endpointsFound: number; docsStored: number }
    console.log(`Extracted ${data.endpointsFound} endpoints, stored ${data.docsStored} doc chunks`)
  } else {
    console.log('Storing as project docs (raw mode)…')
    let uploaded = 0
    for (const f of files) {
      const chunks = [{
        index: 0,
        heading: `[${f.layer.toUpperCase()}] ${f.relativePath}`,
        text: f.content.slice(0, 50_000)
      }]
      const res = await fetch(`${baseUrl}/api/projects/${encodeURIComponent(project)}/docs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          filename: `[codebase] ${f.relativePath}`,
          contentText: f.content.slice(0, 500_000),
          chunks,
          charCount: f.content.length,
          source: 'codebase-scan'
        })
      })
      if (res.ok) uploaded++
    }
    console.log(`Uploaded ${uploaded}/${files.length} files as project docs`)
  }

  console.log(`\nDone. Gap analysis will now use this code as context.`)
}

interface AnalyseArgs {
  path: string
  pushUrl?: string
  project?: string
  token?: string
  noExit: boolean
  skipIgnores: boolean
  printFingerprints: boolean
  junit?: string
  format: 'text' | 'sarif' | 'json'
  output?: string
  changedSince?: string
}

function parseAnalyseArgs(argv: string[]): AnalyseArgs {
  const positional: string[] = []
  let pushUrl: string | undefined
  let project: string | undefined
  let noExit = false
  let skipIgnores = false
  let printFingerprints = false
  let junit: string | undefined
  let token: string | undefined
  let format: 'text' | 'sarif' | 'json' = 'text'
  let output: string | undefined
  let changedSince: string | undefined

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--push') pushUrl = argv[++i]
    else if (arg === '--project') project = argv[++i]
    else if (arg === '--token') token = argv[++i]
    else if (arg === '--no-exit') noExit = true
    else if (arg === '--no-ignore') skipIgnores = true
    else if (arg === '--print-fingerprints') printFingerprints = true
    else if (arg === '--junit') junit = argv[++i]
    else if (arg === '--format') {
      const f = argv[++i]
      if (f !== 'text' && f !== 'sarif' && f !== 'json') { console.error('--format must be text, sarif or json'); process.exit(2) }
      format = f
    }
    else if (arg === '--output') output = argv[++i]
    else if (arg === '--changed-since') changedSince = argv[++i]
    else positional.push(arg)
  }

  return { path: positional[0] ?? './e2e', pushUrl, project, token, noExit, skipIgnores, printFingerprints, junit, format, output, changedSince }
}

async function runAnalyse(argv: string[]): Promise<void> {
  const args = parseAnalyseArgs(argv)
  const absolutePath = path.resolve(process.cwd(), args.path)

  const machine = args.format !== 'text'
  // machine-readable output goes to stdout when no --output: keep logs on stderr
  const log = machine && !args.output ? console.error : console.log
  const realLog = console.log
  if (machine && !args.output) console.log = console.error

  log(`\nTestpulse — analyzing ${absolutePath}\n`)

  const outcome = await analyzeDirectory(absolutePath, { skipIgnores: args.skipIgnores })

  if (args.changedSince) {
    const changed = changedFileSet(args.changedSince, absolutePath)
    outcome.results = outcome.results.filter(r => changed.has(r.file))
    log(`Changed since ${args.changedSince}: ${outcome.results.length} analysed file(s) in diff\n`)
  }

  const summary = reporter(outcome.results, {
    suppressed: outcome.suppressed,
    staleIgnoreFingerprints: outcome.staleIgnoreFingerprints,
    showFingerprints: args.printFingerprints
  })
  console.log = realLog

  if (machine) {
    const doc = args.format === 'sarif'
      ? toSarif(outcome.results, absolutePath)
      : toJson(outcome.results, absolutePath, summary.score)
    const text = JSON.stringify(doc, null, 2)
    if (args.output) {
      writeFileSync(args.output, text)
      console.log(`Wrote ${args.format} report to ${args.output}`)
    } else {
      process.stdout.write(text + '\n')
    }
  }

  let scenarioResults: Awaited<ReturnType<typeof loadJunitResults>>['results'] = []
  if (args.junit) {
    const junit = await loadJunitResults(process.cwd(), args.junit)
    scenarioResults = junit.results
    const passed = scenarioResults.filter(s => s.status === 'pass').length
    const failed = scenarioResults.filter(s => s.status === 'fail' || s.status === 'error').length
    const skipped = scenarioResults.filter(s => s.status === 'skip').length
    console.log(`JUnit: ${junit.files.length} file(s) parsed — ${scenarioResults.length} scenarios (${passed} pass, ${failed} fail, ${skipped} skip)\n`)
  }

  if (args.pushUrl) {
    if (!args.project) {
      console.error('--push requires --project <slug>')
      process.exit(2)
    }
    try {
      await pushRun(outcome.results, summary, {
        url: args.pushUrl,
        projectSlug: args.project,
        endpoints: outcome.endpoints,
        scenarioResults,
        token: args.token
      })
    } catch (err) {
      console.error(err instanceof Error ? err.message : err)
      process.exit(2)
    }
  }

  if (summary.critical > 0 && !args.noExit) process.exit(1)
}

const raw = process.argv.slice(2)
if (raw[0] === '--help' || raw[0] === '-h') {
  console.log(USAGE)
  process.exit(0)
}
if (raw[0] === 'judge') {
  await runJudge(raw.slice(1))
} else if (raw[0] === 'judge-eval') {
  await runJudgeEval(raw.slice(1))
} else if (raw[0] === 'security-coverage') {
  await runSecurityCoverage(raw.slice(1))
} else if (raw[0] === 'ingest-openapi') {
  await runIngestOpenApi(raw.slice(1))
} else if (raw[0] === 'ingest-docs') {
  await runIngestDocs(raw.slice(1))
} else if (raw[0] === 'scan-codebase') {
  await runScanCodebase(raw.slice(1))
} else {
  await runAnalyse(raw)
}
