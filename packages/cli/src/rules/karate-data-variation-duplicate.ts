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
  ctx?: KarateProjectContext
): Issue[] {
  if (!ctx) return []
  if (scenario.steps.length < 3) return []

  const siblings = ctx.findDataVariationsFor(filePath, scenario.line)
  if (siblings.length === 0) return []

  return [{
    rule: 'karate-data-variation-duplicate',
    severity: 'warning',
    message: `Scenario "${scenario.name}" has the same structure as ${siblings.length} other${siblings.length > 1 ? 's' : ''} differing only in data — candidate for Scenario Outline + Examples: ${formatRefs(siblings)}`,
    line: scenario.line
  }]
}
