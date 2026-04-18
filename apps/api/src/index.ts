import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import { runsRoutes } from './routes/runs.js'
import { gapsRoutes } from './routes/gaps.js'
import { adminRoutes } from './routes/admin.js'
import { scanRoutes } from './routes/scan.js'

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

app.get('/health', async () => ({ status: 'ok' }))

await app.register(runsRoutes)
await app.register(gapsRoutes)
await app.register(adminRoutes)
await app.register(scanRoutes)

const port = Number(process.env.PORT ?? 3001)
const host = process.env.HOST ?? '0.0.0.0'

try {
  await app.listen({ port, host })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
