import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import type { FastifyRequest, FastifyReply } from 'fastify'
import { eq } from 'drizzle-orm'
import { db } from './db/index.js'
import { apiTokens, projects } from './db/schema.js'

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

export function generateToken(projectSlug: string): string {
  const rand = randomBytes(24).toString('hex')
  return `tp_${projectSlug}_${rand}`
}

export async function validateBearerToken(
  request: FastifyRequest,
  reply: FastifyReply,
  requiredProjectSlug?: string
): Promise<string | null> {
  const header = request.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    reply.code(401).send({ error: 'Missing Authorization: Bearer <token> header' })
    return null
  }

  const raw = header.slice(7)
  const hashed = hashToken(raw)

  const [row] = await db
    .select({
      id: apiTokens.id,
      projectId: apiTokens.projectId,
      projectSlug: projects.slug
    })
    .from(apiTokens)
    .innerJoin(projects, eq(apiTokens.projectId, projects.id))
    .where(eq(apiTokens.tokenHash, hashed))

  if (!row) {
    reply.code(403).send({ error: 'Invalid API token' })
    return null
  }

  if (requiredProjectSlug && row.projectSlug !== requiredProjectSlug) {
    reply.code(403).send({ error: `Token is for project "${row.projectSlug}", not "${requiredProjectSlug}"` })
    return null
  }

  db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, row.id)).catch(() => {})

  return row.projectSlug
}

export function validateAdminPassword(request: FastifyRequest, reply: FastifyReply): boolean {
  const adminPw = process.env.ADMIN_PASSWORD
  if (!adminPw) {
    reply.code(503).send({ error: 'ADMIN_PASSWORD not configured on this server. Admin operations require it.' })
    return false
  }

  const header = request.headers['x-admin-password'] as string | undefined
  const body = (request.body as Record<string, unknown>)?.adminPassword as string | undefined
  const value = header ?? body

  if (!value) {
    reply.code(401).send({ error: 'Admin password required (x-admin-password header or adminPassword in body)' })
    return false
  }

  const expected = Buffer.from(adminPw, 'utf-8')
  const provided = Buffer.from(value, 'utf-8')
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    reply.code(403).send({ error: 'Invalid admin password' })
    return false
  }

  return true
}

export async function optionalBearerAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<boolean> {
  if (!process.env.REQUIRE_AUTH) return true
  const header = request.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    reply.code(401).send({ error: 'Authentication required (REQUIRE_AUTH is enabled)' })
    return false
  }
  const hashed = hashToken(header.slice(7))
  const [row] = await db.select({ id: apiTokens.id }).from(apiTokens).where(eq(apiTokens.tokenHash, hashed))
  if (!row) {
    reply.code(403).send({ error: 'Invalid API token' })
    return false
  }
  return true
}
