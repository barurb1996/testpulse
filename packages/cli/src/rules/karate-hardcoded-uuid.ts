import type { Issue } from '../types.js'
import type { KarateScenario } from '../parsers/karate.js'

const UUID_LITERAL = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i
const MATCHER_CONTEXT = /#(uuid|regex|string|notnull|null|present|notpresent)/i

export function karateHardcodedUuid(scenario: KarateScenario): Issue[] {
  const issues: Issue[] = []
  for (const step of scenario.steps) {
    const m = UUID_LITERAL.exec(step.text)
    if (!m) continue
    if (MATCHER_CONTEXT.test(step.text)) continue
    issues.push({
      rule: 'karate-hardcoded-uuid',
      severity: 'warning',
      message: `Hardcoded UUID "${m[0]}" — tests should generate unique IDs (karate.uuid() / genUUIDv4) to avoid cross-run contamination`,
      line: step.line
    })
  }
  return issues
}
