import { createHash } from 'crypto'

export function fingerprintFor(rule: string, relativePath: string, lineContent: string): string {
  const normalized = lineContent.trim().replace(/\s+/g, ' ')
  const input = `${rule}::${relativePath}::${normalized}`
  return createHash('sha256').update(input).digest('hex').slice(0, 12)
}
