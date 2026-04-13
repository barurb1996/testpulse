import type { Issue } from '../types.js'
import type { KarateProjectContext } from './karate-project.js'
import { karateNoAssertion } from '../rules/karate-no-assertion.js'
import { karateGenericScenarioName } from '../rules/karate-generic-scenario-name.js'
import { karateExplicitSleep } from '../rules/karate-explicit-sleep.js'
import { karateHardcodedLocalhostUrl } from '../rules/karate-hardcoded-localhost-url.js'
import { karatePrintInTest } from '../rules/karate-print-in-test.js'
import { karateEmptyScenario } from '../rules/karate-empty-scenario.js'
import { karateRepeatedSetup } from '../rules/karate-repeated-setup.js'
import { karateUncheckedHttpCall } from '../rules/karate-unchecked-http-call.js'

export interface KarateStep {
  keyword: string
  text: string
  line: number
}

export interface KarateScenario {
  name: string
  line: number
  tags: string[]
  steps: KarateStep[]
}

export interface KarateFeature {
  name: string | null
  tags: string[]
  scenarios: KarateScenario[]
}

const IGNORED_TAG = '@ignore'

export function parseFeature(source: string): KarateFeature {
  const lines = source.split(/\r?\n/)
  const feature: KarateFeature = { name: null, tags: [], scenarios: [] }
  let current: KarateScenario | null = null
  let pendingTags: string[] = []
  let inDocstring = false
  let inExamples = false

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const trimmed = raw.trim()

    if (trimmed.includes('"""')) {
      inDocstring = !inDocstring
      continue
    }
    if (inDocstring) continue

    if (!trimmed || trimmed.startsWith('#')) continue

    if (trimmed.startsWith('@')) {
      pendingTags.push(...trimmed.split(/\s+/).filter(t => t.startsWith('@')))
      continue
    }

    const featureMatch = /^Feature:\s*(.*)$/.exec(trimmed)
    if (featureMatch) {
      feature.name = featureMatch[1]
      feature.tags = pendingTags
      pendingTags = []
      continue
    }

    const scenarioMatch = /^Scenario(?: Outline)?:\s*(.*)$/.exec(trimmed)
    if (scenarioMatch) {
      current = { name: scenarioMatch[1], line: i + 1, tags: pendingTags, steps: [] }
      feature.scenarios.push(current)
      pendingTags = []
      inExamples = false
      continue
    }

    if (/^Examples:/.test(trimmed)) {
      inExamples = true
      continue
    }

    if (/^Background:/.test(trimmed)) {
      current = null
      continue
    }

    if (inExamples && trimmed.startsWith('|')) continue

    if (current) {
      const stepMatch = /^(Given|When|Then|And|But|\*)\s+(.*)$/.exec(trimmed)
      if (stepMatch) {
        current.steps.push({ keyword: stepMatch[1], text: stepMatch[2], line: i + 1 })
      }
    }
  }

  return feature
}

export function isIgnored(scenario: KarateScenario, feature: KarateFeature): boolean {
  return feature.tags.includes(IGNORED_TAG) || scenario.tags.includes(IGNORED_TAG)
}

export function parseKarate(source: string, filePath: string, ctx?: KarateProjectContext): Issue[] {
  const feature = parseFeature(source)
  const issues: Issue[] = []

  for (const scenario of feature.scenarios) {
    if (isIgnored(scenario, feature)) continue
    issues.push(...karateNoAssertion(scenario, filePath, ctx))
    issues.push(...karateGenericScenarioName(scenario))
    issues.push(...karateExplicitSleep(scenario))
    issues.push(...karateHardcodedLocalhostUrl(scenario))
    issues.push(...karatePrintInTest(scenario))
    issues.push(...karateEmptyScenario(scenario))
    issues.push(...karateUncheckedHttpCall(scenario, filePath, ctx))
  }

  issues.push(...karateRepeatedSetup(feature))

  return issues
}
