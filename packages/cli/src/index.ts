#!/usr/bin/env node
import path from 'path'
import { analyzeDirectory } from './analyzer.js'
import { reporter } from './reporter/index.js'
import { pushRun } from './pusher.js'

interface Args {
  path: string
  pushUrl?: string
  project?: string
  noExit: boolean
  skipIgnores: boolean
  printFingerprints: boolean
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = []
  let pushUrl: string | undefined
  let project: string | undefined
  let noExit = false
  let skipIgnores = false
  let printFingerprints = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--push') pushUrl = argv[++i]
    else if (arg === '--project') project = argv[++i]
    else if (arg === '--no-exit') noExit = true
    else if (arg === '--no-ignore') skipIgnores = true
    else if (arg === '--print-fingerprints') printFingerprints = true
    else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: testpulse <path> [options]

Options:
  --push <api-url>         POST results to a Testpulse API
  --project <slug>         project slug (required with --push)
  --no-exit                don't exit 1 on critical issues
  --no-ignore              ignore .testpulse/ignores.json (show everything)
  --print-fingerprints     show each issue's fingerprint inline
  -h, --help               print usage

Config files (project root):
  .testpulse/ignores.json  list of { fingerprint, rule?, reason? } to suppress
  .testpulse/config.json   { rules?: {<name>: "off" | { off?, severity? }},
                             ignoreFiles?: [<glob>, ...] }`)
      process.exit(0)
    } else positional.push(arg)
  }

  return { path: positional[0] ?? './e2e', pushUrl, project, noExit, skipIgnores, printFingerprints }
}

const args = parseArgs(process.argv.slice(2))
const absolutePath = path.resolve(process.cwd(), args.path)

console.log(`\nTestpulse — analyzing ${absolutePath}\n`)

const outcome = await analyzeDirectory(absolutePath, { skipIgnores: args.skipIgnores })
const summary = reporter(outcome.results, {
  suppressed: outcome.suppressed,
  staleIgnoreFingerprints: outcome.staleIgnoreFingerprints,
  showFingerprints: args.printFingerprints
})

if (args.pushUrl) {
  if (!args.project) {
    console.error('--push requires --project <slug>')
    process.exit(2)
  }
  try {
    await pushRun(outcome.results, summary, { url: args.pushUrl, projectSlug: args.project })
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    process.exit(2)
  }
}

if (summary.critical > 0 && !args.noExit) process.exit(1)
