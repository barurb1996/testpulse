import Fastify from 'fastify'
import cors from '@fastify/cors'
import { runsRoutes } from './routes/runs.js'
import { gapsRoutes } from './routes/gaps.js'
import { adminRoutes } from './routes/admin.js'

const app = Fastify({ logger: true, bodyLimit: 50 * 1024 * 1024 })

await app.register(cors, { origin: true })

app.get('/health', async () => ({
  status: 'ok',
  authRequired: !!process.env.REQUIRE_AUTH,
  adminConfigured: !!process.env.ADMIN_PASSWORD
}))

await app.register(runsRoutes)
await app.register(gapsRoutes)
await app.register(adminRoutes)

const port = Number(process.env.PORT ?? 3001)
const host = process.env.HOST ?? '0.0.0.0'

try {
  await app.listen({ port, host })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
