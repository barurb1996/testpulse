import type { Issue } from '../types.js'
import { EXISTENCE_MATCHERS } from '../parsers/playwright-model.js'
import type { PlaywrightTestCase } from '../parsers/playwright-model.js'

export function weakAssertionOnly(tc: PlaywrightTestCase): Issue[] {
  if (tc.asserts.length === 0) return [] // caught by no-assertion

  // Ignore matchers that are part of an existence + value chain (e.g. .toHaveLength is weak,
  // but if the same test also has .toBe('foo') it's fine)
  const allWeak = tc.asserts.every(a => EXISTENCE_MATCHERS.has(a.matcher))
  if (!allWeak) return []

  const matchers = [...new Set(tc.asserts.map(a => a.matcher))].join(', ')
  return [{
    rule: 'weak-assertion-only',
    severity: 'warning',
    message: `Test "${tc.name}" only checks existence (${matchers}) — never verifies actual values`,
    line: tc.line,
    category: 'ai-slop',
    suggestion: 'Replace existence checks with value assertions: expect(result).toBe(expectedValue)'
  }]
}
