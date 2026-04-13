import path from 'path'
import type { Issue } from '../types.js'
import type { KarateScenario } from '../parsers/karate.js'
import type { KarateProjectContext } from '../parsers/karate-project.js'

const OVERLAP_THRESHOLD = 2

export function karateEndpointCoverageOverlap(
  scenario: KarateScenario,
  filePath: string,
  ctx?: KarateProjectContext
): Issue[] {
  if (!ctx) return []
  const overlaps = ctx.findEndpointOverlapsFor(filePath, scenario.line)
  if (overlaps.length === 0) return []

  const issues: Issue[] = []
  for (const overlap of overlaps) {
    if (overlap.others.length < OVERLAP_THRESHOLD) continue
    const sample = overlap.others
      .slice(0, 3)
      .map(r => `${path.basename(r.file)}:${r.line}`)
      .join(', ')
    const extra = overlap.others.length > 3 ? ` (+${overlap.others.length - 3} more)` : ''
    issues.push({
      rule: 'karate-endpoint-coverage-overlap',
      severity: 'info',
      message: `${overlap.verb} ${overlap.endpoint} is exercised by ${overlap.others.length + 1} scenarios — possible redundant coverage. Others: ${sample}${extra}`,
      line: scenario.line
    })
  }

  return issues
}
