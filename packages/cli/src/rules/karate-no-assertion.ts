import type { Issue } from '../types.js'
import type { KarateScenario } from '../parsers/karate.js'

const ASSERTION_TOKENS = /\b(match|status|assert)\b/
const VALIDATING_CALL = /\bcall\b.*\b\w*(validate|assert|check|verify)\w*/i

export function karateNoAssertion(scenario: KarateScenario): Issue[] {
  const hasThen = scenario.steps.some(s => s.keyword === 'Then')
  if (hasThen) return []

  const hasAssertionToken = scenario.steps.some(s => ASSERTION_TOKENS.test(s.text))
  if (hasAssertionToken) return []

  const hasValidatingCall = scenario.steps.some(s => VALIDATING_CALL.test(s.text))
  if (hasValidatingCall) return []

  return [{
    rule: 'karate-no-assertion',
    severity: 'critical',
    message: `Scenario "${scenario.name}" has no Then step, no match/status/assert, and no call to a validate/verify helper — it will always pass`,
    line: scenario.line
  }]
}
