#!/usr/bin/env node
import path from 'path'
import { execFileSync } from 'child_process'
import { writeFileSync } from 'fs'
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
    if (!/^[A-Za-z0-9_./~^@-]+$/.test(args.changedSince)) {
      console.error('--changed-since: invalid git ref')
      process.exit(2)
    }
    try {
      const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: absolutePath, encoding: 'utf-8' }).trim()
      const diff = execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMR', `${args.changedSince}...HEAD`], { cwd: top, encoding: 'utf-8' })
      const changed = new Set(diff.split('\n').filter(Boolean).map(f => path.resolve(top, f)))
      outcome.results = outcome.results.filter(r => changed.has(r.file))
      log(`Changed since ${args.changedSince}: ${outcome.results.length} analysed file(s) in diff\n`)
    } catch (err) {
      console.error(`--changed-since failed (is "${args.changedSince}" fetched? CI needs fetch-depth: 0): ${err instanceof Error ? err.message.split('\n')[0] : err}`)
      process.exit(2)
    }
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
if (raw[0] === 'security-coverage') {
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
