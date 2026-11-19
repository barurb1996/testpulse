import type { FastifyInstance } from 'fastify'
import { desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/index.js'
import { projects, runs, apiTokens } from '../db/schema.js'
import { generateToken, hashToken } from '../auth.js'
import { requireAdmin } from '../gate.js'

export async function adminRoutes(app: FastifyInstance) {
  // The global auth gate already rejects anonymous callers; this keeps the plugin safe if mounted elsewhere.
  app.addHook('preHandler', async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply
  })

  app.get('/api/admin/projects', async () => {
    const rows = await db
      .select({
        id: projects.id,
        slug: projects.slug,
        name: projects.name,
        slackWebhookUrl: projects.slackWebhookUrl,
        createdAt: projects.createdAt,
        runCount: sql<number>`count(${runs.id})::int`.as('run_count')
      })
      .from(projects)
      .leftJoin(runs, eq(runs.projectId, projects.id))
      .groupBy(projects.id)
      .orderBy(desc(projects.createdAt))

    return {
      projects: rows.map(r => ({
        ...r,
        slackWebhookUrl: r.slackWebhookUrl ? '<configured>' : null
      }))
    }
  })

  app.post('/api/admin/projects', async (req, reply) => {
    const body = z.object({
      slug: z.string().min(1).max(100).regex(/^[a-z0-9_-]+$/),
      name: z.string().min(1).max(200)
    }).safeParse(req.body)
    if (!body.success) { reply.code(400); return { error: 'invalid', details: body.error.flatten() } }

    const existing = await db.select().from(projects).where(eq(projects.slug, body.data.slug))
    if (existing.length > 0) { reply.code(409); return { error: 'project slug already exists' } }

    const [project] = await db.insert(projects).values({
      slug: body.data.slug,
      name: body.data.name
    }).returning()

    const raw = generateToken(project.slug)
    await db.insert(apiTokens).values({
      projectId: project.id,
      tokenHash: hashToken(raw),
      name: 'default'
    })

    reply.code(201)
    return {
      project,
      token: raw,
      warning: 'Save this token — it will not be shown again.'
    }
  })

  app.delete('/api/admin/projects/:slug', async (req, reply) => {
    const { slug } = req.params as { slug: string }
    const [project] = await db.select().from(projects).where(eq(projects.slug, slug))
    if (!project) { reply.code(404); return { error: 'not found' } }

    await db.delete(projects).where(eq(projects.id, project.id))
    reply.code(200)
    return { deleted: slug }
  })

  app.get('/api/admin/projects/:slug/tokens', async (req, reply) => {
    const { slug } = req.params as { slug: string }
    const [project] = await db.select().from(projects).where(eq(projects.slug, slug))
    if (!project) { reply.code(404); return { error: 'not found' } }

    const rows = await db
      .select({
        id: apiTokens.id,
        name: apiTokens.name,
        lastUsedAt: apiTokens.lastUsedAt,
        createdAt: apiTokens.createdAt
      })
      .from(apiTokens)
      .where(eq(apiTokens.projectId, project.id))
      .orderBy(desc(apiTokens.createdAt))

    return { tokens: rows }
  })

  app.post('/api/admin/projects/:slug/tokens', async (req, reply) => {
    const { slug } = req.params as { slug: string }
    const [project] = await db.select().from(projects).where(eq(projects.slug, slug))
    if (!project) { reply.code(404); return { error: 'not found' } }

    const body = z.object({ name: z.string().min(1).max(100).default('default') }).safeParse(req.body ?? {})
    const name = body.success ? body.data.name : 'default'

    const raw = generateToken(slug)
    await db.insert(apiTokens).values({
      projectId: project.id,
      tokenHash: hashToken(raw),
      name
    })

    reply.code(201)
    return { token: raw, name, warning: 'Save this token — it will not be shown again.' }
  })

  app.delete('/api/admin/tokens/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    await db.delete(apiTokens).where(eq(apiTokens.id, id))
    reply.code(200)
    return { deleted: id }
  })
}
