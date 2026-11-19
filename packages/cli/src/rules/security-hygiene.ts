import type { Issue } from '../types.js'

export interface HygieneOptions {
  productionDomains?: string[]
}

type LineRule = (line: string, lineNo: number, opts: HygieneOptions) => Issue[]

function mask(value: string): string {
  if (value.length <= 8) return '****'
  return `${value.slice(0, 4)}…${value.slice(-2)} (${value.length} chars)`
}

// ── hardcoded-secret ────────────────────────────────────────────────────────

const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'AWS access key', re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: 'GitHub token', re: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/ },
  { name: 'GitHub fine-grained token', re: /\bgithub_pat_[A-Za-z0-9_]{50,}\b/ },
  { name: 'Stripe live key', re: /\b(sk|rk)_live_[A-Za-z0-9]{16,}\b/ },
  { name: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'Anthropic API key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'JWT', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { name: 'private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
]

const PASSWORD_ASSIGN = /\b(password|passwd|pwd|secret|client_secret|api[_-]?key|auth[_-]?token)\b\s*[:=]\s*(['"])([^'"\s]{8,})\2/i
const PLACEHOLDER = /^(\$\{|#\(|<|\{\{|process\.env|changeme|password|secret|example|xxx|\*{3,}|test|dummy|placeholder)/i

function shannon(s: string): number {
  const freq = new Map<string, number>()
  for (const c of s) freq.set(c, (freq.get(c) ?? 0) + 1)
  let h = 0
  for (const n of freq.values()) {
    const p = n / s.length
    h -= p * Math.log2(p)
  }
  return h
}

export const hardcodedSecret: LineRule = (line, lineNo) => {
  for (const { name, re } of SECRET_PATTERNS) {
    const m = re.exec(line)
    if (m) {
      return [{
        rule: 'hardcoded-secret',
        severity: 'critical',
        message: `Hardcoded ${name} in test code: ${mask(m[0])}`,
        line: lineNo,
        category: 'security-hygiene',
        suggestion: 'Move the credential to an env var / secret store and rotate it — it is now in git history'
      }]
    }
  }
  const pw = PASSWORD_ASSIGN.exec(line)
  if (pw) {
    const value = pw[3]
    if (!PLACEHOLDER.test(value) && !/test|dummy|example|fake|sample|demo|mock|local/i.test(value) && shannon(value) >= 3) {
      return [{
        rule: 'hardcoded-secret',
        severity: 'critical',
        message: `Hardcoded ${pw[1].toLowerCase()} literal in test code: ${mask(value)}`,
        line: lineNo,
        category: 'security-hygiene',
        suggestion: 'Read it from an env var or config file excluded from git; use a dedicated test account'
      }]
    }
  }
  return []
}

/** Replace anything that looks like a credential before text leaves the machine. */
export function redactSecrets(text: string): string {
  let out = text
  for (const { re } of SECRET_PATTERNS) {
    out = out.replace(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'), '[REDACTED]')
  }
  return out.replace(
    new RegExp(PASSWORD_ASSIGN.source, 'gi'),
    (m, key: string, q: string, value: string) => (PLACEHOLDER.test(value) ? m : `${key}: ${q}[REDACTED]${q}`)
  )
}

// ── tls-verification-disabled ───────────────────────────────────────────────

const TLS_OFF = [
  /ignoreHTTPSErrors\s*:\s*true/,
  /rejectUnauthorized\s*:\s*false/,
  /NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0/,
  /configure\s+ssl\s*=\s*true/,
  /\bverify\s*=\s*False\b/,
  /InsecureSkipVerify\s*:\s*true/,
  /trustAllCerts|TrustAllStrategy|NoopHostnameVerifier/,
]

export const tlsVerificationDisabled: LineRule = (line, lineNo) => {
  if (!TLS_OFF.some(re => re.test(line))) return []
  return [{
    rule: 'tls-verification-disabled',
    severity: 'warning',
    message: 'TLS certificate verification is disabled — tests would pass against a MITM / wrong host',
    line: lineNo,
    category: 'security-hygiene',
    suggestion: 'Trust the test CA explicitly (NODE_EXTRA_CA_CERTS / truststore) instead of turning verification off'
  }]
}

// ── production-target ───────────────────────────────────────────────────────

export const productionTarget: LineRule = (line, lineNo, opts) => {
  const domains = opts.productionDomains ?? []
  for (const d of domains) {
    const escaped = d.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`(^|[^A-Za-z0-9-])${escaped}([^A-Za-z0-9-]|$)`, 'i').test(line)) {
      return [{
        rule: 'production-target',
        severity: 'critical',
        message: `Test references production domain "${d}" — it may mutate real data`,
        line: lineNo,
        category: 'security-hygiene',
        suggestion: 'Point tests at a dedicated test/staging environment via config'
      }]
    }
  }
  return []
}

// ── real-looking-pii ────────────────────────────────────────────────────────

function luhn(digits: string): boolean {
  let sum = 0
  let dbl = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i])
    if (dbl) { n *= 2; if (n > 9) n -= 9 }
    sum += n
    dbl = !dbl
  }
  return sum % 10 === 0
}

function peselValid(p: string): boolean {
  if (!/^\d{11}$/.test(p)) return false
  const mm = Number(p.slice(2, 4)) % 20
  const dd = Number(p.slice(4, 6))
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return false
  const w = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3]
  const sum = w.reduce((a, wi, i) => a + wi * Number(p[i]), 0)
  return (10 - (sum % 10)) % 10 === Number(p[10])
}

function ibanValid(raw: string): boolean {
  const iban = raw.replace(/\s/g, '').toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false
  const rearranged = iban.slice(4) + iban.slice(0, 4)
  const numeric = rearranged.replace(/[A-Z]/g, c => String(c.charCodeAt(0) - 55))
  let rem = 0
  for (const ch of numeric) rem = (rem * 10 + Number(ch)) % 97
  return rem === 1
}

const CARD_RE = /\b(?:\d[ -]?){13,19}\b/g
const IBAN_RE = /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,8}(?:\s?[A-Z0-9]{1,4})?\b/g
const PESEL_RE = /(?<![\d+.\-])\d{11}(?![\d.\-])/g
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g
// Real-person indicator: a consumer mailbox provider, with a local part that is not an obvious placeholder
const FREE_MAIL = /(^|\.)(gmail\.com|googlemail\.com|yahoo\.[a-z.]+|hotmail\.[a-z.]+|outlook\.com|live\.com|icloud\.com|proton\.me|protonmail\.com|gmx\.[a-z]+|wp\.pl|o2\.pl|interia\.pl|onet\.pl)$/i
const PLACEHOLDER_LOCAL = /^(test|tester|user|mail|demo|fake|foo|bar|admin|noreply|no-reply|sample|dummy|qa|example|john\.?doe|jane\.?doe)\d*([._+-].*)?$/i
const SAFE_EMAIL_DOMAINS = /(^|\.)(example\.(com|org|net)|test|invalid|localhost|local|mailinator\.com|testpulse\.dev)$/i
// Well-known gateway test cards are not real PII
// Major-network IIN prefixes: random 13-digit timestamps and IDs rarely start like a real card
const CARD_PREFIX = /^(4|5[1-5]|2[2-7]|3[47]|6011|65|35)/
const KNOWN_TEST_CARDS = new Set(['4242424242424242', '4111111111111111', '5555555555554444', '378282246310005', '6011111111111117'])

export const realLookingPii: LineRule = (line, lineNo) => {
  const hits: string[] = []

  for (const m of line.matchAll(CARD_RE)) {
    const digits = m[0].replace(/[ -]/g, '')
    if (digits.length >= 15 && digits.length <= 16 && CARD_PREFIX.test(digits) && luhn(digits) && !KNOWN_TEST_CARDS.has(digits) && !/^(\d)\1+$/.test(digits)) {
      hits.push(`card number ${mask(digits)}`)
    }
  }
  for (const m of line.matchAll(IBAN_RE)) {
    if (ibanValid(m[0])) hits.push(`IBAN ${mask(m[0].replace(/\s/g, ''))}`)
  }
  for (const m of line.matchAll(PESEL_RE)) {
    if (peselValid(m[0]) && !luhn(m[0])) hits.push(`PESEL ${mask(m[0])}`)
  }
  for (const m of line.matchAll(EMAIL_RE)) {
    const local = m[0].slice(0, m[0].lastIndexOf('@'))
    if (!SAFE_EMAIL_DOMAINS.test(m[1]) && FREE_MAIL.test(m[1]) && !PLACEHOLDER_LOCAL.test(local)) hits.push(`e-mail @${m[1]}`)
  }

  if (hits.length === 0) return []
  return [{
    rule: 'real-looking-pii',
    severity: 'warning',
    message: `Test data looks like real PII: ${hits.join(', ')}`,
    line: lineNo,
    category: 'security-hygiene',
    suggestion: 'Use generated / reserved test data (example.com e-mails, gateway test cards, synthetic IBANs)'
  }]
}

// ── secret-in-test-output ───────────────────────────────────────────────────

const OUTPUT_CALL = /\b(console\.(log|info|debug|warn)|print|System\.out\.println|testInfo\.attach|karate\.log)\b/
const SENSITIVE_WORD = /\b(token|authorization|bearer|password|secret|api[_-]?key|cookie)\b/i

export const secretInTestOutput: LineRule = (line, lineNo) => {
  const trimmed = line.trim()
  if (trimmed.startsWith('//') || trimmed.startsWith('*')) return []
  if (!OUTPUT_CALL.test(line) && !/^\s*\*\s+print\b/.test(line)) return []
  if (!SENSITIVE_WORD.test(line)) return []
  return [{
    rule: 'secret-in-test-output',
    severity: 'warning',
    message: 'Test output prints a token / credential — it will land in CI logs and reports',
    line: lineNo,
    category: 'security-hygiene',
    suggestion: 'Remove the log, or redact the value before printing'
  }]
}

// ── insecure-http ───────────────────────────────────────────────────────────

const HTTP_URL = /\bhttp:\/\/([A-Za-z0-9.-]+)/g
const LOCAL_HOST = /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|[^.]+$|.*\.(local|test|internal|localhost)$|host\.docker\.internal$|example\.(com|org|net)$)/i

const DOC_HOST = /(^|\.)(apache\.org|w3\.org|opensource\.org|gnu\.org|json-schema\.org|xmlsoap\.org|sun\.com|mozilla\.org|eclipse\.org|creativecommons\.org|github\.com|npmjs\.org|schemas\.[a-z.]+)$/i

export const insecureHttp: LineRule = (line, lineNo) => {
  const t = line.trim()
  if (t.startsWith('*') || t.startsWith('//') || t.startsWith('#') || t.startsWith('/*')) return [] // comments & license headers
  for (const m of line.matchAll(HTTP_URL)) {
    if (!LOCAL_HOST.test(m[1]) && !DOC_HOST.test(m[1]) && !/xmlns/i.test(line)) {
      return [{
        rule: 'insecure-http',
        severity: 'info',
        message: `Plain http:// to external host "${m[1]}" — traffic (and any credentials) are unencrypted`,
        line: lineNo,
        category: 'security-hygiene',
        suggestion: 'Use https://, or move the base URL into environment config'
      }]
    }
  }
  return []
}

// ── entry point ─────────────────────────────────────────────────────────────

const LINE_RULES: LineRule[] = [
  hardcodedSecret,
  tlsVerificationDisabled,
  productionTarget,
  realLookingPii,
  secretInTestOutput,
  insecureHttp,
]

export function scanSecurityHygiene(source: string, opts: HygieneOptions = {}): Issue[] {
  const issues: Issue[] = []
  const lines = source.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length > 2000) continue // minified / generated blobs
    for (const rule of LINE_RULES) issues.push(...rule(lines[i], i + 1, opts))
  }
  return issues
}
