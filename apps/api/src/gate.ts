import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { eq } from 'drizzle-orm'
import { db } from './db/index.js'
import { apiTokens, projects, runs } from './db/schema.js'
import { hashToken } from './auth.js'
import { sessions } from './session.js'

export type AuthContext = { kind: 'admin' } | { kind: 'token'; slug: string }

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext
  }
}

/** Routes reachable without credentials. Login itself is protected by the failure limiter. */
const PUBLIC = new Set(['/api/admin/session', '/api/admin/login', '/api/admin/mfa/status'])

/** Routes a project token must never reach, even for its own project. */
function adminOnly(method: string, path: string): boolean {
  if (path.startsWith('/api/admin/')) return true
  if (path === '/api/projects') return true // lists every project
  if (/^\/api\/projects\/[^/]+$/.test(path) && method !== 'GET') return true // rename / Slack webhook
  if (/^\/api\/projects\/[^/]+\/(repo|scan)$/.test(path)) return true // repo credentials, server-side clone
  if (/^\/api\/projects\/[^/]+\/digest\/send$/.test(path)) return true // outbound Slack message
  return false
}

export interface GateDeps {
  /** Resolve a bearer token to its project slug (default: database lookup). */
  tokenSlug: (rawToken: string) => Promise<string | null>
  /** Resolve a run id to its project slug (default: database lookup). */
  runSlug: (runId: string) => Promise<string | null>
  /** Local development escape hatch. Refused in production. */
  insecureNoAuth: boolean
}

export const defaultDeps: GateDeps = {
  async tokenSlug(raw) {
    const [row] = await db
      .select({ slug: projects.slug, id: apiTokens.id })
      .from(apiTokens)
      .innerJoin(projects, eq(apiTokens.projectId, projects.id))
      .where(eq(apiTokens.tokenHash, hashToken(raw)))
    if (!row) return null
    db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, row.id)).catch(() => {})
    return row.slug
  },
  async runSlug(runId) {
    if (!/^[0-9a-f-]{36}$/i.test(runId)) return null
    const [row] = await db
      .select({ slug: projects.slug })
      .from(runs)
      .innerJoin(projects, eq(runs.projectId, projects.id))
      .where(eq(runs.id, runId))
    return row?.slug ?? null
  },
  insecureNoAuth: process.env.TESTPULSE_INSECURE_NO_AUTH === 'true' && process.env.NODE_ENV !== 'production'
}

function deny(reply: FastifyReply, code: number, error: string) {
  return reply.code(code).send({ error })
}

/** Slug a token-authenticated request is about, when it can be known before the body is parsed. */
async function requestSlug(req: FastifyRequest, deps: GateDeps): Promise<string | null | undefined> {
  const params = (req.params ?? {}) as Record<string, string | undefined>
  if (params.slug) return params.slug
  const path = req.url.split('?')[0]
  if (path === '/api/runs' && req.method === 'GET') return (req.query as { project?: string })?.project ?? null
  if (path === '/api/runs' && req.method === 'POST') return undefined // slug is in the body; checked in preHandler
  if (params.id && path.startsWith('/api/runs/')) return deps.runSlug(params.id)
  return null
}

export function registerAuthGate(app: FastifyInstance, deps: GateDeps = defaultDeps): void {
  if (deps.insecureNoAuth) {
    app.log.warn('TESTPULSE_INSECURE_NO_AUTH is set: ALL API AUTHENTICATION IS DISABLED (development only)')
  }

  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0]
    if (!path.startsWith('/api/')) return
    if (deps.insecureNoAuth) { req.auth = { kind: 'admin' }; return }
    if (PUBLIC.has(path)) return

    if (!process.env.ADMIN_PASSWORD) {
      return deny(reply, 503, 'ADMIN_PASSWORD is not configured; the API refuses all requests until it is set')
    }

    const header = req.headers.authorization
    if (!header || !header.startsWith('Bearer ')) return deny(reply, 401, 'Authentication required')
    const raw = header.slice(7).trim()

    if (sessions.isSessionToken(raw)) {
      if (!sessions.validate(raw)) return deny(reply, 401, 'Session expired — log in again')
      req.auth = { kind: 'admin' }
      return
    }

    const slug = await deps.tokenSlug(raw)
    if (!slug) return deny(reply, 403, 'Invalid API token')
    if (adminOnly(req.method, path)) return deny(reply, 403, 'This endpoint requires an admin session')

    const wanted = await requestSlug(req, deps)
    if (wanted !== undefined && wanted !== slug) return deny(reply, 403, 'Token is not valid for this project')
    req.auth = { kind: 'token', slug }
  })

  // POST /api/runs carries its project in the body, which exists only after parsing.
  app.addHook('preHandler', async (req, reply) => {
    if (req.auth?.kind !== 'token') return
    if (req.url.split('?')[0] === '/api/runs' && req.method === 'POST') {
      const slug = (req.body as { projectSlug?: string } | undefined)?.projectSlug
      if (slug !== req.auth.slug) return deny(reply, 403, 'Token is not valid for this project')
    }
  })
}

export function requireAdmin(req: FastifyRequest, reply: FastifyReply): boolean {
  if (req.auth?.kind === 'admin') return true
  reply.code(403).send({ error: 'Admin session required' })
  return false
}
