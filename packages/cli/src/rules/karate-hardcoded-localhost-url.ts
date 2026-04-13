import type { Issue } from '../types.js'
import type { KarateScenario } from '../parsers/karate.js'

const LOCALHOST_PATTERN = /https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/

export function karateHardcodedLocalhostUrl(scenario: KarateScenario): Issue[] {
  const issues: Issue[] = []
  for (const step of scenario.steps) {
    const match = LOCALHOST_PATTERN.exec(step.text)
    if (match) {
      issues.push({
        rule: 'karate-hardcoded-localhost-url',
        severity: 'warning',
        message: `Hardcoded localhost URL "${match[0]}" — move to karate-config.js or a variable so the test is portable`,
        line: step.line
      })
    }
  }
  return issues
}
