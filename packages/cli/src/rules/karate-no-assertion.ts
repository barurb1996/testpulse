import type { Issue } from '../types.js'
import type { KarateScenario } from '../parsers/karate.js'

const ASSERTION_TOKENS = /\b(match|status|assert)\b/

export function karateNoAssertion(scenario: KarateScenario): Issue[] {
  const hasThen = scenario.steps.some(s => s.keyword === 'Then')
  const hasAssertionToken = scenario.steps.some(s => ASSERTION_TOKENS.test(s.text))

  if (!hasThen && !hasAssertionToken) {
    return [{
      rule: 'karate-no-assertion',
      severity: 'critical',
      message: `Scenario "${scenario.name}" has no Then step and no match/status/assert — it will always pass`,
      line: scenario.line
    }]
  }
  return []
}
