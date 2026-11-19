import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { db, pool } from './db/index.js'
import { runsRoutes } from './routes/runs.js'
import { gapsRoutes } from './routes/gaps.js'
import { adminRoutes } from './routes/admin.js'
import { scanRoutes } from './routes/scan.js'
import { mfaRoutes } from './routes/mfa.js'
import { sessionRoutes } from './routes/session.js'
import { registerAuthGate } from './gate.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Secrets at rest (repo tokens, Slack webhooks, the MFA secret) are only encrypted when ENCRYPTION_KEY is set.
if (!process.env.ENCRYPTION_KEY) {
  const msg = 'ENCRYPTION_KEY is not set: repo tokens, Slack webhooks and the MFA secret would be stored in plaintext (generate one with `openssl rand -hex 32`)'
  if (process.env.NODE_ENV === 'production') { console.error(msg); process.exit(1) }
  console.warn(`WARNING: ${msg}`)
}

// Default body limit is small; ingest endpoints that need more raise it per route.
// trustProxy is opt-in: behind a reverse proxy (Railway, nginx) set TRUST_PROXY=true so rate limits and
// login lockouts key on the real client address instead of the proxy's.
const app = Fastify({
  logger: { level: 'info', redact: ['req.headers.authorization', 'req.headers.cookie'] },
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

// Run migrations on startup
try {
  await migrate(db, { migrationsFolder: join(__dirname, '..', 'drizzle') })
  app.log.info('Database migrations complete')
} catch (err) {
  app.log.error({ err }, 'Migration failed — check DATABASE_URL and schema')
  process.exit(1)
}

// Auto-seed demo project if requested
if (process.env.AUTO_SEED === 'true') {
  try {
    const { seed } = await import('./db/seed.js')
    await seed({ onlyIfMissing: true })
    app.log.info('Demo seed complete')
  } catch (err) {
    app.log.warn({ err }, 'Auto-seed failed (non-fatal)')
  }
}

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

const port = Number(process.env.PORT ?? 3001)
const host = process.env.HOST ?? '0.0.0.0'

try {
  await app.listen({ port, host })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
