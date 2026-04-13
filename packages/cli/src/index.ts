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
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = []
  let pushUrl: string | undefined
  let project: string | undefined
  let noExit = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--push') pushUrl = argv[++i]
    else if (arg === '--project') project = argv[++i]
    else if (arg === '--no-exit') noExit = true
    else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: testpulse <path> [--push <api-url>] [--project <slug>] [--no-exit]`)
      process.exit(0)
    } else positional.push(arg)
  }

  return { path: positional[0] ?? './e2e', pushUrl, project, noExit }
}

const args = parseArgs(process.argv.slice(2))
const absolutePath = path.resolve(process.cwd(), args.path)

console.log(`\nTestpulse — analyzing ${absolutePath}\n`)

const results = await analyzeDirectory(absolutePath)
const summary = reporter(results)

if (args.pushUrl) {
  if (!args.project) {
    console.error('--push requires --project <slug>')
    process.exit(2)
  }
  try {
    await pushRun(results, summary, { url: args.pushUrl, projectSlug: args.project })
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    process.exit(2)
  }
}

if (summary.critical > 0 && !args.noExit) process.exit(1)
