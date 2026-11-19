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

const __dirname = dirname(fileURLToPath(import.meta.url))

const app = Fastify({ logger: true, bodyLimit: 50 * 1024 * 1024 })

const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(s => s.trim())
  : true

await app.register(cors, { origin: allowedOrigins, credentials: true })
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
