import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { db } from './db/index.js'
import { buildApp } from './app.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Secrets at rest (repo tokens, Slack webhooks, the MFA secret) are only encrypted when ENCRYPTION_KEY is set.
if (!process.env.ENCRYPTION_KEY) {
  const msg = 'ENCRYPTION_KEY is not set: repo tokens, Slack webhooks and the MFA secret would be stored in plaintext (generate one with `openssl rand -hex 32`)'
  if (process.env.NODE_ENV === 'production') { console.error(msg); process.exit(1) }
  console.warn(`WARNING: ${msg}`)
}

const log = { info: (m: string) => console.log(m), warn: (o: unknown, m: string) => console.warn(m, o), error: (o: unknown, m: string) => console.error(m, o) }

// Run migrations on startup
try {
  await migrate(db, { migrationsFolder: join(__dirname, '..', 'drizzle') })
  log.info('Database migrations complete')
} catch (err) {
  log.error({ err }, 'Migration failed — check DATABASE_URL and schema')
  process.exit(1)
}

// Auto-seed demo project if requested
if (process.env.AUTO_SEED === 'true') {
  try {
    const { seed } = await import('./db/seed.js')
    await seed({ onlyIfMissing: true })
    log.info('Demo seed complete')
  } catch (err) {
    log.warn({ err }, 'Auto-seed failed (non-fatal)')
  }
}

const app = await buildApp()

const port = Number(process.env.PORT ?? 3001)
const host = process.env.HOST ?? '0.0.0.0'

try {
  await app.listen({ port, host })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
