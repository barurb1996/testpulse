import type { Issue } from '../types.js'
import { karateNoAssertion } from '../rules/karate-no-assertion.js'
import { karateGenericScenarioName } from '../rules/karate-generic-scenario-name.js'

export interface KarateStep {
  keyword: string
  text: string
  line: number
}

export interface KarateScenario {
  name: string
  line: number
  steps: KarateStep[]
}

export interface KarateFeature {
  name: string | null
  scenarios: KarateScenario[]
}

const KEYWORDS = ['Given', 'When', 'Then', 'And', 'But', '*']

function parseFeature(source: string): KarateFeature {
  const lines = source.split(/\r?\n/)
  const feature: KarateFeature = { name: null, scenarios: [] }
  let current: KarateScenario | null = null

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const trimmed = raw.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const featureMatch = /^Feature:\s*(.*)$/.exec(trimmed)
    if (featureMatch) {
      feature.name = featureMatch[1]
      continue
    }

    const scenarioMatch = /^Scenario(?: Outline)?:\s*(.*)$/.exec(trimmed)
    if (scenarioMatch) {
      current = { name: scenarioMatch[1], line: i + 1, steps: [] }
      feature.scenarios.push(current)
      continue
    }

    if (current) {
      const stepMatch = /^(Given|When|Then|And|But|\*)\s+(.*)$/.exec(trimmed)
      if (stepMatch) {
        current.steps.push({ keyword: stepMatch[1], text: stepMatch[2], line: i + 1 })
      }
    }
  }

  return feature
}

export function parseKarate(source: string): Issue[] {
  const feature = parseFeature(source)
  const issues: Issue[] = []
  for (const scenario of feature.scenarios) {
    issues.push(...karateNoAssertion(scenario))
    issues.push(...karateGenericScenarioName(scenario))
  }
  return issues
}

// keyword list exported for rule authors
export { KEYWORDS }
