import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'path'
import { corpus } from './helpers.js'
import { analyzeDirectory } from '../../src/analyzer.js'
import { parseOpenApiFile, type OpenApiTarget } from '../../src/openapi.js'
import { computeSecurityCoverage, normaliseTestPath } from '../../src/security/coverage.js'
import { classifyOutcome } from '../../src/security/classify.js'
import { extractPlaywrightEndpoints } from '../../src/parsers/playwright-api.js'
import type { EndpointCoverage } from '../../src/types.js'

const call = (verb: string, p: string, kinds: EndpointCoverage['kinds'] = ['happy']): EndpointCoverage =>
  ({ verb, path: p, file: 'f', line: 1, scenarioName: 's', via: 'direct', kinds, status: 200 })
const op = (verb: string, p: string, extra: Partial<OpenApiTarget> = {}): OpenApiTarget => ({ verb, path: p, secured: true, responseCodes: ['200', '401', '403'], ...extra })

test('classifyOutcome', () => {
  assert.deepEqual(classifyOutcome({ status: 401, scenarioName: 'x', contextText: '' }), ['unauth'])
  assert.deepEqual(classifyOutcome({ status: 403, scenarioName: 'forbidden for viewer', contextText: 'Authorization: Bearer t' }), ['forbidden'])
  assert.deepEqual(classifyOutcome({ status: 404, scenarioName: 'other user cannot read my order', contextText: '' }), ['cross-user'])
  assert.deepEqual(classifyOutcome({ status: 404, scenarioName: 'missing order', contextText: '' }), [])
  assert.deepEqual(classifyOutcome({ status: 422, scenarioName: 'x', contextText: '' }), ['invalid-input'])
  assert.deepEqual(classifyOutcome({ status: 201, scenarioName: 'x', contextText: '' }), ['happy'])
})

test('normaliseTestPath folds ids, hosts and query strings', () => {
  assert.equal(normaliseTestPath('https://api.x.io/v1/orders/123?x=1'), '/v1/orders/:id')
  assert.equal(normaliseTestPath('/orders/0b9f5f7e-1c1d-4f3a-9d7e-5f0f2a3b4c5d/'), '/orders/:id')
  assert.equal(normaliseTestPath('orders/{orderId}'), '/orders/:id')
})

test('each call is credited to one operation; a nested route never inflates a shorter one', () => {
  const targets = [op('POST', '/orders'), op('POST', '/users/:id/orders')]
  const r = computeSecurityCoverage(targets, [call('POST', '/users/:id/orders', ['unauth'])])
  const orders = r.rows.find(x => x.path === '/orders')!
  const nested = r.rows.find(x => x.path === '/users/:id/orders')!
  assert.equal(orders.covered.unauth, false)
  assert.equal(nested.covered.unauth, true)
})

test('base paths from /api, /vN and the spec servers entry are tolerated, arbitrary prefixes are not', () => {
  const t = op('GET', '/items', { basePath: '/inventory/v2' })
  for (const p of ['/items', '/api/items', '/api/v1/items', '/v3/items', '/inventory/v2/items'])
    assert.equal(computeSecurityCoverage([t], [call('GET', p)]).rows[0].testedAt.length, 1, p)
  assert.equal(computeSecurityCoverage([t], [call('GET', '/admin/items')]).rows[0].testedAt.length, 0)
})

test('applicability and risk ordering of gaps', () => {
  const t = [
    op('GET', '/health', { secured: false, responseCodes: ['200'] }),
    op('DELETE', '/items/:id', { hasObjectId: true }),
    op('POST', '/items', { constrainedInputs: ['body.sku'] })
  ]
  const r = computeSecurityCoverage(t, [call('GET', '/health'), call('GET', '/admin/purge')])
  const checks = r.gaps.map(g => `${g.check}:${g.verb} ${g.path}`)
  assert.ok(!checks.some(c => c.includes('/health')), 'public endpoint needs no auth tests')
  assert.ok(checks.includes('missing-object-level-authz-test:DELETE /items/:id'))
  assert.ok(checks.includes('missing-input-validation-test:POST /items'))
  assert.ok(checks.includes('undocumented-endpoint-tested:GET /admin/purge'))
  assert.equal(r.gaps[0].severity, 'critical', 'highest risk first')
  assert.equal(r.gaps.at(-1)!.severity, 'info')
})

test('Playwright: negated status assertions are not counted as tests of that status', () => {
  const src = `import { test, expect } from '@playwright/test'
test('a', async ({ request }) => { const r = await request.get('/orders/1'); expect(r.status()).not.toBe(401) })
test('b', async ({ request }) => { const r = await request.get('/orders/2'); expect(r.status()).toBe(401) })`
  const calls = extractPlaywrightEndpoints(src, 'x.spec.ts')
  assert.equal(calls.find(c => c.path === '/orders/1')!.status, null)
  assert.deepEqual(calls.find(c => c.path === '/orders/2')!.kinds, ['unauth'])
})

test('Playwright: a leading ${BASE_URL} is a base, template ids become :id', () => {
  const src = "import { test } from '@playwright/test'\ntest('t', async ({ request }) => { await request.get(`${BASE_URL}/bookings/${id}`) })"
  assert.equal(extractPlaywrightEndpoints(src, 'x.spec.ts')[0].path, '/bookings/:id')
})

test('OpenAPI parsing: security inheritance, public overrides, object ids, constraints', async () => {
  const targets = await parseOpenApiFile(path.join(corpus, 'security-coverage', 'openapi.yaml'))
  const get = (v: string, p: string) => targets.find(t => t.verb === v && t.path === p)!
  assert.equal(get('GET', '/health').secured, false)
  assert.equal(get('POST', '/bookings').secured, true)
  assert.equal(get('GET', '/bookings/:id').hasObjectId, true)
  assert.ok(get('POST', '/bookings').constrainedInputs!.length > 0)
  assert.ok(get('POST', '/bookings').responseCodes!.includes('403'))
})

test('Karate multi-argument paths are extracted (path "a", var, "b")', async () => {
  const out = await analyzeDirectory(path.join(corpus, 'ai-generated', 'holdout', 'tickets', 'tests'), { skipIgnores: true })
  assert.ok(out.endpoints.some(e => e.path === '/tickets/:id/comments' && (e.kinds ?? []).includes('unauth')))
})

// Golden numbers: these move only when a rule or the matcher changes on purpose. Update them deliberately, with VALIDATION.md.
const GOLDEN: Array<[string, number]> = [
  ['ai-generated/bookings', 45], ['ai-generated/bookstore', 59], ['ai-generated/users', 25],
  ['ai-generated/holdout/inventory', 62], ['ai-generated/holdout/tickets', 67], ['security-coverage', 50]
]
for (const [proj, pct] of GOLDEN) {
  test(`golden security coverage: ${proj} = ${pct}%`, async () => {
    const dir = path.join(corpus, proj)
    const spec = proj === 'security-coverage' ? path.join(dir, 'openapi.yaml') : path.join(dir, 'openapi.yaml')
    const tests = proj === 'security-coverage' ? path.join(dir, 'tests') : path.join(dir, 'tests')
    const outcome = await analyzeDirectory(tests, { skipIgnores: true })
    const report = computeSecurityCoverage(await parseOpenApiFile(spec), outcome.endpoints)
    assert.equal(report.coveragePct, pct)
  })
}
