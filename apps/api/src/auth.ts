import { createHash, randomBytes } from 'crypto'

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

/** Project API token: `tp_<slug>_<48 hex>`. Only its SHA-256 is stored. */
export function generateToken(projectSlug: string): string {
  const rand = randomBytes(24).toString('hex')
  return `tp_${projectSlug}_${rand}`
}
