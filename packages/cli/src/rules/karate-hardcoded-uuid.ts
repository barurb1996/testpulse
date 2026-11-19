import type { Issue } from '../types.js'
import type { KarateScenario } from '../parsers/karate.js'

const UUID_LITERAL = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i
const MATCHER_CONTEXT = /#(uuid|regex|string|notnull|null|present|notpresent)/i

export function karateHardcodedUuid(scenario: KarateScenario): Issue[] {
  const issues: Issue[] = []
  for (const step of scenario.steps) {
    // A UUID in `path`/`url` references an existing or deliberately non-existent resource — not generated data.
    if (/^(path|url)\s/i.test(step.text)) continue
    const m = UUID_LITERAL.exec(step.text)
    if (!m) continue
    if (/^(0{8}-0{4}-0{4}-0{4}-0{12}|(\w)\2{7}-(\2{4}-){3}\2{12})$/i.test(m[0])) continue // nil / same-digit probe id
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
