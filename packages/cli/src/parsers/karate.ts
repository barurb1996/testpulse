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
import { karateDuplicateScenario } from '../rules/karate-duplicate-scenario.js'
import { karateDataVariationDuplicate } from '../rules/karate-data-variation-duplicate.js'
import { karateEndpointCoverageOverlap } from '../rules/karate-endpoint-coverage-overlap.js'
import { karateDuplicateAssertion } from '../rules/karate-duplicate-assertion.js'
import { karateHardcodedAuthToken } from '../rules/karate-hardcoded-auth-token.js'
import { karateStatusOnlySuccess } from '../rules/karate-status-only-success.js'
import { karateHardcodedUuid } from '../rules/karate-hardcoded-uuid.js'
import { karateConfigureRetryInScenario } from '../rules/karate-configure-retry-in-scenario.js'
import { karateExcessiveRetryWindow } from '../rules/karate-excessive-retry-window.js'
import { karateRetryPlusSleep } from '../rules/karate-retry-plus-sleep.js'

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

const KARATE_DSL_SIGNAL = /(^|\n)\s*\*\s+(def|set|call|match|configure|print|table)\s+|\b(url|path|method|request|status|responseStatus)\s+['"\d]|classpath:|\bkarate\.\w+\s*\(|#\(\w+\)/

export function detectGherkinFlavour(source: string): 'karate' | 'cucumber' {
  return KARATE_DSL_SIGNAL.test(source) ? 'karate' : 'cucumber'
}

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
  const flavour = detectGherkinFlavour(source)
  const feature = parseFeature(source)
  const issues: Issue[] = []

  for (const scenario of feature.scenarios) {
    const isHelper = isIgnored(scenario, feature)
    const scenarioIssues: Issue[] = []

    scenarioIssues.push(...karateEmptyScenario(scenario))
    scenarioIssues.push(...karateDuplicateScenario(scenario, filePath, ctx, isHelper))
    scenarioIssues.push(...karateDataVariationDuplicate(scenario, filePath, ctx, isHelper))
    scenarioIssues.push(...karateHardcodedAuthToken(scenario))
    scenarioIssues.push(...karateHardcodedUuid(scenario))
    scenarioIssues.push(...karateStatusOnlySuccess(scenario, filePath))

    if (!isHelper) {
      scenarioIssues.push(...karateGenericScenarioName(scenario))
      scenarioIssues.push(...karateHardcodedLocalhostUrl(scenario))
    }

    if (flavour === 'karate') {
      scenarioIssues.push(...karateExplicitSleep(scenario))
      scenarioIssues.push(...karatePrintInTest(scenario))
      scenarioIssues.push(...karateEndpointCoverageOverlap(scenario, filePath, ctx))
      scenarioIssues.push(...karateDuplicateAssertion(scenario))
      scenarioIssues.push(...karateConfigureRetryInScenario(scenario))
      scenarioIssues.push(...karateExcessiveRetryWindow(scenario))
      scenarioIssues.push(...karateRetryPlusSleep(scenario))

      if (!isHelper) {
        scenarioIssues.push(...karateNoAssertion(scenario, filePath, ctx))
        scenarioIssues.push(...karateUncheckedHttpCall(scenario, filePath, ctx))
      }
    }

    for (const issue of scenarioIssues) issue.scenarioName = scenario.name
    issues.push(...scenarioIssues)
  }

  issues.push(...karateRepeatedSetup(feature))

  return issues
}
