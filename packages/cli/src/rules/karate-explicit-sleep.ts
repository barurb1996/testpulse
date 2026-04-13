import type { Issue } from '../types.js'
import type { KarateScenario } from '../parsers/karate.js'

const SLEEP_PATTERNS = [
  /\bhelpers\.sleep\s*\(/,
  /\bjava\.lang\.Thread\.sleep\s*\(/,
  /\bThread\.sleep\s*\(/,
  /\bkarate\.sleep\s*\(/
]

export function karateExplicitSleep(scenario: KarateScenario): Issue[] {
  const issues: Issue[] = []
  for (const step of scenario.steps) {
    if (SLEEP_PATTERNS.some(p => p.test(step.text))) {
      issues.push({
        rule: 'karate-explicit-sleep',
        severity: 'warning',
        message: `Avoid explicit sleep — use Karate's retry/polling (karate.retry, configure retry) instead: "${step.text.trim()}"`,
        line: step.line
      })
    }
  }
  return issues
}
