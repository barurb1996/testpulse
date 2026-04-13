import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import { projects, runs, issues, ignores, runEndpoints, coverageTargets } from '../db/schema.js'

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
  })),
  endpoints: z.array(z.object({
    verb: z.string(),
    path: z.string(),
    file: z.string().optional(),
    line: z.number().int().optional(),
    scenarioName: z.string().optional(),
    via: z.enum(['direct', 'helper']).optional()
  })).optional()
})

const coverageTargetsSchema = z.object({
  source: z.string().optional(),
  targets: z.array(z.object({
    verb: z.string(),
    path: z.string(),
    operationId: z.string().optional(),
    summary: z.string().optional(),
    domain: z.string().optional()
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

    if (body.endpoints && body.endpoints.length > 0) {
      await db.insert(runEndpoints).values(body.endpoints.map(e => ({
        runId: run.id,
        verb: e.verb,
        path: e.path,
        file: e.file,
        line: e.line,
        scenarioName: e.scenarioName
      })))
    }

    reply.code(201)
    return { runId: run.id, projectId: project.id, score: run.score }
  })

  app.post('/api/projects/:slug/coverage-targets', async (req, reply) => {
    const { slug } = req.params as { slug: string }
    const parsed = coverageTargetsSchema.safeParse(req.body)
    if (!parsed.success) { reply.code(400); return { error: 'invalid payload', details: parsed.error.flatten() } }

    const project = await db.transaction(async (tx) => {
      const existing = await tx.select().from(projects).where(eq(projects.slug, slug))
      if (existing.length > 0) return existing[0]
      const [created] = await tx.insert(projects).values({ slug, name: slug }).returning()
      return created
    })

    const existing = await db
      .select({ verb: coverageTargets.verb, path: coverageTargets.path })
      .from(coverageTargets)
      .where(eq(coverageTargets.projectId, project.id))
    const existingKeys = new Set(existing.map(e => `${e.verb} ${e.path}`))

    const toInsert = parsed.data.targets.filter(t => !existingKeys.has(`${t.verb.toUpperCase()} ${t.path}`))
    if (toInsert.length > 0) {
      await db.insert(coverageTargets).values(toInsert.map(t => ({
        projectId: project.id,
        verb: t.verb.toUpperCase(),
        path: t.path,
        operationId: t.operationId,
        summary: t.summary,
        domain: t.domain,
        source: parsed.data.source ?? 'manual'
      })))
    }

    const total = existing.length + toInsert.length
    reply.code(201)
    return { inserted: toInsert.length, total }
  })

  app.get('/api/projects/:slug/coverage', async (req, reply) => {
    const { slug } = req.params as { slug: string }
    const project = await findProjectBySlug(slug)
    if (!project) { reply.code(404); return { error: 'project not found' } }

    const targets = await db
      .select()
      .from(coverageTargets)
      .where(eq(coverageTargets.projectId, project.id))

    const coveredRows = await db
      .selectDistinct({
        verb: runEndpoints.verb,
        path: runEndpoints.path
      })
      .from(runEndpoints)
      .innerJoin(runs, eq(runEndpoints.runId, runs.id))
      .where(eq(runs.projectId, project.id))

    const coveredByVerb = new Map<string, string[]>()
    for (const r of coveredRows) {
      const v = r.verb.toUpperCase()
      const bucket = coveredByVerb.get(v) ?? []
      bucket.push(r.path)
      coveredByVerb.set(v, bucket)
    }

    function targetIsCovered(t: { verb: string; path: string }): boolean {
      const verb = t.verb.toUpperCase()
      const paths = coveredByVerb.get(verb) ?? []
      if (paths.includes(t.path)) return true
      return paths.some(p => p === t.path || p.endsWith(t.path))
    }

    const covered = targets.filter(targetIsCovered)
    const uncovered = targets.filter(t => !targetIsCovered(t))

    const byDomain = new Map<string, { domain: string; total: number; covered: number }>()
    for (const t of targets) {
      const d = t.domain ?? 'other'
      const bucket = byDomain.get(d) ?? { domain: d, total: 0, covered: 0 }
      bucket.total += 1
      if (targetIsCovered(t)) bucket.covered += 1
      byDomain.set(d, bucket)
    }

    const orphanHits = coveredRows.filter(r => {
      return !targets.some(t =>
        t.verb.toUpperCase() === r.verb.toUpperCase() &&
        (t.path === r.path || r.path.endsWith(t.path))
      )
    })

    return {
      stats: {
        totalTargets: targets.length,
        coveredCount: covered.length,
        uncoveredCount: uncovered.length,
        coveragePercent: targets.length === 0 ? 0 : Math.round((covered.length / targets.length) * 100),
        orphanCount: orphanHits.length
      },
      covered,
      uncovered,
      byDomain: Array.from(byDomain.values()).sort((a, b) => b.total - a.total),
      orphans: orphanHits
    }
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
