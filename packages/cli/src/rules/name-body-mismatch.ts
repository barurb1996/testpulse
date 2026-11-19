import type { Issue } from '../types.js'
import type { PlaywrightTestCase } from '../parsers/playwright-model.js'

// Strong, API-flavoured error cues only. UI phrasing like "should not show X" is a valid negative
// test asserted with .not.toBeVisible(), so it is deliberately NOT a cue.
const ERROR_CUE = /\b(reject(s|ed)?|fail(s|ed|ure)?|throws?|unauthori[sz]ed|forbidden|401|403|422|400|expired|invalid\s+(token|credentials?|input|request))\b/i

/** Fires when the name promises a failure but the only status the test asserts is a success. */
export function nameBodyMismatch(tc: PlaywrightTestCase): Issue[] {
  if (!ERROR_CUE.test(tc.name)) return []
  if (!tc.hasSuccessStatusAssertion) return []
  if (tc.hasErrorPattern || tc.hasNegativeAssertion || tc.hasHelperAssertion) return []

  return [{
    rule: 'name-body-mismatch',
    severity: 'warning',
    message: `Test name promises a failure ("${tc.name}") but the test asserts a successful response`,
    line: tc.line,
    category: 'ai-slop',
    suggestion: 'Assert the 4xx status / error body the name describes, or rename the test to what it actually checks'
  }]
}
