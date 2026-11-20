import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import { runsRoutes } from './routes/runs.js'
import { gapsRoutes } from './routes/gaps.js'
import { adminRoutes } from './routes/admin.js'
import { scanRoutes } from './routes/scan.js'
import { mfaRoutes } from './routes/mfa.js'
import { sessionRoutes } from './routes/session.js'
import { registerAuthGate } from './gate.js'

/** Builds the Fastify app without migrating the database or listening, so tests can drive it with `inject`. */
export async function buildApp(opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  // Default body limit is small; ingest endpoints that need more raise it per route.
  // trustProxy is opt-in: behind a reverse proxy (Railway, nginx) set TRUST_PROXY=true so rate limits and
  // login lockouts key on the real client address instead of the proxy's.
  const app = Fastify({
    logger: opts.logger === false ? false : { level: 'info', redact: ['req.headers.authorization', 'req.headers.cookie'] },
    bodyLimit: 1024 * 1024,
    trustProxy: process.env.TRUST_PROXY === 'true'
  })

  // Same-origin only unless CORS_ORIGIN lists the dashboard origin(s). Credentials are bearer headers, not cookies.
  const allowedOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map(s => s.trim()).filter(Boolean)
    : false

  await app.register(cors, { origin: allowedOrigins })
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"]
      }
    }
  })
  await app.register(rateLimit, {
    max: 200,
    timeWindow: '1 minute',
    allowList: ['127.0.0.1', '::1']
  })

  app.get('/health', async () => ({ status: 'ok' }))

  // Never leak internals (SQL, stack traces, file paths) to clients.
  app.setErrorHandler((error, req, reply) => {
    const err = error as { statusCode?: number; message?: string }
    const status = typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500
    if (status === 500) req.log.error({ err: error }, 'unhandled error')
    reply.code(status).send({ error: status === 500 ? 'Internal server error' : (err.message ?? 'Bad request') })
  })

  // One gate in front of every /api route: admin session, or a project token scoped to its own project.
  registerAuthGate(app)

  await app.register(sessionRoutes)
  await app.register(runsRoutes)
  await app.register(gapsRoutes)
  await app.register(adminRoutes)
  await app.register(scanRoutes)
  await app.register(mfaRoutes)

  return app
}
