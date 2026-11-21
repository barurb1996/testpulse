import type { Issue } from '../types.js'
import type { KarateScenario } from '../parsers/karate.js'

const UUID_LITERAL = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i
const MATCHER_CONTEXT = /#(uuid|regex|string|notnull|null|present|notpresent)/i
const DEF_CONSTANT = /^(?:def|set)\s+([\w.$]+)\s*=\s*['"][^'"]*['"]\s*$/i
const REQUEST_STEP = /^request\b/i

function isProbeId(uuid: string): boolean {
  return /^(0{8}-0{4}-0{4}-0{4}-0{12}|(\w)\2{7}-(\2{4}-){3}\2{12})$/i.test(uuid) // nil / same-digit probe id
}

/**
 * The risk this rule is about: a fixed ID baked into a resource the test CREATES, so a second run collides with
 * the first. A fixed ID is only reported when it ends up in a request body, either inline (`request {"id": "…"}`)
 * or through a constant that the same scenario sends (`request`, `#(var)`). Constants for seeded reference data,
 * expected values in `match`, `param`/`header` values, `path`/`url` and function arguments are references,
 * not created data, so they are left alone.
 */
export function karateHardcodedUuid(scenario: KarateScenario): Issue[] {
  const issues: Issue[] = []
  const flag = (uuid: string, line: number) => issues.push({
    rule: 'karate-hardcoded-uuid',
    severity: 'warning',
    message: `Hardcoded UUID "${uuid}" in a request body — create unique IDs (karate.uuid() / genUUIDv4) so repeated runs do not collide`,
    line
  })

  const sentText = scenario.steps.map(s => s.text).filter(t => REQUEST_STEP.test(t) || /#\(/.test(t)).join('\n')

  for (const step of scenario.steps) {
    const text = step.text.trim()
    const m = UUID_LITERAL.exec(text)
    if (!m || isProbeId(m[0]) || MATCHER_CONTEXT.test(text)) continue

    if (REQUEST_STEP.test(text)) { flag(m[0], step.line); continue }

    const def = DEF_CONSTANT.exec(text)
    if (def) {
      const name = def[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const sent = new RegExp(`#\\(\\s*${name}\\b|\\brequest\\s+[^\\n]*\\b${name}\\b`).test(sentText)
      if (sent) flag(m[0], step.line)
    }
  }
  return issues
}
