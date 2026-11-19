import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { loginLimiter, safeEqual } from '../limiter.js'
import { sessions } from '../session.js'
import { isMfaEnabled, verifyMfaCode } from './mfa.js'

function bearer(header: string | undefined): string | null {
  return header && header.startsWith('Bearer ') ? header.slice(7).trim() : null
}

/** Public endpoints: login, session probe, logout. Everything else goes through the auth gate. */
export async function sessionRoutes(app: FastifyInstance) {
  app.get('/api/admin/session', async (req) => {
    const token = bearer(req.headers.authorization)
    return {
      configured: Boolean(process.env.ADMIN_PASSWORD),
      authenticated: token !== null && sessions.isSessionToken(token) && sessions.validate(token)
    }
  })

  app.post('/api/admin/login', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const adminPw = process.env.ADMIN_PASSWORD
    if (!adminPw) { reply.code(503); return { error: 'ADMIN_PASSWORD is not configured on this server' } }

    const retry = loginLimiter.retryAfter(req.ip)
    if (retry > 0) {
      reply.header('retry-after', String(retry)).code(429)
      return { error: 'Too many failed attempts. Try again later.' }
    }

    const body = z.object({ password: z.string().max(512), code: z.string().max(12).optional() }).safeParse(req.body)
    if (!body.success) { reply.code(400); return { error: 'invalid request' } }

    if (!safeEqual(body.data.password, adminPw)) {
      loginLimiter.recordFailure(req.ip)
      reply.code(403)
      return { error: 'Invalid credentials' }
    }

    if (await isMfaEnabled()) {
      if (!body.data.code) { reply.code(401); return { mfaRequired: true } }
      if (!(await verifyMfaCode(body.data.code))) {
        loginLimiter.recordFailure(req.ip)
        reply.code(403)
        return { error: 'Invalid credentials' }
      }
    }

    loginLimiter.recordSuccess(req.ip)
    return sessions.create()
  })

  app.post('/api/admin/logout', async (req) => {
    const token = bearer(req.headers.authorization)
    if (token && sessions.isSessionToken(token)) sessions.revoke(token)
    return { loggedOut: true }
  })
}
