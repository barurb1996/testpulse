#!/usr/bin/env node
import { analyzeDirectory } from './analyzer.js'
import { reporter } from './reporter/index.js'
import path from 'path'

const targetDir = process.argv[2] ?? './e2e'
const absolutePath = path.resolve(process.cwd(), targetDir)

console.log(`\nTestpulse — analyzing ${absolutePath}\n`)

const results = await analyzeDirectory(absolutePath)
reporter(results)
