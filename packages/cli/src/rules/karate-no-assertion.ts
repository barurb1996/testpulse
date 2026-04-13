import type { Issue } from '../types.js'
import type { KarateScenario } from '../parsers/karate.js'
import type { KarateProjectContext } from '../parsers/karate-project.js'

const ASSERTION_TOKENS = /\b(match|status|assert)\b/
const VALIDATING_CALL = /\bcall\b.*\b\w*(validate|assert|check|verify|ensure)\w*/i

export function karateNoAssertion(
  scenario: KarateScenario,
  filePath: string,
  ctx?: KarateProjectContext
): Issue[] {
  if (scenario.steps.some(s => s.keyword === 'Then')) return []
  if (scenario.steps.some(s => ASSERTION_TOKENS.test(s.text))) return []

  if (ctx) {
    const refs = ctx.extractClasspathCalls(scenario)
    for (const ref of refs) {
      const resolved = ctx.resolveClasspath(filePath, ref)
      if (resolved && ctx.isFeatureAsserting(resolved)) return []
    }
  }

  if (scenario.steps.some(s => VALIDATING_CALL.test(s.text))) return []

  return [{
    rule: 'karate-no-assertion',
    severity: 'critical',
    message: `Scenario "${scenario.name}" has no Then, no match/status/assert, and no resolvable call to an asserting helper — it will always pass`,
    line: scenario.line
  }]
}
