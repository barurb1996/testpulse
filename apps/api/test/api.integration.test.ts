// Integration tests: real Fastify app (buildApp) against a real Postgres.
// Needs TEST_DATABASE_URL pointing at a throwaway database; skipped when it is not set.
import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import path from 'path'
import { fileURLToPath } from 'url'

const url = process.env.TEST_DATABASE_URL
const skip = url ? false : 'TEST_DATABASE_URL is not set'

process.env.DATABASE_URL = url ?? 'postgres://unused:unused@127.0.0.1:1/unused'
process.env.ADMIN_PASSWORD = 'integration-test-password-123'
process.env.ENCRYPTION_KEY = '0'.repeat(63) + '1'
process.env.NODE_ENV = 'test'

const PASSWORD = process.env.ADMIN_PASSWORD
const run = `it${Date.now().toString(36)}`
const slugA = `${run}-a`
const slugB = `${run}-b`

type App = Awaited<ReturnType<typeof import('../src/app.js').buildApp>>
let app: App
let adminToken = ''
let tokenA = ''
let tokenB = ''
let closeDb: () => Promise<void> = async () => {}

const json = { 'content-type': 'application/json' }
const bearer = (t: string) => ({ authorization: `Bearer ${t}` })
async function call(method: string, urlPath: string, opts: { token?: string; body?: unknown; ip?: string } = {}) {
  const res = await app.inject({
    method: method as 'GET',
    url: urlPath,
    headers: { ...(opts.body !== undefined ? json : {}), ...(opts.token ? bearer(opts.token) : {}) },
    payload: opts.body as object | undefined,
    remoteAddress: opts.ip
  })
  let body: any = null
  try { body = res.json() } catch { /* not json */ }
  return { status: res.statusCode, body, headers: res.headers }
}

before(async () => {
  if (skip) return
  const { migrate } = await import('drizzle-orm/node-postgres/migrator')
  const { db, pool } = await import('../src/db/index.js')
  await migrate(db, { migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'drizzle') })
  const { adminSettings } = await import('../src/db/schema.js')
  await db.delete(adminSettings) // start without MFA
  const { buildApp } = await import('../src/app.js')
  app = await buildApp({ logger: false })
  await app.ready()
  closeDb = async () => { await pool.end() }
})

after(async () => {
  if (skip) return
  const { db } = await import('../src/db/index.js')
  const { projects, adminSettings } = await import('../src/db/schema.js')
  const { inArray } = await import('drizzle-orm')
  await db.delete(projects).where(inArray(projects.slug, [slugA, slugB]))
  await db.delete(adminSettings)
  await app.close()
  await closeDb()
})

test('anonymous requests are rejected and /health stays open', { skip }, async () => {
  assert.equal((await call('GET', '/health')).status, 200)
  assert.equal((await call('GET', '/api/projects')).status, 401)
  assert.equal((await call('GET', `/api/projects/${slugA}/docs`)).status, 401)
  assert.equal((await call('POST', '/api/runs', { body: {} })).status, 401)
  const legacy = await app.inject({ method: 'GET', url: '/api/admin/projects', headers: { 'x-admin-password': PASSWORD } })
  assert.equal(legacy.statusCode, 401, 'the old password header must grant nothing')
})

test('login: wrong password fails, correct password returns a working session', { skip }, async () => {
  const bad = await call('POST', '/api/admin/login', { body: { password: 'nope' } })
  assert.equal(bad.status, 403)
  assert.equal(bad.body.error, 'Invalid credentials')
  const ok = await call('POST', '/api/admin/login', { body: { password: PASSWORD } })
  assert.equal(ok.status, 200)
  assert.match(ok.body.token, /^tps_[0-9a-f]{64}$/)
  adminToken = ok.body.token
  const session = await call('GET', '/api/admin/session', { token: adminToken })
  assert.deepEqual(session.body, { configured: true, authenticated: true })
  assert.equal((await call('GET', '/api/admin/projects', { token: adminToken })).status, 200)
  assert.equal((await call('POST', '/api/admin/logout', { token: 'tps_' + 'a'.repeat(64) })).status, 401, 'a made-up session cannot even log out')
  const second = (await call('POST', '/api/admin/login', { body: { password: PASSWORD } })).body.token
  assert.equal((await call('GET', '/api/admin/projects', { token: second })).status, 200)
  assert.equal((await call('POST', '/api/admin/logout', { token: second })).status, 200)
  assert.equal((await call('GET', '/api/admin/projects', { token: second })).status, 401, 'logout must invalidate the session')
})

test('admin creates projects; project tokens are scoped to their own project', { skip }, async () => {
  const a = await call('POST', '/api/admin/projects', { token: adminToken, body: { slug: slugA, name: 'A' } })
  const b = await call('POST', '/api/admin/projects', { token: adminToken, body: { slug: slugB, name: 'B' } })
  assert.equal(a.status, 201); assert.equal(b.status, 201)
  tokenA = a.body.token; tokenB = b.body.token
  assert.match(tokenA, new RegExp(`^tp_${slugA}_[0-9a-f]{48}$`))
  assert.equal((await call('POST', '/api/admin/projects', { token: adminToken, body: { slug: slugA, name: 'dup' } })).status, 409)

  const payload = { projectSlug: slugA, score: 80, filesScanned: 2, issues: [{ file: 'a.spec.ts', line: 3, rule: 'no-assertion', severity: 'critical', message: 'm' }] }
  const pushed = await call('POST', '/api/runs', { token: tokenA, body: payload })
  assert.equal(pushed.status, 201)
  assert.equal((await call('POST', '/api/runs', { token: tokenA, body: { ...payload, projectSlug: slugB } })).status, 403, 'token A pushing into B')
  assert.equal((await call('POST', '/api/runs', { token: tokenB, body: payload })).status, 403, 'token B pushing into A')

  const runs = await call('GET', `/api/runs?project=${slugA}`, { token: tokenA })
  assert.equal(runs.status, 200); assert.equal(runs.body.runs.length, 1)
  assert.equal((await call('GET', `/api/runs?project=${slugA}`, { token: tokenB })).status, 403)
  const runId = pushed.body.runId
  assert.equal((await call('GET', `/api/runs/${runId}`, { token: tokenA })).status, 200)
  assert.equal((await call('GET', `/api/runs/${runId}`, { token: tokenB })).status, 403, 'reading another project run by id')
  assert.equal((await call('GET', `/api/projects/${slugA}/docs`, { token: tokenA })).status, 200)
  assert.equal((await call('GET', `/api/projects/${slugA}/docs`, { token: tokenB })).status, 403)
})

test('project tokens cannot reach admin-only endpoints', { skip }, async () => {
  for (const [m, u, b] of [
    ['GET', '/api/projects', undefined],
    ['GET', '/api/admin/projects', undefined],
    ['PATCH', `/api/projects/${slugA}`, { name: 'x' }],
    ['PATCH', `/api/projects/${slugA}/repo`, { repoBranch: 'main' }],
    ['POST', `/api/projects/${slugA}/scan`, {}],
    ['POST', `/api/projects/${slugA}/digest/send`, {}]
  ] as const) assert.equal((await call(m, u, { token: tokenA, body: b })).status, 403, `${m} ${u}`)
})

test('outbound and clone targets are validated server-side', { skip }, async () => {
  const hook = await call('PATCH', `/api/projects/${slugA}`, { token: adminToken, body: { slackWebhookUrl: 'https://evil.example.com/x' } })
  assert.equal(hook.status, 400)
  for (const repoUrl of ['file:///etc', 'http://93.184.216.34/r.git', 'https://169.254.169.254/r.git', 'https://u:p@93.184.216.34/r.git']) {
    assert.equal((await call('PATCH', `/api/projects/${slugA}/repo`, { token: adminToken, body: { repoUrl } })).status, 400, repoUrl)
  }
  assert.equal((await call('PATCH', `/api/projects/${slugA}/repo`, { token: adminToken, body: { repoBranch: '--upload-pack=x' } })).status, 400)
  assert.equal((await call('PATCH', `/api/projects/${slugA}/repo`, { token: adminToken, body: { testPath: '../../etc' } })).status, 400)
})

test('stored secrets are encrypted at rest', { skip }, async () => {
  const set = await call('PATCH', `/api/projects/${slugA}/repo`, { token: adminToken, body: { repoToken: 'ghp_plaintext_should_never_hit_the_db' } })
  assert.equal(set.status, 200)
  const { db } = await import('../src/db/index.js')
  const { projects } = await import('../src/db/schema.js')
  const { eq } = await import('drizzle-orm')
  const [row] = await db.select().from(projects).where(eq(projects.slug, slugA))
  assert.ok(row.repoToken && !row.repoToken.includes('ghp_plaintext'), 'repo token must not be stored in clear')
  assert.match(row.repoToken!, /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/)
  const shown = await call('GET', `/api/projects/${slugA}/repo`, { token: adminToken })
  assert.equal(shown.body.hasToken, true)
  assert.ok(!JSON.stringify(shown.body).includes('ghp_'))
})

test('MFA: setup, enable, login needs a code, codes are single-use, setup is refused while enabled', { skip }, async () => {
  const OTPAuth = await import('otpauth')
  const setup = await call('POST', '/api/admin/mfa/setup', { token: adminToken })
  assert.equal(setup.status, 200)
  const totp = OTPAuth.URI.parse(setup.body.otpUri) as import('otpauth').TOTP
  const at = (steps: number) => totp.generate({ timestamp: Date.now() + steps * 30_000 })

  assert.equal((await call('POST', '/api/admin/mfa/enable', { token: adminToken, body: { code: '000000' } })).status, 403)
  assert.equal((await call('POST', '/api/admin/mfa/enable', { token: adminToken, body: { code: at(0) } })).status, 200)
  assert.equal((await call('POST', '/api/admin/mfa/setup', { token: adminToken })).status, 409, 'must not be able to reset MFA with a session alone')

  const noCode = await call('POST', '/api/admin/login', { body: { password: PASSWORD } })
  assert.equal(noCode.status, 401); assert.equal(noCode.body.mfaRequired, true)
  const code = at(0)
  const ok = await call('POST', '/api/admin/login', { body: { password: PASSWORD, code } })
  assert.equal(ok.status, 200)
  assert.equal((await call('POST', '/api/admin/login', { body: { password: PASSWORD, code } })).status, 403, 'replayed code')

  assert.equal((await call('POST', '/api/admin/mfa/disable', { token: ok.body.token, body: {} })).status, 403)
  assert.equal((await call('POST', '/api/admin/mfa/disable', { token: ok.body.token, body: { code: at(1) } })).status, 200)
  adminToken = (await call('POST', '/api/admin/login', { body: { password: PASSWORD } })).body.token
  assert.ok(adminToken)
})

test('brute force: 5 failures lock the address, even for the right password', { skip }, async () => {
  const { loginLimiter } = await import('../src/limiter.js')
  loginLimiter.reset()
  try {
    for (let i = 0; i < 5; i++) assert.equal((await call('POST', '/api/admin/login', { body: { password: `guess${i}` }, ip: '203.0.113.7' })).status, 403)
    const locked = await call('POST', '/api/admin/login', { body: { password: PASSWORD }, ip: '203.0.113.7' })
    assert.equal(locked.status, 429)
    assert.ok(Number(locked.headers['retry-after']) > 0)
  } finally { loginLimiter.reset() }
})

test('errors do not leak internals', { skip }, async () => {
  const res = await call('GET', '/api/runs/not-a-uuid', { token: adminToken })
  assert.ok([400, 404, 500].includes(res.status))
  const text = JSON.stringify(res.body ?? {})
  assert.ok(!/select|from "|stack|at \w+ \(|node_modules/i.test(text), text)
})
