import { createHash } from 'crypto'
import type { FastifyInstance } from 'fastify'
import { and, eq, inArray } from 'drizzle-orm'
import Anthropic from '@anthropic-ai/sdk'
import { db } from '../db/index.js'
import { projects, coverageTargets, runs, runEndpoints, gapSuggestions } from '../db/schema.js'

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

  const userMessage = `ENDPOINT
${ctx.verb} ${ctx.path}
${ctx.summary ? `Summary: ${ctx.summary}\n` : ''}${ctx.operationId ? `Operation id: ${ctx.operationId}\n` : ''}${ctx.domain ? `Domain: ${ctx.domain}\n` : ''}
${existingBlock}

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

export async function gapsRoutes(app: FastifyInstance) {
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
    const { forceRefresh } = (req.body ?? {}) as { forceRefresh?: boolean }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
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

    const client = new Anthropic({ apiKey })

    const ctxs: EndpointCtx[] = targets.map(t => ({
      targetId: t.id,
      verb: t.verb,
      path: t.path,
      summary: t.summary,
      operationId: t.operationId,
      domain: t.domain,
      existingScenarios: matchedScenarios(t)
    }))

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
      errors: errors.slice(0, 10),
      total: ctxs.length
    }
  })
}
