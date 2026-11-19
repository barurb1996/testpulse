import type { KarateStep } from '../parsers/karate.js'

export type TestKind = 'happy' | 'unauth' | 'forbidden' | 'cross-user' | 'invalid-input'

const STATUS_RE = /^status\s+(\d{3})\b|\bresponseStatus\s*==\s*(\d{3})\b/
const AUTH_RE = /authorization|bearer\s|\bapi[-_]?key\b|\bcookie\b|\baccess[-_]?token\b|\bauth\w*\s*=/i
const CROSS_USER_RE = /\b(other|another|different|foreign|someone[\s_-]*else'?s?|second|unrelated)[\s_-]*(user|tenant|account|customer|owner|org)|cross[-\s]?(tenant|user|account)|not\s+(owned|own)|belong(s|ing)?\s+to\s+(another|other|someone)|idor|bola/i
const NO_AUTH_RE = /\b(no|without|missing|invalid|expired|bad|wrong)\s+(auth\w*|token|credentials?|api[-\s]?key|bearer)\b|unauthenti\w+|unauthori[sz]ed/i

export interface CallContext {
  scenarioName: string
  steps: KarateStep[]
  methodIndex: number
  nextBoundaryIndex: number
}

/** Classify one HTTP call inside a Karate scenario. Pure heuristic, no I/O. */
export function classifyCall(ctx: CallContext): { kinds: TestKind[]; status: number | null } {
  const { steps, methodIndex, nextBoundaryIndex, scenarioName } = ctx

  let status: number | null = null
  for (let i = methodIndex + 1; i < nextBoundaryIndex; i++) {
    const m = STATUS_RE.exec(steps[i].text)
    if (m) { status = Number(m[1] ?? m[2]); break }
  }

  const before = steps.slice(0, methodIndex).map(s => s.text).join('\n')
  const kinds = classifyOutcome({ status, scenarioName, contextText: before })
  return { kinds, status }
}

/** Shared by Karate and Playwright: turn an observed expected status + hints into test kinds. */
export function classifyOutcome(o: { status: number | null; scenarioName: string; contextText: string }): TestKind[] {
  const { status, scenarioName, contextText } = o
  const hasAuth = AUTH_RE.test(contextText)
  const crossHint = CROSS_USER_RE.test(scenarioName) || CROSS_USER_RE.test(contextText)
  const noAuthHint = NO_AUTH_RE.test(scenarioName)

  const kinds: TestKind[] = []
  if (status === 401 || (status === 403 && noAuthHint && !hasAuth)) kinds.push('unauth')
  else if (status === 403 || status === 404) {
    if (crossHint) kinds.push('cross-user')
    else if (status === 403) kinds.push('forbidden')
  }
  else if (status === 400 || status === 422) kinds.push('invalid-input')
  else if (status !== null && status >= 200 && status < 300) kinds.push('happy')
  else if (status === null) kinds.push('happy') // unknown outcome: counts as plain coverage only
  return kinds
}
