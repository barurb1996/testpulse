import path from 'path'
import type { Issue } from '../types.js'
import type { KarateScenario } from '../parsers/karate.js'
import type { KarateProjectContext } from '../parsers/karate-project.js'

function formatRefs(refs: Array<{ file: string; line: number; name: string }>, limit = 3): string {
  const shown = refs.slice(0, limit).map(r => `${path.basename(r.file)}:${r.line}`).join(', ')
  const extra = refs.length > limit ? ` (+${refs.length - limit} more)` : ''
  return shown + extra
}

export function karateDuplicateScenario(
  scenario: KarateScenario,
  filePath: string,
  ctx?: KarateProjectContext
): Issue[] {
  if (!ctx) return []
  const dups = ctx.findDuplicatesFor(filePath, scenario.line)
  if (dups.length === 0) return []

  return [{
    rule: 'karate-duplicate-scenario',
    severity: 'warning',
    message: `Scenario "${scenario.name}" has ${dups.length} identical sibling${dups.length > 1 ? 's' : ''}: ${formatRefs(dups)}`,
    line: scenario.line
  }]
}
