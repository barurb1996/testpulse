import { createHash, randomBytes } from 'crypto'

const ABSOLUTE_TTL_MS = 8 * 60 * 60_000
const IDLE_TTL_MS = 2 * 60 * 60_000
const PREFIX = 'tps_'

interface Session { createdAt: number; lastSeen: number }

/** In-memory admin sessions (lost on restart, which simply forces a new login). Only a hash of the token is kept. */
export class SessionStore {
  private sessions = new Map<string, Session>()
  constructor(private readonly now: () => number = Date.now) {}

  private key(token: string): string {
    return createHash('sha256').update(token).digest('hex')
  }

  create(): { token: string; expiresAt: number } {
    const token = PREFIX + randomBytes(32).toString('hex')
    const t = this.now()
    this.sessions.set(this.key(token), { createdAt: t, lastSeen: t })
    if (this.sessions.size > 1000) this.prune()
    return { token, expiresAt: t + ABSOLUTE_TTL_MS }
  }

  isSessionToken(token: string): boolean {
    return token.startsWith(PREFIX)
  }

  validate(token: string): boolean {
    const k = this.key(token)
    const s = this.sessions.get(k)
    if (!s) return false
    const t = this.now()
    if (t - s.createdAt > ABSOLUTE_TTL_MS || t - s.lastSeen > IDLE_TTL_MS) {
      this.sessions.delete(k)
      return false
    }
    s.lastSeen = t
    return true
  }

  revoke(token: string): void {
    this.sessions.delete(this.key(token))
  }

  revokeAll(): void {
    this.sessions.clear()
  }

  private prune(): void {
    const t = this.now()
    for (const [k, s] of this.sessions) {
      if (t - s.createdAt > ABSOLUTE_TTL_MS || t - s.lastSeen > IDLE_TTL_MS) this.sessions.delete(k)
    }
  }
}

export const sessions = new SessionStore()
