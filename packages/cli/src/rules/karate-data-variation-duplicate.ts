import path from 'path'
import type { Issue } from '../types.js'
import type { KarateScenario } from '../parsers/karate.js'
import type { KarateProjectContext } from '../parsers/karate-project.js'

function formatRefs(refs: Array<{ file: string; line: number; name: string }>, limit = 3): string {
  const shown = refs.slice(0, limit).map(r => `${path.basename(r.file)}:${r.line}`).join(', ')
  const extra = refs.length > limit ? ` (+${refs.length - limit} more)` : ''
  return shown + extra
}

export function karateDataVariationDuplicate(
  scenario: KarateScenario,
  filePath: string,
  ctx?: KarateProjectContext,
  isHelper = false
): Issue[] {
  if (!ctx) return []
  if (scenario.steps.length < 3) return []

  const siblings = ctx.findDataVariationsFor(filePath, scenario.line)
  if (siblings.length === 0) return []

  const refs = formatRefs(siblings)
  const n = siblings.length
  const message = isHelper
    ? `Helper "${scenario.name}" has ${n} sibling${n > 1 ? 's' : ''} with the same structure differing only in data — collapse into one helper parameterised via call args: ${refs}`
    : `Scenario "${scenario.name}" has the same structure as ${n} other${n > 1 ? 's' : ''} differing only in data — candidate for Scenario Outline + Examples: ${refs}`

  return [{
    rule: 'karate-data-variation-duplicate',
    severity: 'warning',
    message,
    line: scenario.line
  }]
}
