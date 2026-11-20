// Runs the built binary (dist/index.js) as a user would. `pnpm test` builds first.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'child_process'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'
import { cliRoot, corpus, repoRoot } from './helpers.js'

const bin = path.join(cliRoot, 'dist', 'index.js')
const run = (args: string[], env: NodeJS.ProcessEnv = {}) => {
  const r = spawnSync(process.execPath, [bin, ...args], { encoding: 'utf-8', env: { ...process.env, ANTHROPIC_API_KEY: '', ...env }, timeout: 60_000 })
  return { code: r.status, out: r.stdout, err: r.stderr }
}
const bookings = ['security-coverage', path.join(corpus, 'ai-generated', 'bookings', 'tests'), '--openapi', path.join(corpus, 'ai-generated', 'bookings', 'openapi.yaml')]

test('--version matches package.json; --help lists the commands', async () => {
  const pkg = JSON.parse(await readFile(path.join(cliRoot, 'package.json'), 'utf-8'))
  assert.equal(run(['--version']).out.trim(), pkg.version)
  const help = run(['--help']).out
  for (const c of ['security-coverage', 'ai-coverage', 'audit-mcp', 'judge', '--format', '--changed-since']) assert.ok(help.includes(c), c)
})

test('exit code: 1 on critical issues, 0 with --no-exit or on a clean suite', async () => {
  const dir = path.join(corpus, 'ai-slop')
  assert.equal(run([dir]).code, 1)
  assert.equal(run([dir, '--no-exit']).code, 0)
  const clean = await mkdtemp(path.join(os.tmpdir(), 'tp-clean-'))
  try {
    await writeFile(path.join(clean, 'ok.spec.ts'), `import { test, expect } from '@playwright/test'\ntest('adds numbers correctly', async () => { expect(1 + 1).toBe(2) })\n`)
    const r = run([clean])
    assert.equal(r.code, 0, r.out)
    assert.match(r.out, /Quality score: 100\/100/)
  } finally { await rm(clean, { recursive: true, force: true }) }
})

test('--format json and sarif write clean machine-readable output', async () => {
  const dir = path.join(corpus, 'ai-slop')
  const j = run([dir, '--format', 'json', '--no-exit', '--junit', 'nothing/*.xml'])
  const doc = JSON.parse(j.out) // would throw if any log line leaked into stdout
  assert.equal(typeof doc.score, 'number'); assert.ok(doc.files.length >= 2)
  const s = JSON.parse(run([dir, '--format', 'sarif', '--no-exit']).out)
  assert.equal(s.version, '2.1.0'); assert.ok(s.runs[0].results.length > 10)
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'tp-sarif-'))
  try {
    const out = path.join(tmp, 'o.sarif')
    assert.equal(run([dir, '--format', 'sarif', '--output', out, '--no-exit']).code, 0)
    assert.equal(JSON.parse(await readFile(out, 'utf-8')).version, '2.1.0')
  } finally { await rm(tmp, { recursive: true, force: true }) }
})

test('--changed-since rejects anything that is not a plain git ref', () => {
  for (const bad of ['x;touch pwned', '$(id)', '--upload-pack=x', 'a b']) {
    const r = run([path.join(corpus, 'ai-slop'), '--changed-since', bad])
    assert.equal(r.code, 2, bad)
    assert.match(r.err, /invalid git ref/)
  }
})

test('security-coverage: matrix, json, and the CI gates', () => {
  const text = run(bookings)
  assert.equal(text.code, 0); assert.match(text.out, /Security coverage: 45%/); assert.match(text.out, /BOLA/)
  assert.equal(JSON.parse(run([...bookings, '--format', 'json']).out).coveragePct, 45)
  assert.equal(run([...bookings, '--fail-on', 'critical']).code, 1, 'a critical gap fails the gate')
  assert.equal(run([...bookings, '--min-coverage', '60']).code, 1)
  assert.equal(run([...bookings, '--min-coverage', '40']).code, 0)
  assert.equal(run([...bookings, '--min-coverage', '150']).code, 2, 'invalid threshold is a usage error')
  assert.equal(run(['security-coverage', corpus]).code, 2, 'missing --openapi')
})

test('judge refuses to run without a key and does not pass a gate when the API is unreachable', () => {
  const none = run(['judge', path.join(corpus, 'ai-slop')])
  assert.equal(none.code, 2); assert.match(none.err, /ANTHROPIC_API_KEY/)
  const down = run(['judge', path.join(corpus, 'ai-slop'), '--min-score', '3', '--max-files', '1', '--no-cache'], { ANTHROPIC_API_KEY: 'x', TESTPULSE_JUDGE_BASE_URL: 'http://127.0.0.1:9' })
  assert.equal(down.code, 2, 'an unreachable judge must not look like a pass')
})

test('ai-coverage gates on critical gaps and ignores non-LLM suites', () => {
  assert.equal(run(['ai-coverage', path.join(corpus, 'ai-app'), '--fail-on', 'critical']).code, 1)
  const plain = run(['ai-coverage', path.join(repoRoot, 'examples'), '--fail-on', 'critical'])
  assert.equal(plain.code, 0); assert.match(plain.out, /No LLM usage detected/)
})

test('audit-mcp: usage error without a target, failure when the server cannot start', () => {
  assert.equal(run(['audit-mcp']).code, 2)
  const r = run(['audit-mcp', '--stdio', 'definitely-not-a-real-command-xyz'])
  assert.equal(r.code, 2); assert.match(r.err, /audit-mcp failed/)
})
