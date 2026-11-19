import type { Issue } from '../types.js'
import type { PlaywrightTestCase } from '../parsers/playwright-model.js'

const HEALTH_NAME = /\b(health|ping|liveness|readiness|alive|status page)\b/i
const ACCEPTANCE_NAME = /\b(accepts?|accepted|allows?|allowed|boundary|boundaries|at (min|max)|minimum|maximum)\b/i
const STATUSY = /status|\bok\b/i

/**
 * The dominant weakness of otherwise reasonable AI-written API tests: the call is made and a 2xx status is
 * asserted, but nothing about the returned or changed data is verified.
 */
export function statusOnlySuccess(tc: PlaywrightTestCase, makesApiCall: boolean): Issue[] {
  if (!makesApiCall) return [] // rule is about API tests; `toBeOK` on UI helpers is something else
  if (tc.asserts.length === 0) return []
  if (!tc.hasSuccessStatusAssertion) return []
  if (HEALTH_NAME.test(tc.name)) return []
  if (tc.hasHelperAssertion) return []
  if (tc.hasErrorStatusAssertion) return [] // the test also pins an error outcome: not a bare happy-path status check
  if (ACCEPTANCE_NAME.test(tc.name)) return [] // "accepts X": the status IS the behaviour
  if (!tc.asserts.every(a => STATUSY.test(a.subjectExpr) || a.matcher === 'toBeOK')) return []

  return [{
    rule: 'status-only-success',
    severity: 'warning',
    message: `Test "${tc.name}" asserts only a 2xx status — the returned/changed data is never verified`,
    line: tc.line,
    category: 'ai-slop',
    suggestion: 'Also assert the response body or follow up with a read (e.g. GET after create/update/delete) so a wrong payload or no-op would fail'
  }]
}
