#!/usr/bin/env node
import path from 'path'
import { analyzeDirectory } from './analyzer.js'
import { reporter } from './reporter/index.js'
import { pushRun } from './pusher.js'
import { parseOpenApiFile } from './openapi.js'
import { loadJunitResults } from './junit.js'

const USAGE = `Usage: testpulse <path> [options]          analyse a directory
       testpulse ingest-openapi <file> [options]  upload an OpenAPI spec as coverage targets

Analyse options:
  --push <api-url>         POST results to a Testpulse API
  --project <slug>         project slug (required with --push / ingest-openapi)
  --no-exit                don't exit 1 on critical issues
  --no-ignore              ignore .testpulse/ignores.json (show everything)
  --print-fingerprints     show each issue's fingerprint inline
  --junit <glob>           parse JUnit XML result files and push per-scenario pass/fail

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

interface AnalyseArgs {
  path: string
  pushUrl?: string
  project?: string
  token?: string
  noExit: boolean
  skipIgnores: boolean
  printFingerprints: boolean
  junit?: string
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

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--push') pushUrl = argv[++i]
    else if (arg === '--project') project = argv[++i]
    else if (arg === '--token') token = argv[++i]
    else if (arg === '--no-exit') noExit = true
    else if (arg === '--no-ignore') skipIgnores = true
    else if (arg === '--print-fingerprints') printFingerprints = true
    else if (arg === '--junit') junit = argv[++i]
    else positional.push(arg)
  }

  return { path: positional[0] ?? './e2e', pushUrl, project, token, noExit, skipIgnores, printFingerprints, junit }
}

async function runAnalyse(argv: string[]): Promise<void> {
  const args = parseAnalyseArgs(argv)
  const absolutePath = path.resolve(process.cwd(), args.path)

  console.log(`\nTestpulse — analyzing ${absolutePath}\n`)

  const outcome = await analyzeDirectory(absolutePath, { skipIgnores: args.skipIgnores })
  const summary = reporter(outcome.results, {
    suppressed: outcome.suppressed,
    staleIgnoreFingerprints: outcome.staleIgnoreFingerprints,
    showFingerprints: args.printFingerprints
  })

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
if (raw[0] === 'ingest-openapi') {
  await runIngestOpenApi(raw.slice(1))
} else {
  await runAnalyse(raw)
}
