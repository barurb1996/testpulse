import type { Issue } from '../types.js'
import type { KarateScenario } from '../parsers/karate.js'

const ASSERTION_STEP = /^(match|assert)\b/i
const METHOD_STEP = /^method\s+(get|post|put|delete|patch|head|options)\b/i
const CALL_STEP = /\bcall\b/

function normalise(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase()
}

export function karateDuplicateAssertion(scenario: KarateScenario): Issue[] {
  const issues: Issue[] = []
  let windowAssertions = new Map<string, number[]>()

  const flushWindow = () => {
    for (const [key, lines] of windowAssertions) {
      if (lines.length < 2) continue
      issues.push({
        rule: 'karate-duplicate-assertion',
        severity: 'warning',
        message: `Assertion "${key}" appears ${lines.length} times against the same HTTP response (lines ${lines.join(', ')})`,
        line: lines[0]
      })
    }
    windowAssertions = new Map()
  }

  for (const step of scenario.steps) {
    if (METHOD_STEP.test(step.text) || CALL_STEP.test(step.text)) {
      flushWindow()
      continue
    }
    if (!ASSERTION_STEP.test(step.text)) continue
    const key = normalise(step.text)
    const bucket = windowAssertions.get(key) ?? []
    bucket.push(step.line)
    windowAssertions.set(key, bucket)
  }
  flushWindow()

  return issues
}
