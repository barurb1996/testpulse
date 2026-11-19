import type { Issue } from '../types.js'
import type { PlaywrightTestCase } from '../parsers/playwright-model.js'

/** `for (const x of items) expect(x)…` passes when `items` is empty; the loop proves nothing without a non-empty check. */
export function vacuousLoopAssertion(tc: PlaywrightTestCase): Issue[] {
  return tc.vacuousLoops.map(line => ({
    rule: 'vacuous-loop-assertion',
    severity: 'warning' as const,
    message: `Assertions inside a loop in "${tc.name}" never run if the list is empty — the test can pass on no data`,
    line,
    category: 'ai-slop' as const,
    suggestion: 'Assert the list is non-empty (expect(items.length).toBeGreaterThan(0)) before looping, or use toHaveLength'
  }))
}
