import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { projects, runs, issues } from '../db/schema.js'

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
    message: z.string()
  }))
})

export async function runsRoutes(app: FastifyInstance) {
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
        message: i.message
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
        message: issues.message
      })
      .from(issues)
      .where(eq(issues.runId, id))
      .orderBy(issues.severity, issues.file, issues.line)

    return { run, issues: rows }
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
}
