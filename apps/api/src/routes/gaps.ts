import { createHash } from 'crypto'
import type { FastifyInstance } from 'fastify'
import { and, eq, inArray } from 'drizzle-orm'
import Anthropic from '@anthropic-ai/sdk'
import { db } from '../db/index.js'
import { projects, coverageTargets, runs, runEndpoints, gapSuggestions, projectDocs } from '../db/schema.js'

const MODEL = 'claude-haiku-4-5-20251001'

const SYSTEM_PROMPT = `You are a senior QA engineer auditing API test coverage for a production backend.
Your job: given an endpoint that has little or no test coverage, identify the specific test scenarios that SHOULD exist but are missing.

Focus on:
- Security & auth: missing token, expired token, wrong role/tenant, cross-user data access
- Validation: missing required fields, invalid types, boundary values, oversize payloads
- Error paths: 404 on unknown id, 409 conflict, 422 unprocessable, idempotency
- State transitions: invalid prior state, duplicate action, race conditions
- Domain-specific business rules inferred from the endpoint summary

Do NOT suggest:
- Generic "happy path" scenarios (assume they exist)
- Load/performance tests
- Tests that require runtime context you cannot know

For each suggestion, be specific. A bad suggestion: "Test error handling". A good one: "Rejects transfer when source account has insufficient balance with 422 and error.code = INSUFFICIENT_FUNDS".

Return 3 to 5 suggestions per endpoint. Severity:
- critical: security/auth gaps, financial correctness, data leakage
- warning: validation gaps, state-transition bugs, missing error paths
- info: edge cases, polish, nice-to-haves`

const SUGGEST_TOOL = {
  name: 'suggest_missing_tests',
  description: 'Emit the list of missing test scenarios for this endpoint.',
  input_schema: {
    type: 'object' as const,
    properties: {
      suggestions: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            title: { type: 'string' as const, description: 'One-line test title (what it verifies).' },
            rationale: { type: 'string' as const, description: 'One short sentence: why this test matters.' },
            severity: { type: 'string' as const, enum: ['critical', 'warning', 'info'] },
            steps: {
              type: 'array' as const,
              items: { type: 'string' as const },
              description: '3-6 Gherkin steps (Given/When/Then form).'
            }
          },
          required: ['title', 'rationale', 'severity', 'steps']
        }
      }
    },
    required: ['suggestions']
  }
}

interface EndpointCtx {
  targetId: string
  verb: string
  path: string
  summary: string | null
  operationId: string | null
  domain: string | null
  existingScenarios: string[]
  docContext?: string
}

function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '__DS__')
    .replace(/\*/g, '[^/]*')
    .replace(/__DS__/g, '.*')
  return new RegExp(`^${escaped}$`)
}

function pathMatchesAny(path: string, globs: RegExp[]): boolean {
  return globs.some(g => g.test(path))
}

interface Suggestion {
  title: string
  rationale: string
  severity: 'critical' | 'warning' | 'info'
  steps: string[]
}

function endpointHash(ctx: EndpointCtx): string {
  const key = [
    ctx.verb,
    ctx.path,
    ctx.summary ?? '',
    ctx.operationId ?? '',
    ctx.domain ?? '',
    ...ctx.existingScenarios.sort()
  ].join('||')
  return createHash('sha256').update(key).digest('hex').slice(0, 16)
}

async function analyseEndpoint(client: Anthropic, ctx: EndpointCtx): Promise<Suggestion[]> {
  const existingBlock = ctx.existingScenarios.length === 0
    ? 'No tests have been found touching this endpoint.'
    : `Existing scenarios that touch this endpoint:\n${ctx.existingScenarios.map(s => `- ${s}`).join('\n')}`

  const docBlock = ctx.docContext
    ? `\nRELATED DOCUMENTATION (from ingested business docs):\n${ctx.docContext}\n`
    : ''

  const userMessage = `ENDPOINT
${ctx.verb} ${ctx.path}
${ctx.summary ? `Summary: ${ctx.summary}\n` : ''}${ctx.operationId ? `Operation id: ${ctx.operationId}\n` : ''}${ctx.domain ? `Domain: ${ctx.domain}\n` : ''}
${existingBlock}
${docBlock}
List the missing tests via the suggest_missing_tests tool.`

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    tools: [SUGGEST_TOOL],
    tool_choice: { type: 'tool', name: 'suggest_missing_tests' },
    messages: [{ role: 'user', content: userMessage }]
  })

  for (const block of res.content) {
    if (block.type === 'tool_use' && block.name === 'suggest_missing_tests') {
      const input = block.input as { suggestions?: Suggestion[] }
      return input.suggestions ?? []
    }
  }
  return []
}

async function findProjectBySlug(slug: string) {
  const rows = await db.select().from(projects).where(eq(projects.slug, slug))
  return rows[0] ?? null
}

const CODEBASE_TOOL = {
  name: 'extract_codebase_knowledge',
  description: 'Return structured knowledge extracted from application source code.',
  input_schema: {
    type: 'object' as const,
    properties: {
      endpoints: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            verb: { type: 'string' as const },
            path: { type: 'string' as const },
            operationId: { type: 'string' as const },
            summary: { type: 'string' as const },
            domain: { type: 'string' as const }
          },
          required: ['verb', 'path']
        }
      },
      businessRules: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            context: { type: 'string' as const, description: 'Which endpoint or entity this rule applies to' },
            rule: { type: 'string' as const, description: 'The business rule or constraint' }
          },
          required: ['context', 'rule']
        }
      }
    },
    required: ['endpoints', 'businessRules']
  }
}

export async function gapsRoutes(app: FastifyInstance) {
  app.post('/api/projects/:slug/codebase-scan', async (req, reply) => {
    const { slug } = req.params as { slug: string }
    const body = (req.body ?? {}) as { codebaseSummary?: string; fileCount?: number }
    if (!body.codebaseSummary) { reply.code(400); return { error: 'codebaseSummary required' } }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) { reply.code(503); return { error: 'ANTHROPIC_API_KEY not configured' } }

    const project = await db.transaction(async (tx) => {
      const existing = await tx.select().from(projects).where(eq(projects.slug, slug))
      if (existing.length > 0) return existing[0]
      const [created] = await tx.insert(projects).values({ slug, name: slug }).returning()
      return created
    })

    const client = new Anthropic({ apiKey })
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 8192,
      system: `You are analysing application source code to extract API endpoints and business rules. Extract ALL HTTP endpoints (verb, path, handler name, description, domain). Also extract business rules and validation constraints visible in the code. Return via the extract_codebase_knowledge tool.`,
      tools: [CODEBASE_TOOL],
      tool_choice: { type: 'tool', name: 'extract_codebase_knowledge' },
      messages: [{ role: 'user', content: `Here is the application source code (${body.fileCount ?? '?'} files):\n\n${body.codebaseSummary.slice(0, 120_000)}\n\nExtract all endpoints and business rules.` }]
    })

    let endpoints: Array<{ verb: string; path: string; operationId?: string; summary?: string; domain?: string }> = []
    let businessRules: Array<{ context: string; rule: string }> = []

    for (const block of res.content) {
      if (block.type === 'tool_use' && block.name === 'extract_codebase_knowledge') {
        const input = block.input as { endpoints?: typeof endpoints; businessRules?: typeof businessRules }
        endpoints = input.endpoints ?? []
        businessRules = input.businessRules ?? []
      }
    }

    let endpointsInserted = 0
    if (endpoints.length > 0) {
      const existing = await db
        .select({ verb: coverageTargets.verb, path: coverageTargets.path })
        .from(coverageTargets)
        .where(eq(coverageTargets.projectId, project.id))
      const existingKeys = new Set(existing.map(e => `${e.verb.toUpperCase()} ${e.path}`))

      const toInsert = endpoints.filter(e => {
        const normPath = e.path.replace(/\{[^}]+\}/g, ':id')
        return !existingKeys.has(`${e.verb.toUpperCase()} ${normPath}`)
      })

      if (toInsert.length > 0) {
        await db.insert(coverageTargets).values(toInsert.map(e => ({
          projectId: project.id,
          verb: e.verb.toUpperCase(),
          path: e.path.replace(/\{[^}]+\}/g, ':id'),
          operationId: e.operationId ?? null,
          summary: e.summary ?? null,
          domain: e.domain ?? null,
          source: 'codebase-scan'
        })))
        endpointsInserted = toInsert.length
      }
    }

    let docsStored = 0
    if (businessRules.length > 0) {
      const ruleText = businessRules.map(r => `[${r.context}] ${r.rule}`).join('\n')
      const chunks = [{ index: 0, heading: 'Business rules (extracted from codebase)', text: ruleText }]
      const existingDoc = await db.select().from(projectDocs)
        .where(and(eq(projectDocs.projectId, project.id), eq(projectDocs.filename, '[codebase-rules]')))
      if (existingDoc.length > 0) {
        await db.update(projectDocs).set({ contentText: ruleText, chunks, charCount: ruleText.length })
          .where(eq(projectDocs.id, existingDoc[0].id))
      } else {
        await db.insert(projectDocs).values({
          projectId: project.id,
          filename: '[codebase-rules]',
          contentText: ruleText,
          chunks,
          charCount: ruleText.length,
          source: 'codebase-scan-extract'
        })
      }
      docsStored = businessRules.length
    }

    return {
      endpointsFound: endpoints.length,
      endpointsInserted,
      businessRulesExtracted: businessRules.length,
      docsStored,
      model: MODEL
    }
  })

  app.get('/api/projects/:slug/gap-suggestions', async (req, reply) => {
    const { slug } = req.params as { slug: string }
    const project = await findProjectBySlug(slug)
    if (!project) { reply.code(404); return { error: 'project not found' } }

    const rows = await db
      .select({
        id: gapSuggestions.id,
        targetId: gapSuggestions.targetId,
        title: gapSuggestions.title,
        rationale: gapSuggestions.rationale,
        severity: gapSuggestions.severity,
        steps: gapSuggestions.steps,
        model: gapSuggestions.model,
        createdAt: gapSuggestions.createdAt,
        targetVerb: coverageTargets.verb,
        targetPath: coverageTargets.path,
        targetDomain: coverageTargets.domain,
        targetSummary: coverageTargets.summary
      })
      .from(gapSuggestions)
      .innerJoin(coverageTargets, eq(gapSuggestions.targetId, coverageTargets.id))
      .where(eq(gapSuggestions.projectId, project.id))

    return { suggestions: rows }
  })

  app.post('/api/projects/:slug/gap-analyze', async (req, reply) => {
    const { slug } = req.params as { slug: string }
    const body = (req.body ?? {}) as {
      forceRefresh?: boolean
      dryRun?: boolean
      blockedPaths?: string[]
    }
    const { forceRefresh, dryRun } = body
    const blockedGlobs = (body.blockedPaths ?? []).map(globToRegex)

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey && !dryRun) {
      reply.code(503)
      return { error: 'ANTHROPIC_API_KEY not configured on the server' }
    }

    const project = await findProjectBySlug(slug)
    if (!project) { reply.code(404); return { error: 'project not found' } }

    const targets = await db
      .select()
      .from(coverageTargets)
      .where(eq(coverageTargets.projectId, project.id))

    if (targets.length === 0) {
      return { analysed: 0, generated: 0, cached: 0, total: 0, message: 'No coverage targets uploaded yet.' }
    }

    const coveredRows = await db
      .selectDistinct({
        verb: runEndpoints.verb,
        path: runEndpoints.path,
        scenarioName: runEndpoints.scenarioName
      })
      .from(runEndpoints)
      .innerJoin(runs, eq(runEndpoints.runId, runs.id))
      .where(eq(runs.projectId, project.id))

    const scenariosByKey = new Map<string, Set<string>>()
    for (const r of coveredRows) {
      const key = `${r.verb.toUpperCase()} ${r.path}`
      const bucket = scenariosByKey.get(key) ?? new Set<string>()
      if (r.scenarioName) bucket.add(r.scenarioName)
      scenariosByKey.set(key, bucket)
    }

    function matchedScenarios(t: { verb: string; path: string }): string[] {
      const verb = t.verb.toUpperCase()
      const out = new Set<string>()
      for (const [key, names] of scenariosByKey) {
        const [v, p] = key.split(' ', 2)
        if (v !== verb) continue
        if (p === t.path || p.endsWith(t.path)) for (const n of names) out.add(n)
      }
      return Array.from(out).slice(0, 8)
    }

    const docs = await db
      .select({ chunks: projectDocs.chunks, filename: projectDocs.filename })
      .from(projectDocs)
      .where(eq(projectDocs.projectId, project.id))

    type Chunk = { index: number; heading: string | null; text: string }
    const allChunks: Array<{ filename: string; chunk: Chunk }> = []
    for (const d of docs) {
      const parsed = d.chunks as Chunk[]
      if (Array.isArray(parsed)) {
        for (const c of parsed) allChunks.push({ filename: d.filename, chunk: c })
      }
    }

    function findRelevantDocContext(target: { verb: string; path: string; domain: string | null; summary: string | null; operationId?: string | null }): string | undefined {
      if (allChunks.length === 0) return undefined
      const pathSegments = target.path.split('/').filter(s => s && !s.startsWith(':') && !s.startsWith('{') && s.length > 2)
      const keywords = [
        ...pathSegments,
        target.domain,
        target.summary,
        target.operationId
      ].filter((s): s is string => !!s).map(s => s.toLowerCase())

      if (keywords.length === 0) return undefined

      const scored = allChunks.map(({ filename, chunk }) => {
        const lc = (chunk.text + ' ' + (chunk.heading ?? '') + ' ' + filename).toLowerCase()
        let score = 0
        for (const kw of keywords) {
          if (lc.includes(kw)) score += 1
        }
        return { chunk, score }
      }).filter(s => s.score > 0).sort((a, b) => b.score - a.score)

      if (scored.length === 0) return undefined
      const top = scored.slice(0, 3)
      return top.map(s => {
        const heading = s.chunk.heading ? `[${s.chunk.heading}] ` : ''
        return heading + s.chunk.text.slice(0, 800)
      }).join('\n---\n')
    }

    const allCtxs: EndpointCtx[] = targets.map(t => ({
      targetId: t.id,
      verb: t.verb,
      path: t.path,
      summary: t.summary,
      operationId: t.operationId,
      domain: t.domain,
      existingScenarios: matchedScenarios(t),
      docContext: findRelevantDocContext(t)
    }))

    const ctxs = blockedGlobs.length > 0
      ? allCtxs.filter(c => !pathMatchesAny(c.path, blockedGlobs))
      : allCtxs
    const skippedByBlock = allCtxs.length - ctxs.length

    if (dryRun) {
      return {
        dryRun: true,
        wouldAnalyse: ctxs.length,
        skippedByBlock,
        model: MODEL,
        payloads: ctxs.map(c => ({
          verb: c.verb,
          path: c.path,
          summary: c.summary,
          operationId: c.operationId,
          domain: c.domain,
          existingScenarios: c.existingScenarios
        }))
      }
    }

    const client = new Anthropic({ apiKey: apiKey! })

    const existingSuggestions = await db
      .select({ targetId: gapSuggestions.targetId, endpointHash: gapSuggestions.endpointHash })
      .from(gapSuggestions)
      .where(and(eq(gapSuggestions.projectId, project.id), inArray(gapSuggestions.targetId, ctxs.map(c => c.targetId))))

    const existingByTarget = new Map<string, Set<string>>()
    for (const s of existingSuggestions) {
      const bucket = existingByTarget.get(s.targetId) ?? new Set<string>()
      bucket.add(s.endpointHash)
      existingByTarget.set(s.targetId, bucket)
    }

    let generated = 0
    let cached = 0
    let failed = 0
    const errors: string[] = []

    for (const ctx of ctxs) {
      const hash = endpointHash(ctx)
      const existing = existingByTarget.get(ctx.targetId)
      if (!forceRefresh && existing && existing.has(hash)) {
        cached++
        continue
      }

      if (forceRefresh) {
        await db.delete(gapSuggestions)
          .where(and(eq(gapSuggestions.projectId, project.id), eq(gapSuggestions.targetId, ctx.targetId)))
      }

      try {
        const suggestions = await analyseEndpoint(client, ctx)
        if (suggestions.length === 0) continue

        await db.insert(gapSuggestions).values(suggestions.map(s => ({
          projectId: project.id,
          targetId: ctx.targetId,
          title: s.title,
          rationale: s.rationale,
          severity: s.severity,
          steps: s.steps,
          endpointHash: hash,
          model: MODEL
        })))

        generated += suggestions.length
      } catch (err) {
        failed++
        errors.push(`${ctx.verb} ${ctx.path}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    return {
      analysed: ctxs.length,
      generated,
      cached,
      failed,
      skippedByBlock,
      errors: errors.slice(0, 10),
      total: ctxs.length
    }
  })
}
