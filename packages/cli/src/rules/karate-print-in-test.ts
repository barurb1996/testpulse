import type { Issue } from '../types.js'
import type { KarateScenario } from '../parsers/karate.js'

const PRINT_STEP = /^print\s+/

export function karatePrintInTest(scenario: KarateScenario): Issue[] {
  const issues: Issue[] = []
  for (const step of scenario.steps) {
    if (PRINT_STEP.test(step.text)) {
      issues.push({
        rule: 'karate-print-in-test',
        severity: 'info',
        message: `Debug "print" left in test — remove before merging: "${step.text.slice(0, 80)}"`,
        line: step.line
      })
    }
  }
  return issues
}
