import path from 'path'
import type { Issue } from '../types.js'
import type { PlaywrightTestCase } from '../parsers/playwright-model.js'

export function happyPathOnly(testCases: PlaywrightTestCase[], filePath: string): Issue[] {
  if (testCases.length < 2) return [] // single test: insufficient signal

  const anyError = testCases.some(tc => tc.hasErrorPattern)
  if (anyError) return []

  const fileName = path.basename(filePath)
  return [{
    rule: 'happy-path-only',
    severity: 'warning',
    message: `${fileName}: all ${testCases.length} tests are happy-path only — no error cases, 4xx responses, or negative scenarios`,
    line: testCases[0].line,
    category: 'ai-slop',
    suggestion: 'Add at least one negative test: invalid input, unauthorized access, missing data, or error handling'
  }]
}
