// Precision/recall against independently labelled AI-written tests (see docs/VALIDATION.md).
// This is a regression guard: recall must not drop and false positives must not grow.
// If a change legitimately moves the numbers, update BASELINE together with VALIDATION.md.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'fs/promises'
import path from 'path'
import { corpus } from './helpers.js'
import { analyzeDirectory } from '../../src/analyzer.js'

interface Label { file: string; name: string; line: number; slop: boolean; problems: string[] }
const IGNORED = new Set(['no-css-selector', 'no-generic-name', 'karate-print-in-test'])

async function evaluate(labelsFile: string, exclude: string[] = []) {
  const labels = JSON.parse(await readFile(path.join(corpus, 'ai-generated', labelsFile), 'utf-8')) as Label[]
  const flagged = new Map<string, Set<string>>()
  for (const proj of new Set(labels.map(l => l.file.split('/tests/')[0]))) {
    const dir = path.join(corpus, 'ai-generated', proj)
    const out = await analyzeDirectory(dir, { skipIgnores: true })
    for (const res of out.results) {
      const rel = `${proj}/${path.relative(dir, res.file).replace(/\\/g, '/')}`
      const tests = labels.filter(l => l.file === rel).sort((a, b) => a.line - b.line)
      for (const issue of res.issues) {
        if (IGNORED.has(issue.rule) || exclude.includes(issue.rule)) continue
        const owner = [...tests].reverse().find(t => t.line <= issue.line)
        if (owner) { const k = `${owner.file}#${owner.name}#${owner.line}`; flagged.set(k, (flagged.get(k) ?? new Set()).add(issue.rule)) }
      }
    }
  }
  let tp = 0, fp = 0, fn = 0
  for (const l of labels) {
    const hit = flagged.has(`${l.file}#${l.name}#${l.line}`)
    if (l.slop && hit) tp++; else if (l.slop) fn++; else if (hit) fp++
  }
  return { tp, fp, fn, total: labels.length, slop: labels.filter(l => l.slop).length }
}

const DUP_HINTS = ['karate-data-variation-duplicate', 'karate-duplicate-scenario', 'copy-paste-variant']

test('labels are well formed and every labelled line exists', async () => {
  for (const f of ['labels.json', 'labels-holdout.json']) {
    const labels = JSON.parse(await readFile(path.join(corpus, 'ai-generated', f), 'utf-8')) as Label[]
    assert.ok(labels.length > 0)
    for (const l of labels) {
      const src = (await readFile(path.join(corpus, 'ai-generated', l.file), 'utf-8')).split('\n')
      assert.ok(/test\(|test\.each|Scenario|for \(|^\s*$/.test(src[l.line - 1] ?? ''), `${l.file}:${l.line} is not a test declaration`)
      assert.equal(l.slop, l.problems.length > 0, `${l.file}:${l.line} slop flag and problems disagree`)
    }
  }
})

test('set 1 (3 projects, 53 tests): every labelled slop test is flagged; false positives do not grow', async () => {
  const r = await evaluate('labels.json')
  assert.equal(r.total, 53); assert.equal(r.slop, 6)
  assert.equal(r.fn, 0, 'recall dropped')
  assert.ok(r.fp <= 6, `false positives grew to ${r.fp}`)
})

test('set 1 without the duplicate-style hints: no false positives at all', async () => {
  const r = await evaluate('labels.json', DUP_HINTS)
  assert.equal(r.fn, 0); assert.equal(r.fp, 0)
})

test('set 2 (2 projects, 67 tests): the labelled slop test is flagged; false positives do not grow', async () => {
  const r = await evaluate('labels-holdout.json')
  assert.equal(r.total, 67); assert.equal(r.slop, 1)
  assert.equal(r.fn, 0, 'recall dropped')
  assert.ok(r.fp <= 7, `false positives grew to ${r.fp}`)
})
