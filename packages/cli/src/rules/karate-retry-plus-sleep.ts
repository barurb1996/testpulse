import type { Issue } from '../types.js'
import type { KarateScenario } from '../parsers/karate.js'
import { HELPER_SLEEP_SOURCE } from '../helper-names.js'

const RETRY_CONFIG = /\bconfigure\s+retry\b|\bretry\s+until\b/i
const SLEEP_CALL = new RegExp(HELPER_SLEEP_SOURCE + '|\\bjava\\.lang\\.Thread\\.sleep\\s*\\(|\\bThread\\.sleep\\s*\\(|\\bkarate\\.sleep\\s*\\(', 'i')

export function karateRetryPlusSleep(scenario: KarateScenario): Issue[] {
  let retryStep: { line: number; text: string } | null = null
  let sleepStep: { line: number; text: string } | null = null

  for (const step of scenario.steps) {
    if (!retryStep && RETRY_CONFIG.test(step.text)) retryStep = { line: step.line, text: step.text.trim() }
    if (!sleepStep && SLEEP_CALL.test(step.text)) sleepStep = { line: step.line, text: step.text.trim() }
    if (retryStep && sleepStep) break
  }

  if (!retryStep || !sleepStep) return []

  return [{
    rule: 'karate-retry-plus-sleep',
    severity: 'warning',
    message: `Scenario uses both a retry/poll mechanism (line ${retryStep.line}) and an explicit sleep (line ${sleepStep.line}) — double-delay anti-pattern, pick one`,
    line: sleepStep.line
  }]
}
