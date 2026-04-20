import { randomBytes, timingSafeEqual } from 'crypto'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import * as OTPAuth from 'otpauth'
import QRCode from 'qrcode'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { adminSettings } from '../db/schema.js'
import { encryptIfNeeded, decryptIfNeeded } from '../crypto.js'

const ISSUER = 'Testpulse'

async function getSettings() {
  const rows = await db.select().from(adminSettings).limit(1)
  return rows[0] ?? null
}

async function ensureSettings() {
  const existing = await getSettings()
  if (existing) return existing
  const [created] = await db.insert(adminSettings).values({ mfaEnabled: 'false' }).returning()
  return created
}

export async function verifyMfa(code: string | undefined): Promise<boolean> {
  const settings = await getSettings()
  if (!settings || settings.mfaEnabled !== 'true' || !settings.mfaSecret) return true
  if (!code || code.length !== 6) return false

  const secret = decryptIfNeeded(settings.mfaSecret)
  if (!secret) return false

  const totp = new OTPAuth.TOTP({
    issuer: ISSUER,
    label: 'admin',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret)
  })
  const delta = totp.validate({ token: code, window: 1 })
  return delta !== null
}

function checkAdminPassword(request: FastifyRequest, reply: FastifyReply): boolean {
  const adminPw = process.env.ADMIN_PASSWORD
  if (!adminPw) { reply.code(503).send({ error: 'ADMIN_PASSWORD not configured' }); return false }
  const value = (request.headers['x-admin-password'] as string | undefined)
    ?? (request.body as Record<string, unknown>)?.adminPassword as string | undefined
  if (!value) { reply.code(401).send({ error: 'Admin password required' }); return false }
  const a = Buffer.from(adminPw, 'utf-8')
  const b = Buffer.from(value, 'utf-8')
  if (a.length !== b.length || !timingSafeEqual(a, b)) { reply.code(403).send({ error: 'Invalid admin password' }); return false }
  return true
}

export async function mfaRoutes(app: FastifyInstance) {
  app.get('/api/admin/mfa/status', async () => {
    const settings = await getSettings()
    return { enabled: settings?.mfaEnabled === 'true' }
  })

  app.post('/api/admin/mfa/setup', async (req, reply) => {
    if (!checkAdminPassword(req, reply)) return

    const secret = new OTPAuth.Secret({ size: 20 }).base32
    const totp = new OTPAuth.TOTP({
      issuer: ISSUER,
      label: 'admin',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secret)
    })
    const otpUri = totp.toString()
    const qrPng = await QRCode.toDataURL(otpUri, { width: 256 })

    const existing = await getSettings()
    if (existing) {
      await db.update(adminSettings).set({
        mfaSecret: encryptIfNeeded(secret),
        mfaEnabled: 'false',
        updatedAt: new Date()
      }).where(eq(adminSettings.id, existing.id))
    } else {
      await db.insert(adminSettings).values({
        mfaSecret: encryptIfNeeded(secret),
        mfaEnabled: 'false'
      })
    }

    return {
      otpUri,
      qrPng,
      warning: 'Scan in Authenticator, then POST /mfa/enable with a 6-digit code to activate. MFA is not active until then.'
    }
  })

  app.post('/api/admin/mfa/enable', async (req, reply) => {
    if (!checkAdminPassword(req, reply)) return
    const { code } = (req.body ?? {}) as { code?: string }
    if (!code) { reply.code(400); return { error: 'code required' } }

    const settings = await ensureSettings()
    if (!settings.mfaSecret) { reply.code(400); return { error: 'run /mfa/setup first' } }

    const secret = decryptIfNeeded(settings.mfaSecret)
    if (!secret) { reply.code(500); return { error: 'decrypt failed' } }

    const totp = new OTPAuth.TOTP({
      issuer: ISSUER,
      label: 'admin',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secret)
    })
    if (totp.validate({ token: code, window: 1 }) === null) {
      reply.code(403)
      return { error: 'Invalid code — secret stays inactive' }
    }

    await db.update(adminSettings).set({ mfaEnabled: 'true', updatedAt: new Date() }).where(eq(adminSettings.id, settings.id))
    return { enabled: true }
  })

  app.post('/api/admin/mfa/disable', async (req, reply) => {
    if (!checkAdminPassword(req, reply)) return
    const { code } = (req.body ?? {}) as { code?: string }
    if (!(await verifyMfa(code))) { reply.code(403); return { error: 'MFA code required to disable' } }

    const settings = await getSettings()
    if (settings) {
      await db.update(adminSettings).set({ mfaEnabled: 'false', mfaSecret: null, updatedAt: new Date() }).where(eq(adminSettings.id, settings.id))
    }
    return { enabled: false }
  })

  app.post('/api/admin/mfa/verify-login', async (req, reply) => {
    if (!checkAdminPassword(req, reply)) return
    const { code } = (req.body ?? {}) as { code?: string }
    const ok = await verifyMfa(code)
    if (!ok) { reply.code(403); return { error: 'Invalid MFA code' } }
    return { verified: true }
  })
}
export { randomBytes as _unusedRandom }
