import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import { projects, runs, issues, ignores, runEndpoints, coverageTargets, scenarioRuns, gapSuggestions, projectDocs } from '../db/schema.js'

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
    fingerprint: z.string().optional(),
    scenarioName: z.string().optional()
  })),
  endpoints: z.array(z.object({
    verb: z.string(),
    path: z.string(),
    file: z.string().optional(),
    line: z.number().int().optional(),
    scenarioName: z.string().optional(),
    via: z.enum(['direct', 'helper']).optional()
  })).optional(),
  scenarioResults: z.array(z.object({
    suite: z.string(),
    name: z.string(),
    classname: z.string().nullable().optional(),
    status: z.enum(['pass', 'fail', 'skip', 'error']),
    durationMs: z.number().int().nullable().optional(),
    failureMessage: z.string().nullable().optional(),
    failureDetail: z.string().nullable().optional()
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

export async function computeHealthForRun(projectId: string, thisRunId: string, thisRunCreatedAt: Date, thisRunScore: number, thisRunCriticals: number): Promise<{ score: number; components: Array<{ name: string; raw: string; score: number; weight: number }> }> {
  const targets = await db
    .select({ verb: coverageTargets.verb, path: coverageTargets.path })
    .from(coverageTargets)
    .where(eq(coverageTargets.projectId, projectId))

  let coveragePercent: number | null = null
  if (targets.length > 0) {
    const coveredRows = await db
      .selectDistinct({ verb: runEndpoints.verb, path: runEndpoints.path })
      .from(runEndpoints)
      .innerJoin(runs, eq(runEndpoints.runId, runs.id))
      .where(and(eq(runs.projectId, projectId), lt(runs.createdAt, new Date(thisRunCreatedAt.getTime() + 1))))
    const byVerb = new Map<string, string[]>()
    for (const r of coveredRows) {
      const v = r.verb.toUpperCase()
      const arr = byVerb.get(v) ?? []
      arr.push(r.path)
      byVerb.set(v, arr)
    }
    const cov = targets.filter(t => {
      const paths = byVerb.get(t.verb.toUpperCase()) ?? []
      return paths.some(p => p === t.path || p.endsWith(t.path))
    }).length
    coveragePercent = Math.round((cov / targets.length) * 100)
  }

  const allScenariosUpTo = await db
    .select({ suite: scenarioRuns.suite, classname: scenarioRuns.classname, name: scenarioRuns.name, status: scenarioRuns.status })
    .from(scenarioRuns)
    .innerJoin(runs, eq(scenarioRuns.runId, runs.id))
    .where(and(eq(runs.projectId, projectId), lt(runs.createdAt, new Date(thisRunCreatedAt.getTime() + 1))))
  const keys = new Map<string, { passes: number; fails: number; appearances: number }>()
  for (const s of allScenariosUpTo) {
    const k = `${s.suite}::${s.classname ?? ''}::${s.name}`
    const b = keys.get(k) ?? { passes: 0, fails: 0, appearances: 0 }
    b.appearances += 1
    if (s.status === 'pass') b.passes += 1
    else if (s.status === 'fail' || s.status === 'error') b.fails += 1
    keys.set(k, b)
  }
  const flakyCount = Array.from(keys.values()).filter(b => b.appearances >= 3 && b.passes > 0 && b.fails > 0).length

  const thisScenarios = await db.select().from(scenarioRuns).where(eq(scenarioRuns.runId, thisRunId))
  let regressionCount = 0
  if (thisScenarios.length > 0) {
    const prevRuns = await db
      .select({ id: runs.id })
      .from(runs)
      .where(and(eq(runs.projectId, projectId), lt(runs.createdAt, thisRunCreatedAt)))
      .orderBy(desc(runs.createdAt))
      .limit(10)
    for (const pr of prevRuns) {
      const rows = await db.select().from(scenarioRuns).where(eq(scenarioRuns.runId, pr.id))
      if (rows.length === 0) continue
      const prevMap = new Map<string, typeof rows[number]>()
      const keyOf = (s: { suite: string; classname: string | null; name: string }) => `${s.suite}::${s.classname ?? ''}::${s.name}`
      for (const r of rows) prevMap.set(keyOf(r), r)
      for (const c of thisScenarios) {
        if (!(c.status === 'fail' || c.status === 'error')) continue
        const p = prevMap.get(keyOf(c))
        if (!p || !(p.status === 'fail' || p.status === 'error')) regressionCount += 1
      }
      break
    }
  }

  const staticScore = thisRunScore
  const coverageScore = coveragePercent ?? 0
  const flakyScore = Math.max(0, 100 - flakyCount * 8)
  const regressionScore = Math.max(0, 100 - regressionCount * 12)
  const criticalScore = Math.max(0, 100 - thisRunCriticals * 10)

  const components = [
    { name: 'Static quality', raw: `${staticScore}/100`, score: staticScore, weight: 30 },
    { name: 'API coverage', raw: coveragePercent === null ? 'no spec' : `${coveragePercent}%`, score: coverageScore, weight: coveragePercent === null ? 0 : 30 },
    { name: 'Stability (flaky)', raw: `${flakyCount} flaky`, score: flakyScore, weight: 15 },
    { name: 'No regressions', raw: `${regressionCount} new failure${regressionCount === 1 ? '' : 's'}`, score: regressionScore, weight: 10 },
    { name: 'No criticals', raw: `${thisRunCriticals} critical`, score: criticalScore, weight: 10 }
  ]
  const totalWeight = components.reduce((a, c) => a + c.weight, 0)
  const weightedSum = components.reduce((a, c) => a + c.score * c.weight, 0)
  const health = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0
  return { score: health, components }
}

async function fireSlackWebhookIfNeeded(
  project: { id: string; slug: string; name: string; slackWebhookUrl: string | null },
  run: { id: string; score: number; criticalIssues: number; totalIssues: number; branch: string | null; commitSha: string | null; createdAt: Date | string }
): Promise<void> {
  if (!project.slackWebhookUrl) return

  const currentScenarios = await db.select().from(scenarioRuns).where(eq(scenarioRuns.runId, run.id))
  let newFailures: Array<{ suite: string; classname: string | null; name: string }> = []

  if (currentScenarios.length > 0) {
    const createdAt = run.createdAt instanceof Date ? run.createdAt : new Date(run.createdAt)
    const prevRuns = await db
      .select({ id: runs.id })
      .from(runs)
      .where(and(eq(runs.projectId, project.id), lt(runs.createdAt, createdAt)))
      .orderBy(desc(runs.createdAt))
      .limit(10)

    for (const pr of prevRuns) {
      const prev = await db.select().from(scenarioRuns).where(eq(scenarioRuns.runId, pr.id))
      if (prev.length === 0) continue
      const prevByKey = new Map<string, typeof prev[number]>()
      const keyOf = (s: { suite: string; classname: string | null; name: string }) =>
        `${s.suite}::${s.classname ?? ''}::${s.name}`
      for (const s of prev) prevByKey.set(keyOf(s), s)

      for (const c of currentScenarios) {
        const wasFail = (c.status === 'fail' || c.status === 'error')
        if (!wasFail) continue
        const p = prevByKey.get(keyOf(c))
        if (!p || !(p.status === 'fail' || p.status === 'error')) {
          newFailures.push({ suite: c.suite, classname: c.classname, name: c.name })
        }
      }
      break
    }
  }

  const hasRegressions = newFailures.length > 0
  const hasCriticals = run.criticalIssues > 0
  if (!hasRegressions && !hasCriticals) return

  const headline = hasRegressions
    ? `:warning: *${project.name}* — ${newFailures.length} new test regression${newFailures.length > 1 ? 's' : ''}`
    : `:warning: *${project.name}* — ${run.criticalIssues} critical issue${run.criticalIssues > 1 ? 's' : ''}`
  const meta = [
    `Score: *${run.score}/100*`,
    run.branch ? `branch: \`${run.branch}\`` : null,
    run.commitSha ? `commit: \`${run.commitSha.slice(0, 7)}\`` : null
  ].filter(Boolean).join(' · ')

  const regressionList = newFailures.slice(0, 5).map(f => `• \`${f.classname ?? f.suite}\` — ${f.name}`).join('\n')
  const more = newFailures.length > 5 ? `\n…and ${newFailures.length - 5} more.` : ''

  const body = {
    text: headline,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: headline } },
      { type: 'context', elements: [{ type: 'mrkdwn', text: meta }] },
      ...(hasRegressions ? [{
        type: 'section',
        text: { type: 'mrkdwn', text: `*New failures:*\n${regressionList}${more}` }
      }] : []),
      { type: 'context', elements: [{ type: 'mrkdwn', text: `Run id: \`${run.id}\`` }] }
    ]
  }

  try {
    await fetch(project.slackWebhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
  } catch (err) {
    console.error('slack webhook failed', err)
  }
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
        fingerprint: i.fingerprint,
        scenarioName: i.scenarioName
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

    if (body.scenarioResults && body.scenarioResults.length > 0) {
      await db.insert(scenarioRuns).values(body.scenarioResults.map(s => ({
        runId: run.id,
        suite: s.suite,
        name: s.name,
        classname: s.classname ?? null,
        status: s.status,
        durationMs: s.durationMs ?? null,
        failureMessage: s.failureMessage ?? null,
        failureDetail: s.failureDetail ?? null
      })))
    }

    try {
      const runCreatedAt = run.createdAt instanceof Date ? run.createdAt : new Date(run.createdAt)
      const health = await computeHealthForRun(project.id, run.id, runCreatedAt, run.score, critical)
      await db.update(runs).set({ healthScore: health.score }).where(eq(runs.id, run.id))
    } catch (err) {
      console.error('health computation failed', err)
    }

    fireSlackWebhookIfNeeded(project, run).catch(err => console.error('slack webhook error', err))

    reply.code(201)
    return { runId: run.id, projectId: project.id, score: run.score }
  })

  app.post('/api/projects/:slug/docs', async (req, reply) => {
    const { slug } = req.params as { slug: string }
    const project = await db.transaction(async (tx) => {
      const existing = await tx.select().from(projects).where(eq(projects.slug, slug))
      if (existing.length > 0) return existing[0]
      const [created] = await tx.insert(projects).values({ slug, name: slug }).returning()
      return created
    })

    const body = z.object({
      filename: z.string().min(1),
      contentText: z.string().min(1),
      chunks: z.array(z.object({
        index: z.number().int(),
        heading: z.string().nullable(),
        text: z.string()
      })),
      charCount: z.number().int(),
      source: z.string().default('upload')
    }).safeParse(req.body)

    if (!body.success) { reply.code(400); return { error: 'invalid', details: body.error.flatten() } }

    const existing = await db.select().from(projectDocs)
      .where(and(eq(projectDocs.projectId, project.id), eq(projectDocs.filename, body.data.filename)))
    if (existing.length > 0) {
      await db.update(projectDocs)
        .set({ contentText: body.data.contentText, chunks: body.data.chunks, charCount: body.data.charCount, source: body.data.source })
        .where(eq(projectDocs.id, existing[0].id))
      return { updated: true, id: existing[0].id }
    }

    const [row] = await db.insert(projectDocs).values({
      projectId: project.id,
      filename: body.data.filename,
      contentText: body.data.contentText,
      chunks: body.data.chunks,
      charCount: body.data.charCount,
      source: body.data.source
    }).returning()

    reply.code(201)
    return { created: true, id: row.id }
  })

  app.get('/api/projects/:slug/docs', async (req, reply) => {
    const { slug } = req.params as { slug: string }
    const project = await findProjectBySlug(slug)
    if (!project) { reply.code(404); return { error: 'not found' } }

    const rows = await db
      .select({ id: projectDocs.id, filename: projectDocs.filename, charCount: projectDocs.charCount, source: projectDocs.source, createdAt: projectDocs.createdAt })
      .from(projectDocs)
      .where(eq(projectDocs.projectId, project.id))
      .orderBy(projectDocs.filename)

    return { docs: rows }
  })

  app.delete('/api/projects/:slug/docs/:docId', async (req, reply) => {
    const { docId } = req.params as { docId: string }
    await db.delete(projectDocs).where(eq(projectDocs.id, docId))
    reply.code(200)
    return { deleted: docId }
  })

  app.get('/api/runs/:id/regressions', async (req, reply) => {
    const { id } = req.params as { id: string }
    const [run] = await db.select().from(runs).where(eq(runs.id, id))
    if (!run) { reply.code(404); return { error: 'run not found' } }

    const current = await db.select().from(scenarioRuns).where(eq(scenarioRuns.runId, id))
    if (current.length === 0) {
      return { newFailures: [], fixed: [], previousRunId: null, totalComparedAgainst: 0, note: 'no scenario results in this run' }
    }

    const prevRuns = await db
      .select({ id: runs.id })
      .from(runs)
      .where(and(eq(runs.projectId, run.projectId), lt(runs.createdAt, run.createdAt)))
      .orderBy(desc(runs.createdAt))
      .limit(10)

    let previousRunId: string | null = null
    let prevScenarios: typeof current = []
    for (const pr of prevRuns) {
      const rows = await db.select().from(scenarioRuns).where(eq(scenarioRuns.runId, pr.id))
      if (rows.length > 0) {
        previousRunId = pr.id
        prevScenarios = rows
        break
      }
    }

    if (!previousRunId) {
      return { newFailures: [], fixed: [], previousRunId: null, totalComparedAgainst: 0, note: 'no previous run with scenarios' }
    }

    const keyOf = (s: { suite: string; classname: string | null; name: string }) =>
      `${s.suite}::${s.classname ?? ''}::${s.name}`
    const prevByKey = new Map<string, typeof prevScenarios[number]>()
    for (const s of prevScenarios) prevByKey.set(keyOf(s), s)

    const newFailures: Array<{ suite: string; classname: string | null; name: string; failureMessage: string | null; previousStatus: string | 'missing' }> = []
    const fixed: Array<{ suite: string; classname: string | null; name: string; previousMessage: string | null }> = []

    for (const c of current) {
      const prev = prevByKey.get(keyOf(c))
      const isCurrentFail = c.status === 'fail' || c.status === 'error'
      const prevStatus = prev?.status ?? 'missing'
      const wasPrevFail = prev && (prev.status === 'fail' || prev.status === 'error')

      if (isCurrentFail && !wasPrevFail) {
        newFailures.push({
          suite: c.suite,
          classname: c.classname,
          name: c.name,
          failureMessage: c.failureMessage,
          previousStatus: prevStatus
        })
      }
      if (!isCurrentFail && c.status !== 'skip' && wasPrevFail) {
        fixed.push({
          suite: c.suite,
          classname: c.classname,
          name: c.name,
          previousMessage: prev!.failureMessage
        })
      }
    }

    return {
      newFailures,
      fixed,
      previousRunId,
      totalComparedAgainst: prevScenarios.length
    }
  })

  app.get('/api/projects/:slug/slowest', async (req, reply) => {
    const { slug } = req.params as { slug: string }
    const project = await findProjectBySlug(slug)
    if (!project) { reply.code(404); return { error: 'project not found' } }

    const limit = Number((req.query as { limit?: string })?.limit ?? 15)

    const rows = await db
      .select({
        suite: scenarioRuns.suite,
        name: scenarioRuns.name,
        classname: scenarioRuns.classname,
        durationMs: scenarioRuns.durationMs,
        status: scenarioRuns.status
      })
      .from(scenarioRuns)
      .innerJoin(runs, eq(scenarioRuns.runId, runs.id))
      .where(eq(runs.projectId, project.id))

    type Agg = { suite: string; name: string; classname: string | null; samples: number[]; appearances: number; fails: number }
    const agg = new Map<string, Agg>()

    for (const r of rows) {
      if (r.durationMs === null || r.durationMs === undefined) continue
      const key = `${r.suite}::${r.classname ?? ''}::${r.name}`
      const bucket = agg.get(key) ?? { suite: r.suite, name: r.name, classname: r.classname, samples: [], appearances: 0, fails: 0 }
      bucket.samples.push(r.durationMs)
      bucket.appearances += 1
      if (r.status === 'fail' || r.status === 'error') bucket.fails += 1
      agg.set(key, bucket)
    }

    const out = Array.from(agg.values()).map(a => {
      const sorted = [...a.samples].sort((x, y) => x - y)
      const avg = Math.round(sorted.reduce((x, y) => x + y, 0) / sorted.length)
      const max = sorted[sorted.length - 1]
      const p95 = sorted[Math.max(0, Math.floor(sorted.length * 0.95) - 1)]
      return {
        suite: a.suite,
        name: a.name,
        classname: a.classname,
        appearances: a.appearances,
        fails: a.fails,
        avgMs: avg,
        maxMs: max,
        p95Ms: p95
      }
    }).sort((a, b) => b.avgMs - a.avgMs).slice(0, limit)

    const totalMs = out.reduce((acc, s) => acc + s.avgMs * s.appearances, 0)
    return { slowest: out, totalTimeInSampleMs: totalMs }
  })

  app.patch('/api/projects/:slug', async (req, reply) => {
    const { slug } = req.params as { slug: string }
    const project = await findProjectBySlug(slug)
    if (!project) { reply.code(404); return { error: 'project not found' } }

    const body = z.object({
      name: z.string().min(1).optional(),
      slackWebhookUrl: z.string().nullable().optional()
    }).safeParse(req.body)
    if (!body.success) { reply.code(400); return { error: 'invalid payload', details: body.error.flatten() } }

    const updates: Record<string, unknown> = {}
    if (body.data.name !== undefined) updates.name = body.data.name
    if (body.data.slackWebhookUrl !== undefined) {
      updates.slackWebhookUrl = body.data.slackWebhookUrl && body.data.slackWebhookUrl.length > 0 ? body.data.slackWebhookUrl : null
    }

    if (Object.keys(updates).length === 0) return { project }

    const [updated] = await db
      .update(projects)
      .set(updates)
      .where(eq(projects.id, project.id))
      .returning()
    return { project: { ...updated, slackWebhookUrl: updated.slackWebhookUrl ? '<configured>' : null } }
  })

  app.get('/api/runs/:id/scenarios', async (req, reply) => {
    const { id } = req.params as { id: string }
    const rows = await db.select().from(scenarioRuns).where(eq(scenarioRuns.runId, id))
    if (rows.length === 0) { reply.code(200); return { scenarios: [], counts: { pass: 0, fail: 0, skip: 0, error: 0 } } }
    const counts = { pass: 0, fail: 0, skip: 0, error: 0 }
    for (const s of rows) counts[s.status as keyof typeof counts] += 1
    return { scenarios: rows, counts }
  })

  app.get('/api/projects/:slug/flaky', async (req, reply) => {
    const { slug } = req.params as { slug: string }
    const project = await findProjectBySlug(slug)
    if (!project) { reply.code(404); return { error: 'project not found' } }

    const minRuns = Number((req.query as { minRuns?: string })?.minRuns ?? 3)

    const rows = await db
      .select({
        suite: scenarioRuns.suite,
        name: scenarioRuns.name,
        classname: scenarioRuns.classname,
        status: scenarioRuns.status,
        runId: scenarioRuns.runId,
        createdAt: runs.createdAt,
        failureMessage: scenarioRuns.failureMessage
      })
      .from(scenarioRuns)
      .innerJoin(runs, eq(scenarioRuns.runId, runs.id))
      .where(eq(runs.projectId, project.id))
      .orderBy(runs.createdAt)

    type Key = string
    const groups = new Map<Key, {
      suite: string
      name: string
      classname: string | null
      appearances: number
      passes: number
      fails: number
      skips: number
      history: Array<{ createdAt: string; status: string; runId: string; failureMessage: string | null }>
    }>()

    for (const r of rows) {
      const key = `${r.suite}::${r.classname ?? ''}::${r.name}`
      const bucket = groups.get(key) ?? {
        suite: r.suite,
        name: r.name,
        classname: r.classname,
        appearances: 0,
        passes: 0,
        fails: 0,
        skips: 0,
        history: []
      }
      bucket.appearances += 1
      if (r.status === 'pass') bucket.passes += 1
      else if (r.status === 'fail' || r.status === 'error') bucket.fails += 1
      else if (r.status === 'skip') bucket.skips += 1
      bucket.history.push({
        createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
        status: r.status,
        runId: r.runId,
        failureMessage: r.failureMessage
      })
      groups.set(key, bucket)
    }

    const flaky: Array<{
      suite: string; name: string; classname: string | null;
      appearances: number; passes: number; fails: number;
      passRate: number; flipCount: number;
      history: Array<{ createdAt: string; status: string; runId: string; failureMessage: string | null }>
    }> = []

    for (const g of groups.values()) {
      if (g.appearances < minRuns) continue
      const executed = g.passes + g.fails
      if (executed === 0) continue
      if (g.passes === 0 || g.fails === 0) continue

      let flipCount = 0
      let prev: string | null = null
      for (const h of g.history) {
        if (h.status === 'skip') continue
        if (prev !== null && prev !== h.status) flipCount += 1
        prev = h.status
      }

      flaky.push({
        suite: g.suite,
        name: g.name,
        classname: g.classname,
        appearances: g.appearances,
        passes: g.passes,
        fails: g.fails,
        passRate: Math.round((g.passes / executed) * 100),
        flipCount,
        history: g.history
      })
    }

    flaky.sort((a, b) => b.flipCount - a.flipCount || a.passRate - b.passRate)

    const RETRY_RULES = [
      'karate-configure-retry-in-scenario',
      'karate-excessive-retry-window',
      'karate-retry-plus-sleep',
      'karate-explicit-sleep'
    ]

    const flakyNames = flaky.map(f => f.name).filter((n): n is string => !!n)
    const scenarioIssueRows = flakyNames.length > 0
      ? await db
        .select({
          scenarioName: issues.scenarioName,
          rule: issues.rule
        })
        .from(issues)
        .innerJoin(runs, eq(issues.runId, runs.id))
        .where(and(
          eq(runs.projectId, project.id),
          inArray(issues.scenarioName, flakyNames),
          inArray(issues.rule, RETRY_RULES)
        ))
      : []

    const hintsByScenario = new Map<string, Set<string>>()
    for (const row of scenarioIssueRows) {
      if (!row.scenarioName) continue
      const set = hintsByScenario.get(row.scenarioName) ?? new Set<string>()
      set.add(row.rule)
      hintsByScenario.set(row.scenarioName, set)
    }

    const enriched = flaky.map(f => ({
      ...f,
      staticHints: Array.from(hintsByScenario.get(f.name) ?? []).sort()
    }))

    return { flaky: enriched, minRuns, totalScenariosTracked: groups.size }
  })

  app.get('/api/projects/:slug/health', async (req, reply) => {
    const { slug } = req.params as { slug: string }
    const project = await findProjectBySlug(slug)
    if (!project) { reply.code(404); return { error: 'project not found' } }

    const [latestRun] = await db
      .select()
      .from(runs)
      .where(eq(runs.projectId, project.id))
      .orderBy(desc(runs.createdAt))
      .limit(1)

    if (!latestRun) return { score: null, note: 'no runs yet', components: [] }

    const runCreatedAt = latestRun.createdAt instanceof Date ? latestRun.createdAt : new Date(latestRun.createdAt)
    const { score, components } = await computeHealthForRun(project.id, latestRun.id, runCreatedAt, latestRun.score, latestRun.criticalIssues)

    return {
      score,
      components,
      basedOn: {
        runId: latestRun.id,
        createdAt: latestRun.createdAt
      }
    }
  })

  app.get('/api/projects/:slug/health-trend', async (req, reply) => {
    const { slug } = req.params as { slug: string }
    const project = await findProjectBySlug(slug)
    if (!project) { reply.code(404); return { error: 'project not found' } }

    const rows = await db
      .select({ id: runs.id, createdAt: runs.createdAt, score: runs.score, healthScore: runs.healthScore })
      .from(runs)
      .where(eq(runs.projectId, project.id))
      .orderBy(runs.createdAt)

    return {
      trend: rows.map(r => ({
        runId: r.id,
        createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
        staticScore: r.score,
        healthScore: r.healthScore
      }))
    }
  })

  app.get('/api/projects/:slug/digest', async (req, reply) => {
    const { slug } = req.params as { slug: string }
    const project = await findProjectBySlug(slug)
    if (!project) { reply.code(404); return { error: 'project not found' } }

    const days = Math.max(1, Math.min(90, Number((req.query as { days?: string })?.days ?? 7)))
    const windowStart = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    const windowRuns = await db
      .select()
      .from(runs)
      .where(and(eq(runs.projectId, project.id), gte(runs.createdAt, windowStart)))
      .orderBy(runs.createdAt)

    const scores = windowRuns.map(r => r.score)
    const scoreRange = scores.length > 0
      ? { min: Math.min(...scores), max: Math.max(...scores), latest: scores[scores.length - 1] }
      : null

    const scenariosInWindow = windowRuns.length > 0
      ? await db
        .select({
          suite: scenarioRuns.suite,
          classname: scenarioRuns.classname,
          name: scenarioRuns.name,
          status: scenarioRuns.status,
          durationMs: scenarioRuns.durationMs
        })
        .from(scenarioRuns)
        .innerJoin(runs, eq(scenarioRuns.runId, runs.id))
        .where(and(eq(runs.projectId, project.id), gte(runs.createdAt, windowStart)))
      : []

    type ScenarioAgg = { suite: string; classname: string | null; name: string; passes: number; fails: number; appearances: number; samples: number[] }
    const aggByKey = new Map<string, ScenarioAgg>()
    for (const s of scenariosInWindow) {
      const key = `${s.suite}::${s.classname ?? ''}::${s.name}`
      const b = aggByKey.get(key) ?? { suite: s.suite, classname: s.classname, name: s.name, passes: 0, fails: 0, appearances: 0, samples: [] }
      b.appearances += 1
      if (s.status === 'pass') b.passes += 1
      else if (s.status === 'fail' || s.status === 'error') b.fails += 1
      if (s.durationMs !== null && s.durationMs !== undefined) b.samples.push(s.durationMs)
      aggByKey.set(key, b)
    }

    const flakyTop = Array.from(aggByKey.values())
      .filter(b => b.appearances >= 3 && b.passes > 0 && b.fails > 0)
      .map(b => ({ suite: b.suite, classname: b.classname, name: b.name, passRate: Math.round((b.passes / (b.passes + b.fails)) * 100), appearances: b.appearances }))
      .sort((a, b) => a.passRate - b.passRate)
      .slice(0, 5)

    const slowestTop = Array.from(aggByKey.values())
      .filter(b => b.samples.length > 0)
      .map(b => {
        const avg = Math.round(b.samples.reduce((x, y) => x + y, 0) / b.samples.length)
        return { suite: b.suite, classname: b.classname, name: b.name, avgMs: avg, appearances: b.appearances }
      })
      .sort((a, b) => b.avgMs - a.avgMs)
      .slice(0, 5)

    const gapSuggestionsInWindow = await db
      .select({ count: sql<number>`count(*)::int`.as('count') })
      .from(gapSuggestions)
      .where(and(eq(gapSuggestions.projectId, project.id), gte(gapSuggestions.createdAt, windowStart)))
    const newSuggestionCount = gapSuggestionsInWindow[0]?.count ?? 0

    const totalCriticals = windowRuns.reduce((a, r) => a + r.criticalIssues, 0)

    return {
      project: { slug: project.slug, name: project.name },
      windowDays: days,
      windowStart: windowStart.toISOString(),
      runsInWindow: windowRuns.length,
      scoreRange,
      totalCriticals,
      flakyTop,
      slowestTop,
      newSuggestionCount
    }
  })

  app.post('/api/projects/:slug/digest/send', async (req, reply) => {
    const { slug } = req.params as { slug: string }
    const project = await findProjectBySlug(slug)
    if (!project) { reply.code(404); return { error: 'project not found' } }
    if (!project.slackWebhookUrl) { reply.code(400); return { error: 'project has no Slack webhook configured' } }

    const days = Math.max(1, Math.min(90, Number((req.body as { days?: number })?.days ?? 7)))
    const res = await app.inject({ method: 'GET', url: `/api/projects/${slug}/digest?days=${days}` })
    const digest = res.json() as {
      project: { name: string }
      windowDays: number
      runsInWindow: number
      scoreRange: { min: number; max: number; latest: number } | null
      totalCriticals: number
      flakyTop: Array<{ name: string; classname: string | null; passRate: number }>
      slowestTop: Array<{ name: string; classname: string | null; avgMs: number }>
      newSuggestionCount: number
    }

    const lines: string[] = []
    lines.push(`:chart_with_upwards_trend: *${digest.project.name}* — weekly digest (last ${digest.windowDays}d)`)
    if (!digest.scoreRange) {
      lines.push(`_No runs in the window._`)
    } else {
      lines.push(`Runs: *${digest.runsInWindow}* · score range *${digest.scoreRange.min}–${digest.scoreRange.max}* (latest ${digest.scoreRange.latest}) · criticals ${digest.totalCriticals} · new suggestions ${digest.newSuggestionCount}`)
    }
    if (digest.flakyTop.length > 0) {
      lines.push('')
      lines.push(`*Top flaky:*`)
      for (const f of digest.flakyTop) lines.push(`• ${f.name} — ${f.passRate}% pass`)
    }
    if (digest.slowestTop.length > 0) {
      lines.push('')
      lines.push(`*Slowest:*`)
      for (const s of digest.slowestTop) {
        const dur = s.avgMs < 1000 ? `${s.avgMs}ms` : `${(s.avgMs / 1000).toFixed(1)}s`
        lines.push(`• ${s.name} — ${dur} avg`)
      }
    }

    const body = {
      text: lines[0],
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } }
      ]
    }

    try {
      const webhookRes = await fetch(project.slackWebhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      })
      if (!webhookRes.ok) {
        reply.code(502)
        return { error: `Slack rejected: ${webhookRes.status}` }
      }
    } catch (err) {
      reply.code(502)
      return { error: `Slack delivery failed: ${err instanceof Error ? err.message : String(err)}` }
    }

    return { delivered: true, preview: lines.join('\n') }
  })

  app.get('/api/projects/:slug/branches', async (req, reply) => {
    const { slug } = req.params as { slug: string }
    const project = await findProjectBySlug(slug)
    if (!project) { reply.code(404); return { error: 'project not found' } }

    const rows = await db
      .select({
        branch: runs.branch,
        runCount: sql<number>`count(*)::int`.as('run_count'),
        lastRunAt: sql<string>`max(${runs.createdAt})`.as('last_run_at')
      })
      .from(runs)
      .where(eq(runs.projectId, project.id))
      .groupBy(runs.branch)
      .orderBy(sql`max(${runs.createdAt}) desc`)

    return { branches: rows.filter(r => r.branch !== null).map(r => ({ branch: r.branch as string, runCount: r.runCount, lastRunAt: r.lastRunAt })) }
  })

  app.get('/api/projects/:slug/branch-comparison', async (req, reply) => {
    const { slug } = req.params as { slug: string }
    const project = await findProjectBySlug(slug)
    if (!project) { reply.code(404); return { error: 'project not found' } }

    const q = req.query as { base?: string; compare?: string }
    if (!q.base || !q.compare) { reply.code(400); return { error: 'base and compare query params required' } }

    async function latestRunOnBranch(branch: string) {
      const [r] = await db
        .select()
        .from(runs)
        .where(and(eq(runs.projectId, project.id), eq(runs.branch, branch)))
        .orderBy(desc(runs.createdAt))
        .limit(1)
      return r ?? null
    }

    const baseRun = await latestRunOnBranch(q.base)
    const compareRun = await latestRunOnBranch(q.compare)
    if (!baseRun || !compareRun) {
      reply.code(404)
      return { error: 'no runs on one or both branches', base: !!baseRun, compare: !!compareRun }
    }

    async function scenariosForRun(runId: string) {
      return await db.select().from(scenarioRuns).where(eq(scenarioRuns.runId, runId))
    }
    async function endpointsForRun(runId: string) {
      const rows = await db
        .selectDistinct({ verb: runEndpoints.verb, path: runEndpoints.path })
        .from(runEndpoints)
        .where(eq(runEndpoints.runId, runId))
      return rows
    }

    const [baseScenarios, compareScenarios, baseEndpoints, compareEndpoints, targets] = await Promise.all([
      scenariosForRun(baseRun.id),
      scenariosForRun(compareRun.id),
      endpointsForRun(baseRun.id),
      endpointsForRun(compareRun.id),
      db.select({ verb: coverageTargets.verb, path: coverageTargets.path })
        .from(coverageTargets)
        .where(eq(coverageTargets.projectId, project.id))
    ])

    function computeCoverage(eps: Array<{ verb: string; path: string }>): number | null {
      if (targets.length === 0) return null
      const byVerb = new Map<string, string[]>()
      for (const r of eps) {
        const v = r.verb.toUpperCase()
        const arr = byVerb.get(v) ?? []
        arr.push(r.path)
        byVerb.set(v, arr)
      }
      const cov = targets.filter(t => {
        const paths = byVerb.get(t.verb.toUpperCase()) ?? []
        return paths.some(p => p === t.path || p.endsWith(t.path))
      }).length
      return Math.round((cov / targets.length) * 100)
    }

    const keyOf = (s: { suite: string; classname: string | null; name: string }) =>
      `${s.suite}::${s.classname ?? ''}::${s.name}`
    const baseByKey = new Map<string, typeof baseScenarios[number]>()
    for (const s of baseScenarios) baseByKey.set(keyOf(s), s)

    const newFailures: Array<{ suite: string; classname: string | null; name: string; failureMessage: string | null }> = []
    const fixed: Array<{ suite: string; classname: string | null; name: string }> = []
    const slower: Array<{ suite: string; classname: string | null; name: string; baseMs: number; compareMs: number; deltaMs: number }> = []
    const faster: Array<{ suite: string; classname: string | null; name: string; baseMs: number; compareMs: number; deltaMs: number }> = []

    for (const c of compareScenarios) {
      const b = baseByKey.get(keyOf(c))
      const cFail = c.status === 'fail' || c.status === 'error'
      const bFail = b && (b.status === 'fail' || b.status === 'error')
      if (cFail && !bFail) newFailures.push({ suite: c.suite, classname: c.classname, name: c.name, failureMessage: c.failureMessage })
      if (!cFail && c.status !== 'skip' && bFail) fixed.push({ suite: c.suite, classname: c.classname, name: c.name })
      if (b && b.durationMs !== null && b.durationMs !== undefined && c.durationMs !== null && c.durationMs !== undefined) {
        const delta = c.durationMs - b.durationMs
        if (Math.abs(delta) >= 250 && b.durationMs > 0 && Math.abs(delta / b.durationMs * 100) >= 30) {
          const entry = { suite: c.suite, classname: c.classname, name: c.name, baseMs: b.durationMs, compareMs: c.durationMs, deltaMs: delta }
          if (delta > 0) slower.push(entry); else faster.push(entry)
        }
      }
    }
    slower.sort((a, b) => b.deltaMs - a.deltaMs)
    faster.sort((a, b) => a.deltaMs - b.deltaMs)

    return {
      base: { branch: q.base, runId: baseRun.id, score: baseRun.score, healthScore: baseRun.healthScore, criticals: baseRun.criticalIssues, createdAt: baseRun.createdAt, coveragePercent: computeCoverage(baseEndpoints) },
      compare: { branch: q.compare, runId: compareRun.id, score: compareRun.score, healthScore: compareRun.healthScore, criticals: compareRun.criticalIssues, createdAt: compareRun.createdAt, coveragePercent: computeCoverage(compareEndpoints) },
      scenarioChanges: {
        newFailures,
        fixed,
        slower,
        faster
      }
    }
  })

  app.get('/api/runs/:id/timing-changes', async (req, reply) => {
    const { id } = req.params as { id: string }
    const [run] = await db.select().from(runs).where(eq(runs.id, id))
    if (!run) { reply.code(404); return { error: 'run not found' } }

    const current = await db.select().from(scenarioRuns).where(eq(scenarioRuns.runId, id))
    if (current.length === 0) {
      return { slower: [], faster: [], previousRunId: null, note: 'no scenario results in this run' }
    }

    const prevRuns = await db
      .select({ id: runs.id })
      .from(runs)
      .where(and(eq(runs.projectId, run.projectId), lt(runs.createdAt, run.createdAt)))
      .orderBy(desc(runs.createdAt))
      .limit(10)

    let previousRunId: string | null = null
    let prevScenarios: typeof current = []
    for (const pr of prevRuns) {
      const rows = await db.select().from(scenarioRuns).where(eq(scenarioRuns.runId, pr.id))
      if (rows.length > 0) {
        previousRunId = pr.id
        prevScenarios = rows
        break
      }
    }

    if (!previousRunId) {
      return { slower: [], faster: [], previousRunId: null, note: 'no previous run with scenarios' }
    }

    const DELTA_PERCENT_THRESHOLD = 30
    const DELTA_ABS_MS_THRESHOLD = 250

    const keyOf = (s: { suite: string; classname: string | null; name: string }) =>
      `${s.suite}::${s.classname ?? ''}::${s.name}`
    const prevByKey = new Map<string, typeof prevScenarios[number]>()
    for (const s of prevScenarios) prevByKey.set(keyOf(s), s)

    const slower: Array<{ suite: string; classname: string | null; name: string; previousMs: number; currentMs: number; deltaMs: number; deltaPercent: number }> = []
    const faster: Array<{ suite: string; classname: string | null; name: string; previousMs: number; currentMs: number; deltaMs: number; deltaPercent: number }> = []

    for (const c of current) {
      if (c.durationMs === null || c.durationMs === undefined) continue
      const prev = prevByKey.get(keyOf(c))
      if (!prev || prev.durationMs === null || prev.durationMs === undefined) continue
      if (prev.durationMs === 0) continue

      const deltaMs = c.durationMs - prev.durationMs
      const deltaPercent = Math.round((deltaMs / prev.durationMs) * 100)
      if (Math.abs(deltaMs) < DELTA_ABS_MS_THRESHOLD) continue
      if (Math.abs(deltaPercent) < DELTA_PERCENT_THRESHOLD) continue

      const entry = {
        suite: c.suite,
        classname: c.classname,
        name: c.name,
        previousMs: prev.durationMs,
        currentMs: c.durationMs,
        deltaMs,
        deltaPercent
      }
      if (deltaMs > 0) slower.push(entry)
      else faster.push(entry)
    }

    slower.sort((a, b) => b.deltaMs - a.deltaMs)
    faster.sort((a, b) => a.deltaMs - b.deltaMs)

    return {
      slower,
      faster,
      previousRunId,
      thresholds: { deltaPercent: DELTA_PERCENT_THRESHOLD, deltaAbsMs: DELTA_ABS_MS_THRESHOLD }
    }
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

  app.get('/api/projects/:slug/coverage-history', async (req, reply) => {
    const { slug } = req.params as { slug: string }
    const project = await findProjectBySlug(slug)
    if (!project) { reply.code(404); return { error: 'project not found' } }

    const targets = await db
      .select({ verb: coverageTargets.verb, path: coverageTargets.path, domain: coverageTargets.domain, summary: coverageTargets.summary })
      .from(coverageTargets)
      .where(eq(coverageTargets.projectId, project.id))
    if (targets.length === 0) return { history: [], targetCount: 0 }

    const targetKeys = targets.map(t => `${t.verb.toUpperCase()} ${t.path}`)
    const targetMeta = new Map<string, { verb: string; path: string; domain: string | null; summary: string | null }>()
    for (const t of targets) targetMeta.set(`${t.verb.toUpperCase()} ${t.path}`, t)

    const endpointRows = await db
      .select({
        runId: runEndpoints.runId,
        verb: runEndpoints.verb,
        path: runEndpoints.path,
        createdAt: runs.createdAt
      })
      .from(runEndpoints)
      .innerJoin(runs, eq(runEndpoints.runId, runs.id))
      .where(eq(runs.projectId, project.id))
      .orderBy(runs.createdAt)

    const byRun = new Map<string, { createdAt: string; endpointsHit: Set<string> }>()
    for (const r of endpointRows) {
      const createdAt = r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt)
      const bucket = byRun.get(r.runId) ?? { createdAt, endpointsHit: new Set<string>() }
      bucket.endpointsHit.add(`${r.verb.toUpperCase()} ${r.path}`)
      byRun.set(r.runId, bucket)
    }

    function targetsCoveredByRun(endpointsHit: Set<string>): Set<string> {
      const covered = new Set<string>()
      for (const tk of targetKeys) {
        const [verb, path] = [tk.split(' ', 2)[0], tk.slice(tk.indexOf(' ') + 1)]
        for (const hit of endpointsHit) {
          if (!hit.startsWith(verb + ' ')) continue
          const p = hit.slice(verb.length + 1)
          if (p === path || p.endsWith(path)) { covered.add(tk); break }
        }
      }
      return covered
    }

    const sortedRuns = Array.from(byRun.entries())
      .map(([runId, v]) => ({ runId, ...v }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))

    const history: Array<{
      runId: string
      createdAt: string
      totalCovered: number
      totalTargets: number
      gained: Array<{ verb: string; path: string; domain: string | null; summary: string | null }>
      lost: Array<{ verb: string; path: string; domain: string | null; summary: string | null }>
    }> = []

    let prevCovered = new Set<string>()
    for (const r of sortedRuns) {
      if (r.endpointsHit.size === 0) continue
      const covered = targetsCoveredByRun(r.endpointsHit)
      const gainedKeys = [...covered].filter(k => !prevCovered.has(k))
      const lostKeys = [...prevCovered].filter(k => !covered.has(k))
      history.push({
        runId: r.runId,
        createdAt: r.createdAt,
        totalCovered: covered.size,
        totalTargets: targets.length,
        gained: gainedKeys.map(k => targetMeta.get(k)!).filter(Boolean),
        lost: lostKeys.map(k => targetMeta.get(k)!).filter(Boolean)
      })
      prevCovered = covered
    }

    return { history: history.reverse(), targetCount: targets.length }
  })

  app.get('/api/projects/:slug/coverage-trend', async (req, reply) => {
    const { slug } = req.params as { slug: string }
    const project = await findProjectBySlug(slug)
    if (!project) { reply.code(404); return { error: 'project not found' } }

    const targets = await db
      .select({ verb: coverageTargets.verb, path: coverageTargets.path })
      .from(coverageTargets)
      .where(eq(coverageTargets.projectId, project.id))

    if (targets.length === 0) return { trend: [] }

    const endpointRows = await db
      .select({
        runId: runEndpoints.runId,
        verb: runEndpoints.verb,
        path: runEndpoints.path,
        createdAt: runs.createdAt
      })
      .from(runEndpoints)
      .innerJoin(runs, eq(runEndpoints.runId, runs.id))
      .where(eq(runs.projectId, project.id))
      .orderBy(runs.createdAt)

    const byRun = new Map<string, { createdAt: string; endpoints: Set<string> }>()
    for (const r of endpointRows) {
      const createdAt = r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt)
      const bucket = byRun.get(r.runId) ?? { createdAt, endpoints: new Set<string>() }
      bucket.endpoints.add(`${r.verb.toUpperCase()} ${r.path}`)
      byRun.set(r.runId, bucket)
    }

    const trend = Array.from(byRun.entries()).map(([runId, { createdAt, endpoints }]) => {
      let coveredCount = 0
      for (const t of targets) {
        const verb = t.verb.toUpperCase()
        for (const key of endpoints) {
          if (!key.startsWith(verb + ' ')) continue
          const p = key.slice(verb.length + 1)
          if (p === t.path || p.endsWith(t.path)) { coveredCount++; break }
        }
      }
      return {
        runId,
        createdAt,
        covered: coveredCount,
        total: targets.length,
        coveragePercent: Math.round((coveredCount / targets.length) * 100)
      }
    })

    trend.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    return { trend }
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
