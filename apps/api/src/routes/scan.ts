import { execFileSync } from 'child_process'
import { mkdtemp, realpath, rm } from 'fs/promises'
import path from 'path'
import os from 'os'
import type { FastifyInstance } from 'fastify'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/index.js'
import { projects, runs, issues, runEndpoints, scenarioRuns } from '../db/schema.js'
import { requireAdmin } from '../gate.js'
import { lookup } from 'dns/promises'
import { isIP } from 'net'
import { encryptIfNeeded, decryptIfNeeded } from '../crypto.js'


// ── input hardening ─────────────────────────────────────────────────────────

const PRIVATE_V4 = /^(0\.|10\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/
function isPrivateAddress(addr: string): boolean {
  const a = addr.toLowerCase()
  if (isIP(a) === 4) return PRIVATE_V4.test(a)
  return a === '::1' || a === '::' || a.startsWith('fc') || a.startsWith('fd') || a.startsWith('fe80') || a.startsWith('::ffff:')
}

/** https only, no embedded credentials, and the host must resolve to public addresses (blocks SSRF to internal services). */
async function assertSafeRepoUrl(raw: string): Promise<URL> {
  const u = new URL(raw)
  if (u.protocol !== 'https:') throw new Error('repoUrl must use https')
  if (u.username || u.password) throw new Error('repoUrl must not contain credentials; use the access-token field')
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('repoUrl host is not allowed')
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true })
  if (addrs.length === 0 || addrs.some(a => isPrivateAddress(a.address))) throw new Error('repoUrl host resolves to a non-public address')
  return u
}

const SAFE_BRANCH = /^(?!-)[a-zA-Z0-9_./-]{1,100}$/
const SAFE_REL_PATH = /^(?!\/)(?!.*(^|\/)\.\.(\/|$))[^\0]{1,200}$/

function sanitizeError(err: unknown, secrets: Array<string | null | undefined>): string {
  let msg = err instanceof Error ? err.message : String(err)
  for (const s of secrets) {
    if (!s) continue
    msg = msg.split(s).join('[redacted]').split(Buffer.from(`x-access-token:${s}`).toString('base64')).join('[redacted]')
  }
  return msg.replace(/https:\/\/[^@\s/]+@/g, 'https://[redacted]@').slice(0, 500)
}

async function resolveInside(root: string, rel: string): Promise<string> {
  const rootReal = await realpath(root)
  const full = await realpath(path.resolve(rootReal, rel))
  if (full !== rootReal && !full.startsWith(rootReal + path.sep)) throw new Error('configured path escapes the repository')
  return full
}

let scanInProgress = false

export async function scanRoutes(app: FastifyInstance) {
  app.patch('/api/projects/:slug/repo', async (req, reply) => {
    if (!requireAdmin(req, reply)) return
    const { slug } = req.params as { slug: string }
    const [project] = await db.select().from(projects).where(eq(projects.slug, slug))
    if (!project) { reply.code(404); return { error: 'not found' } }

    const body = z.object({
      repoUrl: z.string().url().max(500).optional(),
      repoToken: z.string().max(500).optional(),
      repoBranch: z.string().regex(SAFE_BRANCH).optional(),
      testPath: z.string().regex(SAFE_REL_PATH).optional().or(z.literal('')),
      appCodePath: z.string().regex(SAFE_REL_PATH).optional().or(z.literal('')),
      junitPath: z.string().regex(SAFE_REL_PATH).optional().or(z.literal(''))
    }).safeParse(req.body)
    if (!body.success) { reply.code(400); return { error: 'invalid', details: body.error.flatten() } }
    if (body.data.repoUrl) {
      try { await assertSafeRepoUrl(body.data.repoUrl) } catch (e) { reply.code(400); return { error: e instanceof Error ? e.message : 'invalid repoUrl' } }
    }

    const updates: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(body.data)) {
      if (v !== undefined) {
        if (k === 'repoToken' && v) {
          updates[k] = encryptIfNeeded(v as string)
        } else {
          updates[k] = v || null
        }
      }
    }

    if (Object.keys(updates).length > 0) {
      await db.update(projects).set(updates).where(eq(projects.id, project.id))
    }

    return { updated: true }
  })

  app.get('/api/projects/:slug/repo', async (req, reply) => {
    if (!requireAdmin(req, reply)) return
    const { slug } = req.params as { slug: string }
    const [project] = await db.select().from(projects).where(eq(projects.slug, slug))
    if (!project) { reply.code(404); return { error: 'not found' } }

    return {
      repoUrl: project.repoUrl,
      hasToken: !!project.repoToken,
      repoBranch: project.repoBranch ?? 'main',
      testPath: project.testPath ?? '.',
      appCodePath: project.appCodePath,
      junitPath: project.junitPath,
      lastScanAt: project.lastScanAt
    }
  })

  app.post('/api/projects/:slug/scan', async (req, reply) => {
    if (!requireAdmin(req, reply)) return
    const { slug } = req.params as { slug: string }
    const [project] = await db.select().from(projects).where(eq(projects.slug, slug))
    if (!project) { reply.code(404); return { error: 'not found' } }
    if (!project.repoUrl) { reply.code(400); return { error: 'no repo URL configured — set it via Admin or PATCH /projects/:slug/repo' } }

    const body = (req.body ?? {}) as { scanCodebase?: boolean; runGapAnalysis?: boolean }

    if (scanInProgress) { reply.code(429); return { error: 'another scan is already running; try again shortly' } }
    scanInProgress = true

    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'testpulse-scan-'))
    const log: string[] = []
    const rawToken = decryptIfNeeded(project.repoToken)

    try {
      const branch = project.repoBranch ?? 'main'
      if (!/^[a-zA-Z0-9_./-]+$/.test(branch)) {
        reply.code(400)
        return { error: `Invalid branch name "${branch}" — only alphanumeric, dots, slashes, dashes, underscores allowed` }
      }

      const repoUrl = (await assertSafeRepoUrl(project.repoUrl!)).toString()

      // Credentials go via git config in the environment, never in argv or the URL (both leak through logs / `ps`).
      const gitConfig: Array<[string, string]> = [
        ['core.symlinks', 'false'], // a hostile repo cannot plant symlinks that read host files
        ['protocol.file.allow', 'never'],
        ['protocol.ext.allow', 'never'],
        ['http.followRedirects', 'false'],
        ['advice.detachedHead', 'false']
      ]
      if (rawToken) gitConfig.push(['http.extraHeader', `Authorization: Basic ${Buffer.from(`x-access-token:${rawToken}`).toString('base64')}`])
      const gitEnv: NodeJS.ProcessEnv = {
        PATH: process.env.PATH,
        HOME: tmpDir,
        GIT_TERMINAL_PROMPT: '0',
        GIT_ALLOW_PROTOCOL: 'https',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_COUNT: String(gitConfig.length)
      }
      gitConfig.forEach(([k, v], i) => { gitEnv[`GIT_CONFIG_KEY_${i}`] = k; gitEnv[`GIT_CONFIG_VALUE_${i}`] = v })

      log.push(`Cloning ${project.repoUrl} (branch: ${branch})…`)
      execFileSync('git', ['clone', '--depth', '1', '--single-branch', '--no-tags', '--branch', branch, '--', repoUrl, `${tmpDir}/repo`], {
        timeout: 120_000,
        stdio: 'pipe',
        env: gitEnv,
        maxBuffer: 10 * 1024 * 1024
      })
      log.push('Clone complete.')

      const repoRoot = path.join(tmpDir, 'repo')
      const testDir = await resolveInside(repoRoot, project.testPath ?? '.')
      const appDir = project.appCodePath ? await resolveInside(repoRoot, project.appCodePath) : null
      if (project.junitPath && !SAFE_REL_PATH.test(project.junitPath)) throw new Error('junitPath escapes the repository')

      let commitSha: string | null = null
      try {
        commitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, env: gitEnv }).toString().trim().slice(0, 12)
      } catch { /* ignore */ }

      // Dynamic import CLI modules (they're in the same monorepo — CLI must be built first)
      // @ts-expect-error — resolved at runtime from CLI dist
      const { analyzeDirectory } = await import('../../../packages/cli/dist/analyzer.js')
      // @ts-expect-error — resolved at runtime from CLI dist
      const { scanCodebase } = await import('../../../packages/cli/dist/codebase.js')
      // @ts-expect-error — resolved at runtime from CLI dist
      const { loadJunitResults } = await import('../../../packages/cli/dist/junit.js')

      // 1. Static analysis
      log.push(`Analysing tests in ${project.testPath ?? '.'}…`)
      const outcome = await analyzeDirectory(testDir, {})
      const totalIssues = outcome.results.reduce((a: number, r: { issues: unknown[] }) => a + r.issues.length, 0)
      const critical = outcome.results.flatMap((r: { issues: Array<{ severity: string }> }) => r.issues).filter((i: { severity: string }) => i.severity === 'critical').length
      const score = Math.max(0, 100 - (critical * 10) - ((totalIssues - critical) * 3))
      const filesScanned = outcome.results.length

      log.push(`Found ${totalIssues} issues (${critical} critical) across ${filesScanned} files. Score: ${score}/100`)

      // 2. Store run
      const [run] = await db.insert(runs).values({
        projectId: project.id,
        commitSha,
        branch,
        score,
        totalIssues,
        criticalIssues: critical,
        filesScanned
      }).returning()

      // Store issues
      const allIssues = outcome.results.flatMap((r: { file: string; issues: Array<{ line: number; rule: string; severity: string; message: string; fingerprint?: string; scenarioName?: string }> }) =>
        r.issues.map((i) => ({
          runId: run.id,
          file: r.file,
          line: i.line,
          rule: i.rule,
          severity: i.severity,
          message: i.message,
          fingerprint: i.fingerprint ?? null,
          scenarioName: i.scenarioName ?? null
        }))
      )
      if (allIssues.length > 0) {
        await db.insert(issues).values(allIssues)
      }

      // Store endpoints
      if (outcome.endpoints && outcome.endpoints.length > 0) {
        await db.insert(runEndpoints).values(outcome.endpoints.map((e: { verb: string; path: string; file?: string; line?: number; scenarioName?: string }) => ({
          runId: run.id,
          verb: e.verb,
          path: e.path,
          file: e.file,
          line: e.line,
          scenarioName: e.scenarioName
        })))
        log.push(`Extracted ${outcome.endpoints.length} endpoint references.`)
      }

      // 3. JUnit XML (if path configured)
      if (project.junitPath) {
        try {
          const junit = await loadJunitResults(repoRoot, project.junitPath)
          if (junit.results.length > 0) {
            await db.insert(scenarioRuns).values(junit.results.map((s: { suite: string; name: string; classname: string | null; status: string; durationMs: number | null; failureMessage: string | null; failureDetail: string | null }) => ({
              runId: run.id,
              suite: s.suite,
              name: s.name,
              classname: s.classname,
              status: s.status,
              durationMs: s.durationMs,
              failureMessage: s.failureMessage,
              failureDetail: s.failureDetail
            })))
            log.push(`JUnit: ${junit.files.length} files, ${junit.results.length} scenarios ingested.`)
          }
        } catch (err) {
          log.push(`JUnit parse error: ${err instanceof Error ? err.message : String(err)}`)
        }
      }

      // 4. Codebase scan (if appCodePath configured)
      if (appDir && body.scanCodebase !== false) {
        try {
          const codeFiles = await scanCodebase(appDir)
          log.push(`Codebase scan: found ${codeFiles.length} app source files.`)
          // Store as project_docs (raw mode)
          const { projectDocs } = await import('../db/schema.js')
          for (const f of codeFiles.slice(0, 100)) {
            const filename = `[codebase] ${f.relativePath}`
            const chunks = [{ index: 0, heading: `[${f.layer.toUpperCase()}] ${f.relativePath}`, text: f.content.slice(0, 50_000) }]
            const existing = await db.select().from(projectDocs)
              .where(and(eq(projectDocs.projectId, project.id), eq(projectDocs.filename, filename)))
            if (existing.length > 0) {
              await db.update(projectDocs).set({ contentText: f.content.slice(0, 500_000), chunks, charCount: f.content.length })
                .where(eq(projectDocs.id, existing[0].id))
            } else {
              await db.insert(projectDocs).values({
                projectId: project.id,
                filename,
                contentText: f.content.slice(0, 500_000),
                chunks,
                charCount: f.content.length,
                source: 'repo-scan'
              })
            }
          }
        } catch (err) {
          log.push(`Codebase scan error: ${err instanceof Error ? err.message : String(err)}`)
        }
      }

      // 5. Compute health score
      try {
        const { computeHealthForRun } = await import('./runs.js')
        if (typeof computeHealthForRun === 'function') {
          const runCreatedAt = run.createdAt instanceof Date ? run.createdAt : new Date(run.createdAt)
          const health = await computeHealthForRun(project.id, run.id, runCreatedAt, score, critical)
          await db.update(runs).set({ healthScore: health.score }).where(eq(runs.id, run.id))
          log.push(`Health score: ${health.score}/100`)
        }
      } catch { /* non-fatal */ }

      // Update last scan timestamp
      await db.update(projects).set({ lastScanAt: new Date() }).where(eq(projects.id, project.id))

      log.push(`Run ${run.id} saved.`)
      return { runId: run.id, score, totalIssues, critical, filesScanned, log }
    } catch (err) {
      console.error('scan failed:', sanitizeError(err, [rawToken]))
      reply.code(500)
      return { error: 'Scan failed. Check server logs for details.' }
    } finally {
      scanInProgress = false
      try { await rm(tmpDir, { recursive: true, force: true }) } catch { /* cleanup best-effort */ }
    }
  })
}
