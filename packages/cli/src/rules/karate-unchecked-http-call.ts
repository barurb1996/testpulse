import type { Issue } from '../types.js'
import type { KarateScenario } from '../parsers/karate.js'
import { ASSERTION_TOKENS, type KarateProjectContext } from '../parsers/karate-project.js'

const METHOD_STEP = /^method\s+(get|post|put|delete|patch|head|options)\b/i
const VALIDATING_CALL = /\bcall\b.*\b\w*(validate|assert|check|verify|ensure)\w*/i
const RETRY_UNTIL = /\bretry\s+until\b/

function stepAssertsFor(step: { text: string }, filePath: string, ctx?: KarateProjectContext): boolean {
  if (ASSERTION_TOKENS.test(step.text)) return true
  if (VALIDATING_CALL.test(step.text)) return true
  if (!ctx) return false

  const classpathRe = /call\s+(?:read\s*\(\s*)?['"]classpath:([^'"]+?)['"]/g
  let m: RegExpExecArray | null
  while ((m = classpathRe.exec(step.text)) !== null) {
    const resolved = ctx.resolveClasspath(filePath, m[1])
    if (resolved && ctx.isFeatureAsserting(resolved)) return true
  }

  const helperRe = /\bcall\s+([a-zA-Z_$][\w.$]*)/g
  while ((m = helperRe.exec(step.text)) !== null) {
    if (!m[1].includes('.')) continue
    const resolved = ctx.resolveHelperCall(m[1])
    if (resolved && ctx.isFeatureAsserting(resolved)) return true
  }

  return false
}

export function karateUncheckedHttpCall(
  scenario: KarateScenario,
  filePath: string,
  ctx?: KarateProjectContext
): Issue[] {
  if (scenario.steps.some(s => RETRY_UNTIL.test(s.text))) return []

  const issues: Issue[] = []

  for (let i = 0; i < scenario.steps.length; i++) {
    const step = scenario.steps[i]
    if (!METHOD_STEP.test(step.text)) continue

    const nextMethodIdx = scenario.steps.findIndex((s, idx) => idx > i && METHOD_STEP.test(s.text))
    const windowEnd = nextMethodIdx === -1 ? scenario.steps.length : nextMethodIdx
    const window = scenario.steps.slice(i + 1, windowEnd)

    if (window.some(s => stepAssertsFor(s, filePath, ctx))) continue

    issues.push({
      rule: 'karate-unchecked-http-call',
      severity: 'warning',
      message: `HTTP call "${step.text.trim()}" is not followed by a status or match check — failures would be silent`,
      line: step.line
    })
  }

  return issues
}
