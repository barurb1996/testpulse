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
  ctx?: KarateProjectContext,
  isHelper = false
): Issue[] {
  if (!ctx) return []
  const dups = ctx.findDuplicatesFor(filePath, scenario.line)
  if (dups.length === 0) return []

  const refs = formatRefs(dups)
  const n = dups.length
  const message = isHelper
    ? `Helper "${scenario.name}" has ${n} identical sibling${n > 1 ? 's' : ''} — merge into one helper: ${refs}`
    : `Scenario "${scenario.name}" has ${n} identical sibling${n > 1 ? 's' : ''}: ${refs}`

  // Copies spread over several files are usually shared setup pasted around; copies in one file are duplicated tests.
  const sameFile = dups.some(d => path.resolve(d.file) === path.resolve(filePath))
  return [{
    rule: 'karate-duplicate-scenario',
    severity: sameFile ? 'warning' : 'info',
    message,
    line: scenario.line
  }]
}
