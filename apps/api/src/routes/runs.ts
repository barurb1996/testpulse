import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import { projects, runs, issues, ignores } from '../db/schema.js'

const intakeSchema = z.object({
  projectSlug: z.string().min(1),
  projectName: z.string().min(1).optional(),
  commitSha: z.string().optional(),
  branch: z.string().optional(),
  score: z.number().int().min(0).max(100),
  filesScanned: z.number().int().min(0),
  issues: z.array(z.object({
    file: z.string(),
    line: z.number().int(),
    rule: z.string(),
    severity: z.enum(['critical', 'warning', 'info']),
    message: z.string(),
    fingerprint: z.string().optional()
  }))
})

const addIgnoreSchema = z.object({
  fingerprint: z.string().min(6).max(64),
  rule: z.string().optional(),
  file: z.string().optional(),
  line: z.number().int().optional(),
  reason: z.string().max(500).optional()
})

async function findProjectBySlug(slug: string) {
  const rows = await db.select().from(projects).where(eq(projects.slug, slug))
  return rows[0] ?? null
}

export async function runsRoutes(app: FastifyInstance) {
  app.get('/api/projects', async () => {
    const rows = await db
      .select({
        slug: projects.slug,
        name: projects.name,
        runCount: sql<number>`count(${runs.id})::int`.as('run_count'),
        lastRunAt: sql<string | null>`max(${runs.createdAt})`.as('last_run_at'),
        latestScore: sql<number | null>`(array_agg(${runs.score} order by ${runs.createdAt} desc))[1]`.as('latest_score'),
        latestCritical: sql<number | null>`(array_agg(${runs.criticalIssues} order by ${runs.createdAt} desc))[1]`.as('latest_critical')
      })
      .from(projects)
      .leftJoin(runs, eq(runs.projectId, projects.id))
      .groupBy(projects.id, projects.slug, projects.name)
      .orderBy(sql`max(${runs.createdAt}) desc nulls last`)

    return { projects: rows }
  })

  app.post('/api/runs', async (req, reply) => {
    const parsed = intakeSchema.safeParse(req.body)
    if (!parsed.success) {
      reply.code(400)
      return { error: 'invalid payload', details: parsed.error.flatten() }
    }
    const body = parsed.data

    const project = await db.transaction(async (tx) => {
      const existing = await tx.select().from(projects).where(eq(projects.slug, body.projectSlug))
      if (existing.length > 0) return existing[0]
      const [created] = await tx.insert(projects).values({
        slug: body.projectSlug,
        name: body.projectName ?? body.projectSlug
      }).returning()
      return created
    })

    const critical = body.issues.filter(i => i.severity === 'critical').length

    const [run] = await db.insert(runs).values({
      projectId: project.id,
      commitSha: body.commitSha,
      branch: body.branch,
      score: body.score,
      totalIssues: body.issues.length,
      criticalIssues: critical,
      filesScanned: body.filesScanned
    }).returning()

    if (body.issues.length > 0) {
      await db.insert(issues).values(body.issues.map(i => ({
        runId: run.id,
        file: i.file,
        line: i.line,
        rule: i.rule,
        severity: i.severity,
        message: i.message,
        fingerprint: i.fingerprint
      })))
    }

    reply.code(201)
    return { runId: run.id, projectId: project.id, score: run.score }
  })

  app.get('/api/runs/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const [run] = await db
      .select({
        id: runs.id,
        projectId: runs.projectId,
        projectSlug: projects.slug,
        projectName: projects.name,
        commitSha: runs.commitSha,
        branch: runs.branch,
        score: runs.score,
        totalIssues: runs.totalIssues,
        criticalIssues: runs.criticalIssues,
        filesScanned: runs.filesScanned,
        createdAt: runs.createdAt
      })
      .from(runs)
      .innerJoin(projects, eq(runs.projectId, projects.id))
      .where(eq(runs.id, id))

    if (!run) {
      reply.code(404)
      return { error: 'run not found' }
    }

    const rows = await db
      .select({
        file: issues.file,
        line: issues.line,
        rule: issues.rule,
        severity: issues.severity,
        message: issues.message,
        fingerprint: issues.fingerprint
      })
      .from(issues)
      .where(eq(issues.runId, id))
      .orderBy(issues.severity, issues.file, issues.line)

    const fingerprints = Array.from(new Set(rows.map(r => r.fingerprint).filter((v): v is string => !!v)))
    const projectIgnoreSet = new Set<string>()
    if (fingerprints.length > 0) {
      const ignoreRows = await db
        .select({ fingerprint: ignores.fingerprint })
        .from(ignores)
        .where(and(eq(ignores.projectId, run.projectId), inArray(ignores.fingerprint, fingerprints)))
      for (const ig of ignoreRows) projectIgnoreSet.add(ig.fingerprint)
    }

    const enriched = rows.map(r => ({
      ...r,
      isIgnored: !!(r.fingerprint && projectIgnoreSet.has(r.fingerprint))
    }))

    return { run, issues: enriched }
  })

  app.get('/api/runs', async (req) => {
    const query = z.object({
      project: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(100).default(20)
    }).parse(req.query)

    const where = query.project
      ? and(eq(projects.slug, query.project))
      : undefined

    const rows = await db
      .select({
        id: runs.id,
        projectSlug: projects.slug,
        commitSha: runs.commitSha,
        branch: runs.branch,
        score: runs.score,
        totalIssues: runs.totalIssues,
        criticalIssues: runs.criticalIssues,
        filesScanned: runs.filesScanned,
        createdAt: runs.createdAt
      })
      .from(runs)
      .innerJoin(projects, eq(runs.projectId, projects.id))
      .where(where)
      .orderBy(desc(runs.createdAt))
      .limit(query.limit)

    return { runs: rows }
  })

  app.get('/api/projects/:slug/ignores', async (req, reply) => {
    const { slug } = req.params as { slug: string }
    const project = await findProjectBySlug(slug)
    if (!project) { reply.code(404); return { error: 'project not found' } }

    const rows = await db
      .select()
      .from(ignores)
      .where(eq(ignores.projectId, project.id))
      .orderBy(desc(ignores.createdAt))
    return { ignores: rows }
  })

  app.post('/api/projects/:slug/ignores', async (req, reply) => {
    const { slug } = req.params as { slug: string }
    const project = await findProjectBySlug(slug)
    if (!project) { reply.code(404); return { error: 'project not found' } }

    const parsed = addIgnoreSchema.safeParse(req.body)
    if (!parsed.success) { reply.code(400); return { error: 'invalid payload', details: parsed.error.flatten() } }

    const existing = await db
      .select()
      .from(ignores)
      .where(and(eq(ignores.projectId, project.id), eq(ignores.fingerprint, parsed.data.fingerprint)))
    if (existing.length > 0) {
      return { ignore: existing[0], created: false }
    }

    const [row] = await db.insert(ignores).values({
      projectId: project.id,
      fingerprint: parsed.data.fingerprint,
      rule: parsed.data.rule,
      file: parsed.data.file,
      line: parsed.data.line,
      reason: parsed.data.reason
    }).returning()

    reply.code(201)
    return { ignore: row, created: true }
  })

  app.delete('/api/projects/:slug/ignores/:fingerprint', async (req, reply) => {
    const { slug, fingerprint } = req.params as { slug: string; fingerprint: string }
    const project = await findProjectBySlug(slug)
    if (!project) { reply.code(404); return { error: 'project not found' } }

    await db
      .delete(ignores)
      .where(and(eq(ignores.projectId, project.id), eq(ignores.fingerprint, fingerprint)))

    reply.code(204)
    return null
  })
}
