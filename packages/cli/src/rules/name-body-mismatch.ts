import type { Issue } from '../types.js'
import type { PlaywrightTestCase } from '../parsers/playwright-model.js'

const ERROR_KEYWORDS = /\b(reject|fail|throw|error|invalid|unauthori[sz]ed|forbidden|not\s+allowed|403|401|422|400|should\s+not|cannot|must\s+not)\b/i

export function nameBodyMismatch(tc: PlaywrightTestCase): Issue[] {
  if (!ERROR_KEYWORDS.test(tc.name)) return []
  if (tc.asserts.length === 0) return [] // no-assertion catches this
  if (tc.hasErrorPattern) return []

  return [{
    rule: 'name-body-mismatch',
    severity: 'warning',
    message: `Test name suggests an error case ("${tc.name}") but no error assertions found (toThrow / .rejects / 4xx)`,
    line: tc.line,
    category: 'ai-slop',
    suggestion: 'Add expect(fn).rejects.toThrow() or assert the response status is 4xx to match the test\'s stated intent'
  }]
}
