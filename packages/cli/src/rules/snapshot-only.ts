import type { Issue } from '../types.js'
import { SNAPSHOT_MATCHERS } from '../parsers/playwright-model.js'
import type { PlaywrightTestCase } from '../parsers/playwright-model.js'

export function snapshotOnly(tc: PlaywrightTestCase): Issue[] {
  if (tc.asserts.length === 0) return []

  const allSnapshot = tc.asserts.every(a => SNAPSHOT_MATCHERS.has(a.matcher))
  if (!allSnapshot) return []

  return [{
    rule: 'snapshot-only',
    severity: 'info',
    message: `Test "${tc.name}" relies entirely on snapshots — snapshots hide intent and silently accept regressions`,
    line: tc.line,
    category: 'ai-slop',
    suggestion: 'Add explicit value assertions alongside snapshots to document what the test actually verifies'
  }]
}
