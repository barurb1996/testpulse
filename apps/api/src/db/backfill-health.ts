import { and, eq, lt, desc } from 'drizzle-orm'
import { db, pool } from './index.js'
import { runs, projects, coverageTargets, runEndpoints, scenarioRuns } from './schema.js'

async function computeForRun(projectId: string, runId: string, createdAt: Date, thisScore: number, thisCriticals: number): Promise<number> {
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
      .where(and(eq(runs.projectId, projectId), lt(runs.createdAt, new Date(createdAt.getTime() + 1))))
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

  const allScenarios = await db
    .select({ suite: scenarioRuns.suite, classname: scenarioRuns.classname, name: scenarioRuns.name, status: scenarioRuns.status })
    .from(scenarioRuns)
    .innerJoin(runs, eq(scenarioRuns.runId, runs.id))
    .where(and(eq(runs.projectId, projectId), lt(runs.createdAt, new Date(createdAt.getTime() + 1))))

  const keys = new Map<string, { passes: number; fails: number; appearances: number }>()
  for (const s of allScenarios) {
    const k = `${s.suite}::${s.classname ?? ''}::${s.name}`
    const b = keys.get(k) ?? { passes: 0, fails: 0, appearances: 0 }
    b.appearances += 1
    if (s.status === 'pass') b.passes += 1
    else if (s.status === 'fail' || s.status === 'error') b.fails += 1
    keys.set(k, b)
  }
  const flakyCount = Array.from(keys.values()).filter(b => b.appearances >= 3 && b.passes > 0 && b.fails > 0).length

  const thisScenarios = await db.select().from(scenarioRuns).where(eq(scenarioRuns.runId, runId))
  let regressionCount = 0
  if (thisScenarios.length > 0) {
    const prevRuns = await db
      .select({ id: runs.id })
      .from(runs)
      .where(and(eq(runs.projectId, projectId), lt(runs.createdAt, createdAt)))
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

  const staticScore = thisScore
  const coverageScore = coveragePercent ?? 0
  const flakyScore = Math.max(0, 100 - flakyCount * 8)
  const regressionScore = Math.max(0, 100 - regressionCount * 12)
  const criticalScore = Math.max(0, 100 - thisCriticals * 10)

  const components = [
    { score: staticScore, weight: 30 },
    { score: coverageScore, weight: coveragePercent === null ? 0 : 30 },
    { score: flakyScore, weight: 15 },
    { score: regressionScore, weight: 10 },
    { score: criticalScore, weight: 10 }
  ]
  const totalWeight = components.reduce((a, c) => a + c.weight, 0)
  const weightedSum = components.reduce((a, c) => a + c.score * c.weight, 0)
  return totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0
}

async function run() {
  const allRuns = await db
    .select({ id: runs.id, projectId: runs.projectId, createdAt: runs.createdAt, score: runs.score, criticalIssues: runs.criticalIssues })
    .from(runs)
    .orderBy(runs.createdAt)

  console.log(`Backfilling health_score for ${allRuns.length} runs…`)
  let updated = 0
  for (const r of allRuns) {
    const createdAt = r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt)
    const health = await computeForRun(r.projectId, r.id, createdAt, r.score, r.criticalIssues)
    await db.update(runs).set({ healthScore: health }).where(eq(runs.id, r.id))
    updated++
    if (updated % 10 === 0) console.log(`  ${updated}/${allRuns.length}`)
  }
  console.log(`✓ ${updated} runs updated`)

  const projectsList = await db.select({ slug: projects.slug, id: projects.id }).from(projects)
  for (const p of projectsList) {
    const [latest] = await db.select({ healthScore: runs.healthScore }).from(runs).where(eq(runs.projectId, p.id)).orderBy(desc(runs.createdAt)).limit(1)
    if (latest) console.log(`  ${p.slug}: latest healthScore = ${latest.healthScore}`)
  }

  await pool.end()
}

run().catch(err => { console.error(err); process.exit(1) })
