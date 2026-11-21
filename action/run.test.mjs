import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { main, parseInputs } from './run.mjs'

const report = (score, criticals) => ({ score, files: [{ file: 'a.spec.ts', issues: [...Array(criticals).fill({ rule: 'no-assertion', severity: 'critical' }), { rule: 'x', severity: 'warning' }] }] })

/** Fake runner: records every call, answers npm install, and writes the JSON report when asked to. */
function fakes({ score = 80, criticals = 0, installCode = 0 } = {}) {
  const calls = []
  const run = (cmd, args) => {
    calls.push({ cmd, args })
    if (cmd === 'npm') return { code: installCode, stdout: '', stderr: installCode ? 'E404 not found' : '' }
    const o = args.indexOf('--output')
    if (o >= 0) { writeFileSync(args[o + 1], JSON.stringify(report(score, criticals))); return { code: 0, stdout: '', stderr: '' } }
    return { code: 0, stdout: `Quality score: ${score}/100\n`, stderr: '' }
  }
  const lines = []
  const files = new Map()
  const write = (f, t) => files.set(f, (files.get(f) ?? '') + t)
  return { calls, lines, files, deps: { run, out: l => lines.push(l), write, tmp: mkdtempSync(path.join(os.tmpdir(), 'tp-act-')) } }
}

test('inputs are validated: option injection, bad numbers, bad refs, bad versions, half-configured push', () => {
  assert.throws(() => parseInputs({ TP_PATH: '--evil' }), /must not start/)
  for (const bad of ['abc', '101', '-1', '1.5']) assert.throws(() => parseInputs({ TP_MIN_SCORE: bad }), /min-score/, bad)
  for (const bad of ['$(id)', 'a;b', 'x y']) assert.throws(() => parseInputs({ TP_CHANGED_SINCE: bad }), /plain git ref/, bad)
  for (const bad of ['1.0.0; rm -rf /', '$(x)', 'a b']) assert.throws(() => parseInputs({ TP_VERSION: bad }), /testpulse-version/, bad)
  assert.throws(() => parseInputs({ TP_API_URL: 'https://x.example' }), /together/)
  assert.throws(() => parseInputs({ TP_API_URL: 'http://x.example', TP_PROJECT: 'p' }), /https/)
  assert.deepEqual([parseInputs({}).path, parseInputs({}).failOnCritical, parseInputs({}).version], ['.', true, '~0.3.0'])
  assert.equal(parseInputs({ TP_VERSION: 'latest' }).version, 'latest')
})

test('invalid input fails the run before anything is installed or executed', async () => {
  const f = fakes()
  const s = await main({ TP_MIN_SCORE: 'abc' }, f.deps)
  assert.equal(s.exitCode, 1); assert.equal(f.calls.length, 0)
  assert.ok(f.lines.some(l => l.startsWith('::error::') && l.includes('min-score')))
})

test('clean run: installs the requested version, exposes score/critical, writes summary and outputs, exits 0', async () => {
  const f = fakes({ score: 92, criticals: 0 })
  const env = { TP_PATH: 'e2e', TP_VERSION: '^0.2', GITHUB_OUTPUT: '/out', GITHUB_STEP_SUMMARY: '/sum' }
  const s = await main(env, f.deps)
  assert.equal(s.exitCode, 0)
  assert.deepEqual(s.outputs, { score: '92', critical: '0' })
  assert.deepEqual(f.calls[0].args.slice(-1), ['testpulse@^0.2'])
  assert.match(f.files.get('/out'), /score=92\ncritical=0\n/)
  assert.match(f.files.get('/sum'), /quality score 92\/100/)
})

test('gating: fail-on-critical (default on, can be turned off) and min-score', async () => {
  assert.equal((await main({}, fakes({ criticals: 2 }).deps)).exitCode, 1)
  assert.equal((await main({ TP_FAIL_ON_CRITICAL: 'false' }, fakes({ criticals: 2 }).deps)).exitCode, 0)
  assert.equal((await main({ TP_MIN_SCORE: '70', TP_FAIL_ON_CRITICAL: 'false' }, fakes({ score: 60 }).deps)).exitCode, 1)
  assert.equal((await main({ TP_MIN_SCORE: '70', TP_FAIL_ON_CRITICAL: 'false' }, fakes({ score: 70 }).deps)).exitCode, 0)
})

test('install failure is reported, not swallowed', async () => {
  const f = fakes({ installCode: 1 })
  const s = await main({ TP_VERSION: '9.9.9' }, f.deps)
  assert.equal(s.exitCode, 1)
  assert.ok(f.lines.some(l => l.includes('could not install testpulse@9.9.9')))
})

test('--push goes only on the text run (never duplicated by the json/sarif runs); the token stays out of argv', async () => {
  const f = fakes()
  await main({ TP_API_URL: 'https://tp.example', TP_PROJECT: 'proj', TP_TOKEN: 'secret-token', TP_UPLOAD_SARIF: 'true', TP_CHANGED_SINCE: 'origin/main', TP_JUNIT: 'r/*.xml' }, f.deps)
  const cliCalls = f.calls.filter(c => c.cmd !== 'npm')
  const pushes = cliCalls.filter(c => c.args.includes('--push'))
  assert.equal(pushes.length, 1)
  assert.deepEqual(pushes[0].args.slice(pushes[0].args.indexOf('--push')), ['--push', 'https://tp.example', '--project', 'proj', '--no-exit'])
  for (const c of cliCalls) { assert.ok(c.args.includes('--changed-since') && c.args.includes('--junit')); assert.ok(!c.args.some(a => a.includes('secret-token'))) }
  assert.equal(cliCalls.length, 3)
  assert.ok(cliCalls.some(c => c.args.includes('sarif')))
})

test('PR comment is created once and then updated in place; read-only tokens only warn', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tp-ev-'))
  const event = path.join(dir, 'event.json'); writeFileSync(event, JSON.stringify({ pull_request: { number: 7 } }))
  const env = { GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: event, GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'o/r' }
  const calls = []
  const mk = (existing, writeStatus = 201) => async (url, opts = {}) => {
    calls.push({ url, method: opts.method ?? 'GET', body: opts.body })
    if (!opts.method) return { ok: true, status: 200, json: async () => existing }
    return { ok: writeStatus < 300, status: writeStatus, json: async () => ({}) }
  }
  let f = fakes()
  await main(env, { ...f.deps, fetch: mk([]) })
  assert.deepEqual(calls.map(c => c.method), ['GET', 'POST'])
  assert.match(calls[1].body, /testpulse-report/)
  calls.length = 0; f = fakes()
  await main(env, { ...f.deps, fetch: mk([{ id: 99, body: '<!-- testpulse-report -->\nold' }]) })
  assert.deepEqual(calls.map(c => `${c.method} ${c.url.split('/').slice(-2).join('/')}`), ['GET 7/comments?per_page=100', 'PATCH comments/99'])
  calls.length = 0; f = fakes()
  const forked = await main(env, { ...f.deps, fetch: async () => ({ ok: false, status: 403, json: async () => ({}) }) })
  assert.equal(forked.exitCode, 0, 'a read-only fork token must not fail the check')
  assert.ok(f.lines.some(l => l.startsWith('::warning::')))
  calls.length = 0; f = fakes()
  await main({ ...env, TP_COMMENT_ON_PR: 'false' }, { ...f.deps, fetch: mk([]) })
  assert.equal(calls.length, 0)
  await main({ ...env, GITHUB_EVENT_NAME: 'push' }, { ...fakes().deps, fetch: mk([]) })
  assert.equal(calls.length, 0, 'no comment outside pull requests')
})
