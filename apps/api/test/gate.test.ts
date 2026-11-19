import test from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { registerAuthGate, type GateDeps } from '../src/gate.js'
import { sessions, SessionStore } from '../src/session.js'
import { FailureLimiter, safeEqual } from '../src/limiter.js'

process.env.ADMIN_PASSWORD = 'correct horse battery staple'

const deps: GateDeps = {
  insecureNoAuth: false,
  tokenSlug: async raw => (raw === 'tp_alpha_token' ? 'alpha' : raw === 'tp_beta_token' ? 'beta' : null),
  runSlug: async id => (id === 'run-of-alpha' ? 'alpha' : null)
}

function buildApp() {
  const app = Fastify()
  registerAuthGate(app, deps)
  const ok = async () => ({ ok: true })
  for (const [m, url] of [
    ['get', '/health'], ['get', '/api/projects'], ['get', '/api/projects/:slug/runs'], ['get', '/api/projects/:slug/docs'],
    ['patch', '/api/projects/:slug'], ['post', '/api/projects/:slug/digest/send'], ['post', '/api/projects/:slug/scan'],
    ['post', '/api/projects/:slug/gap-analyze'], ['get', '/api/runs'], ['post', '/api/runs'], ['get', '/api/runs/:id'],
    ['get', '/api/admin/projects'], ['post', '/api/admin/mfa/setup'], ['get', '/api/admin/session'], ['post', '/api/admin/login']
  ] as const) (app as any)[m](url, ok)
  return app
}

const bearer = (t: string) => ({ authorization: `Bearer ${t}` })
const call = (app: ReturnType<typeof buildApp>, method: string, url: string, headers = {}, payload?: unknown) =>
  app.inject({ method: method as any, url, headers, payload: payload as any }).then(r => r.statusCode)

test('anonymous callers are rejected everywhere except health and the login endpoints', async () => {
  const app = buildApp()
  for (const [m, u] of [['GET', '/api/projects'], ['GET', '/api/projects/alpha/docs'], ['PATCH', '/api/projects/alpha'],
    ['POST', '/api/projects/alpha/gap-analyze'], ['GET', '/api/runs?project=alpha'], ['POST', '/api/runs'], ['GET', '/api/admin/projects'],
    ['POST', '/api/admin/mfa/setup']]) {
    assert.equal(await call(app, m, u, {}, m === 'POST' || m === 'PATCH' ? {} : undefined), 401, `${m} ${u}`)
  }
  assert.equal(await call(app, 'GET', '/health'), 200)
  assert.equal(await call(app, 'GET', '/api/admin/session'), 200)
  assert.equal(await call(app, 'POST', '/api/admin/login', {}, {}), 200)
})

test('legacy x-admin-password / x-mfa-code headers grant nothing', async () => {
  const app = buildApp()
  assert.equal(await call(app, 'GET', '/api/admin/projects', { 'x-admin-password': process.env.ADMIN_PASSWORD! }), 401)
})

test('admin session reaches admin routes; revoked and garbage sessions do not', async () => {
  const app = buildApp()
  const { token } = sessions.create()
  assert.equal(await call(app, 'GET', '/api/admin/projects', bearer(token)), 200)
  assert.equal(await call(app, 'GET', '/api/projects', bearer(token)), 200)
  sessions.revoke(token)
  assert.equal(await call(app, 'GET', '/api/admin/projects', bearer(token)), 401)
  assert.equal(await call(app, 'GET', '/api/admin/projects', bearer('tps_' + 'a'.repeat(64))), 401)
})

test('project tokens are scoped to their own project', async () => {
  const app = buildApp()
  const t = bearer('tp_alpha_token')
  assert.equal(await call(app, 'GET', '/api/projects/alpha/docs', t), 200)
  assert.equal(await call(app, 'GET', '/api/projects/beta/docs', t), 403)
  assert.equal(await call(app, 'GET', '/api/runs?project=alpha', t), 200)
  assert.equal(await call(app, 'GET', '/api/runs?project=beta', t), 403)
  assert.equal(await call(app, 'GET', '/api/runs', t), 403) // no project given
  assert.equal(await call(app, 'GET', '/api/runs/run-of-alpha', t), 200)
  assert.equal(await call(app, 'GET', '/api/runs/run-of-beta', t), 403)
  assert.equal(await call(app, 'POST', '/api/runs', t, { projectSlug: 'alpha' }), 200)
  assert.equal(await call(app, 'POST', '/api/runs', t, { projectSlug: 'beta' }), 403)
  assert.equal(await call(app, 'GET', '/api/projects/alpha/docs', bearer('tp_nope')), 403)
})

test('project tokens can never reach admin-only endpoints, even for their own project', async () => {
  const app = buildApp()
  const t = bearer('tp_alpha_token')
  for (const [m, u] of [['GET', '/api/projects'], ['PATCH', '/api/projects/alpha'], ['POST', '/api/projects/alpha/digest/send'],
    ['POST', '/api/projects/alpha/scan'], ['GET', '/api/admin/projects'], ['POST', '/api/admin/mfa/setup']]) {
    assert.equal(await call(app, m, u, t, m === 'GET' ? undefined : {}), 403, `${m} ${u}`)
  }
})

test('server without ADMIN_PASSWORD refuses all API traffic (fail closed)', async () => {
  const saved = process.env.ADMIN_PASSWORD
  delete process.env.ADMIN_PASSWORD
  try {
    const app = buildApp()
    assert.equal(await call(app, 'GET', '/api/projects/alpha/docs', bearer('tp_alpha_token')), 503)
  } finally { process.env.ADMIN_PASSWORD = saved }
})

test('failure limiter locks one IP after 5 failures and everyone after 20 global failures', () => {
  let now = 0
  const l = new FailureLimiter(5, 20, 900_000, 900_000, () => now)
  for (let i = 0; i < 4; i++) l.recordFailure('1.1.1.1')
  assert.equal(l.retryAfter('1.1.1.1'), 0)
  l.recordFailure('1.1.1.1')
  assert.ok(l.retryAfter('1.1.1.1') > 0)
  assert.equal(l.retryAfter('2.2.2.2'), 0)
  for (let i = 0; i < 20; i++) l.recordFailure(`9.9.9.${i}`)
  assert.ok(l.retryAfter('2.2.2.2') > 0, 'global lock')
  now += 901_000
  assert.equal(l.retryAfter('1.1.1.1'), 0)
  assert.equal(l.retryAfter('2.2.2.2'), 0)
})

test('sessions expire after the idle and absolute limits', () => {
  let now = 0
  const s = new SessionStore(() => now)
  const a = s.create().token
  now += 119 * 60_000
  assert.ok(s.validate(a))            // activity keeps it alive
  now += 119 * 60_000
  assert.ok(s.validate(a))
  now += 3 * 60 * 60_000
  assert.equal(s.validate(a), false)  // idle > 2h
  const b = s.create().token
  for (let i = 0; i < 5; i++) { now += 100 * 60_000; s.validate(b) }
  assert.equal(s.validate(b), false)  // absolute 8h
})

test('safeEqual is length-independent and exact', () => {
  assert.equal(safeEqual('abc', 'abc'), true)
  assert.equal(safeEqual('abc', 'abd'), false)
  assert.equal(safeEqual('abc', 'abcd'), false)
})
