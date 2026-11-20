import { lookup } from 'dns/promises'
import { realpath } from 'fs/promises'
import { isIP } from 'net'
import path from 'path'

// ── input hardening ─────────────────────────────────────────────────────────

export const PRIVATE_V4 = /^(0\.|10\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/
export function isPrivateAddress(addr: string): boolean {
  const a = addr.toLowerCase()
  if (isIP(a) === 4) return PRIVATE_V4.test(a)
  return a === '::1' || a === '::' || a.startsWith('fc') || a.startsWith('fd') || a.startsWith('fe80') || a.startsWith('::ffff:')
}

/** https only, no embedded credentials, and the host must resolve to public addresses (blocks SSRF to internal services). */
export async function assertSafeRepoUrl(raw: string): Promise<URL> {
  const u = new URL(raw)
  if (u.protocol !== 'https:') throw new Error('repoUrl must use https')
  if (u.username || u.password) throw new Error('repoUrl must not contain credentials; use the access-token field')
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('repoUrl host is not allowed')
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true })
  if (addrs.length === 0 || addrs.some(a => isPrivateAddress(a.address))) throw new Error('repoUrl host resolves to a non-public address')
  return u
}

export const SAFE_BRANCH = /^(?!-)[a-zA-Z0-9_./-]{1,100}$/
export const SAFE_REL_PATH = /^(?!\/)(?!.*(^|\/)\.\.(\/|$))[^\0]{1,200}$/

export function sanitizeError(err: unknown, secrets: Array<string | null | undefined>): string {
  let msg = err instanceof Error ? err.message : String(err)
  for (const s of secrets) {
    if (!s) continue
    msg = msg.split(s).join('[redacted]').split(Buffer.from(`x-access-token:${s}`).toString('base64')).join('[redacted]')
  }
  return msg.replace(/https:\/\/[^@\s/]+@/g, 'https://[redacted]@').slice(0, 500)
}

export async function resolveInside(root: string, rel: string): Promise<string> {
  const rootReal = await realpath(root)
  const full = await realpath(path.resolve(rootReal, rel))
  if (full !== rootReal && !full.startsWith(rootReal + path.sep)) throw new Error('configured path escapes the repository')
  return full
}
