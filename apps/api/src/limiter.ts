import { createHash, timingSafeEqual } from 'crypto'

/** Constant-time string comparison that does not leak length (both sides are hashed first). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}

interface Bucket { count: number; windowStart: number; lockedUntil: number }

/**
 * Failed-login limiter. Per-IP bucket stops a single client; a global bucket stops a distributed
 * brute force of the single admin password / 6-digit TOTP code (at the cost that sustained failed
 * attempts from anywhere can temporarily lock the login endpoint, which is the intended trade-off).
 */
export class FailureLimiter {
  private buckets = new Map<string, Bucket>()
  constructor(
    private readonly perIpMax = 5,
    private readonly globalMax = 20,
    private readonly windowMs = 15 * 60_000,
    private readonly lockMs = 15 * 60_000,
    private readonly now: () => number = Date.now
  ) {}

  private bucket(key: string): Bucket {
    const t = this.now()
    let b = this.buckets.get(key)
    if (!b || t - b.windowStart > this.windowMs) {
      b = { count: 0, windowStart: t, lockedUntil: b && b.lockedUntil > t ? b.lockedUntil : 0 }
      this.buckets.set(key, b)
    }
    return b
  }

  /** Seconds until the caller may retry, or 0 when allowed. */
  retryAfter(ip: string): number {
    const t = this.now()
    const until = Math.max(this.bucket(`ip:${ip}`).lockedUntil, this.bucket('global').lockedUntil)
    return until > t ? Math.ceil((until - t) / 1000) : 0
  }

  recordFailure(ip: string): void {
    const t = this.now()
    const perIp = this.bucket(`ip:${ip}`)
    perIp.count++
    if (perIp.count >= this.perIpMax) perIp.lockedUntil = t + this.lockMs
    const global = this.bucket('global')
    global.count++
    if (global.count >= this.globalMax) global.lockedUntil = t + this.lockMs
    if (this.buckets.size > 10_000) this.buckets.clear() // memory guard against IP-spray
  }

  recordSuccess(ip: string): void {
    this.buckets.delete(`ip:${ip}`)
  }
}

export const loginLimiter = new FailureLimiter()
