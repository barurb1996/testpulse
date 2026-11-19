import type { FastifyInstance } from 'fastify'
import { requireAdmin } from '../gate.js'
import { loginLimiter } from '../limiter.js'
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

export async function isMfaEnabled(): Promise<boolean> {
  const settings = await getSettings()
  return Boolean(settings && settings.mfaEnabled === 'true' && settings.mfaSecret)
}

function buildTotp(secret: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: ISSUER,
    label: 'admin',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret)
  })
}

let lastAcceptedStep = -1 // a TOTP code may be used once (replay protection); single-instance memory is enough

/** Verify a code against the active secret. Returns false when MFA is enabled and the code is wrong or reused. */
export async function verifyMfaCode(code: string | undefined): Promise<boolean> {
  const settings = await getSettings()
  if (!settings || settings.mfaEnabled !== 'true' || !settings.mfaSecret) return true
  if (!code || !/^\d{6}$/.test(code)) return false

  const secret = decryptIfNeeded(settings.mfaSecret)
  if (!secret) return false

  const delta = buildTotp(secret).validate({ token: code, window: 1 })
  if (delta === null) return false
  const step = Math.floor(Date.now() / 30_000) + delta
  if (step <= lastAcceptedStep) return false
  lastAcceptedStep = step
  return true
}

export async function mfaRoutes(app: FastifyInstance) {
  app.get('/api/admin/mfa/status', async () => {
    const settings = await getSettings()
    return { enabled: settings?.mfaEnabled === 'true' }
  })

  app.post('/api/admin/mfa/setup', async (req, reply) => {
    if (!requireAdmin(req, reply)) return
    // Re-running setup replaces the secret and switches MFA off; never allow that while it protects the account.
    if (await isMfaEnabled()) { reply.code(409); return { error: 'MFA is already enabled. Disable it (with a valid code) before setting it up again.' } }

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
    if (!requireAdmin(req, reply)) return
    const { code } = (req.body ?? {}) as { code?: string }
    if (!code) { reply.code(400); return { error: 'code required' } }

    const settings = await ensureSettings()
    if (!settings.mfaSecret) { reply.code(400); return { error: 'run /mfa/setup first' } }

    const secret = decryptIfNeeded(settings.mfaSecret)
    if (!secret) { reply.code(500); return { error: 'decrypt failed' } }

    if (buildTotp(secret).validate({ token: code, window: 1 }) === null) {
      loginLimiter.recordFailure(req.ip)
      reply.code(403)
      return { error: 'Invalid code — secret stays inactive' }
    }

    await db.update(adminSettings).set({ mfaEnabled: 'true', updatedAt: new Date() }).where(eq(adminSettings.id, settings.id))
    return { enabled: true }
  })

  app.post('/api/admin/mfa/disable', async (req, reply) => {
    if (!requireAdmin(req, reply)) return
    const { code } = (req.body ?? {}) as { code?: string }
    if (!(await verifyMfaCode(code))) { loginLimiter.recordFailure(req.ip); reply.code(403); return { error: 'MFA code required to disable' } }

    const settings = await getSettings()
    if (settings) {
      await db.update(adminSettings).set({ mfaEnabled: 'false', mfaSecret: null, updatedAt: new Date() }).where(eq(adminSettings.id, settings.id))
    }
    return { enabled: false }
  })
}
