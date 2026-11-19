import path from 'path'
import type { Issue, EndpointCoverage } from '../types.js'
import type { PlaywrightTestCase } from '../parsers/playwright-model.js'

/**
 * Only meaningful for API-style test files: UI end-to-end flows are legitimately mostly positive,
 * so the rule needs HTTP calls in the file, none of them asserting a non-happy outcome.
 */
export function happyPathOnly(testCases: PlaywrightTestCase[], filePath: string, apiCalls: EndpointCoverage[]): Issue[] {
  // Only calls whose response the test actually asserts count: `api.post` used for setup is not a test subject.
  apiCalls = apiCalls.filter(c => c.status !== null && c.status !== undefined)
  if (testCases.length < 2) return []
  if (apiCalls.length < 2) return []
  if (apiCalls.some(c => (c.kinds ?? []).some(k => k !== 'happy'))) return []
  if (testCases.some(tc => tc.hasErrorPattern || tc.hasNegativeAssertion)) return []

  const fileName = path.basename(filePath)
  return [{
    rule: 'happy-path-only',
    severity: 'warning',
    message: `${fileName}: ${apiCalls.length} API calls across ${testCases.length} tests, none asserts an error / 4xx / unauthorised outcome`,
    line: testCases[0].line,
    category: 'ai-slop',
    suggestion: 'Add at least one negative API test: invalid input, missing/invalid auth, or a 4xx response'
  }]
}
