import type { Issue } from '../types.js'
import type { KarateScenario } from '../parsers/karate.js'

const GENERIC = new Set([
  'test', 'test1', 'test2', 'scenario', 'scenario1',
  'foo', 'bar', 'example', 'demo', 'todo', 'tbd', 'new scenario'
])

export function karateGenericScenarioName(scenario: KarateScenario): Issue[] {
  const normalized = scenario.name.trim().toLowerCase()
  if (GENERIC.has(normalized) || normalized.length < 5) {
    return [{
      rule: 'karate-generic-scenario-name',
      severity: 'warning',
      message: `Scenario name "${scenario.name}" is too generic — describe the behavior being verified`,
      line: scenario.line
    }]
  }
  return []
}
