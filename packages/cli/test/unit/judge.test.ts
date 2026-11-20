import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import http from 'http'
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'
import { callJudge } from '../../src/judge/client.js'
import { judgeFile } from '../../src/judge/index.js'

let server: http.Server
let base = ''
let mode: 'ok' | 'flaky' | 'unauthorized' | 'garbage' = 'ok'
let hits = 0
const received: string[] = []

before(async () => {
  server = http.createServer((req, res) => {
    let body = ''
    req.on('data', c => (body += c))
    req.on('end', () => {
      hits++
      received.push(body)
      res.setHeader('content-type', 'application/json')
      if (mode === 'unauthorized') { res.statusCode = 401; return res.end(JSON.stringify({ error: { message: 'invalid x-api-key' } })) }
      if (mode === 'flaky' && hits < 3) { res.statusCode = 529; return res.end('{}') }
      if (mode === 'garbage') return res.end(JSON.stringify({ content: [{ type: 'text', text: 'hi' }] }))
      const text = JSON.parse(body).messages[0].content as string
      const names = [...text.matchAll(/^- "(.+)" \(line \d+\)$/gm)].map(m => m[1])
      res.end(JSON.stringify({ content: [{ type: 'tool_use', name: 'report_evaluations', input: { evaluations: [
        ...names.map(n => ({ test_name: n, score: 2, verifies_stated_behavior: 'partly', would_catch_regression: false, missing_cases: [], reasoning: 'r' })),
        { test_name: 'bad score', score: 9, verifies_stated_behavior: 'no', would_catch_regression: false, missing_cases: [], reasoning: 'out of range' }
      ] } }] }))
    })
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
after(() => new Promise<void>(r => server.close(() => r())))

const opts = () => ({ apiKey: 'sk-test', model: 'm', baseUrl: base })

test('judge client: structured result, out-of-range scores dropped', async () => {
  mode = 'ok'; hits = 0
  const evals = await callJudge('<tests_to_evaluate>\n- "my test" (line 3)\n</tests_to_evaluate>', opts())
  assert.deepEqual(evals.map(e => e.test_name), ['my test'])
})

test('judge client: retries transient 5xx/529, fails fast on 401 without echoing the request', async () => {
  mode = 'flaky'; hits = 0
  assert.equal((await callJudge('- "t" (line 1)', opts())).length, 1)
  assert.equal(hits, 3)
  mode = 'unauthorized'; hits = 0
  await assert.rejects(() => callJudge('SECRET-TEST-CODE-TOKEN', opts()), (e: Error) => /401/.test(e.message) && !e.message.includes('SECRET-TEST-CODE-TOKEN'))
  assert.equal(hits, 1, 'no retry on an auth error')
  mode = 'garbage'
  await assert.rejects(() => callJudge('x', opts()), /structured/)
})

test('judgeFile: secrets are redacted before sending, results are cached by content', async () => {
  mode = 'ok'
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tp-judge-'))
  try {
    const f = path.join(dir, 'a.spec.ts')
    await writeFile(f, `import { test, expect } from '@playwright/test'\nconst key = 'AKIAIOSFODNN7EXAMPLQ'\ntest('uses key', async () => { expect(key).toBeDefined() })\n`)
    const cacheDir = path.join(dir, 'cache')
    await mkdir(cacheDir)
    received.length = 0; hits = 0
    const first = await judgeFile(f, [], { ...opts(), cacheDir })
    assert.equal(first!.cached, false)
    assert.equal(first!.evaluations[0].line, 3)
    assert.ok(received.length === 1 && !received[0].includes('AKIAIOSFODNN7EXAMPLQ') && received[0].includes('[REDACTED]'))
    const second = await judgeFile(f, [], { ...opts(), cacheDir })
    assert.equal(second!.cached, true); assert.equal(hits, 1, 'second run served from cache')
  } finally { await rm(dir, { recursive: true, force: true }) }
})
