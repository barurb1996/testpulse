import type { Issue } from '../types.js'
import type { KarateScenario } from '../parsers/karate.js'

export function karateEmptyScenario(scenario: KarateScenario): Issue[] {
  if (scenario.steps.length === 0) {
    return [{
      rule: 'karate-empty-scenario',
      severity: 'critical',
      message: `Scenario "${scenario.name}" has no steps — it is an empty placeholder`,
      line: scenario.line
    }]
  }
  return []
}
