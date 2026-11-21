import type { Issue } from '../types.js'
import type { KarateScenario } from '../parsers/karate.js'
import { SETUP_NAME, isSetupFile } from './karate-setup.js'

const SUCCESS_STATUS = /^status\s+2\d\d\b/i
const HEALTH_NAME = /\b(health|ping|liveness|readiness|alive)\b/i

/** Scenario ends at `status 2xx` and never looks at the response body or any follow-up state. */
export function karateStatusOnlySuccess(scenario: KarateScenario, filePath = ''): Issue[] {
  if (SETUP_NAME.test(scenario.name) || (filePath && isSetupFile(filePath))) return [] // arranging or cleaning up state, not a test of behaviour
  if (HEALTH_NAME.test(scenario.name)) return []
  if (/\b(accepts?|accepted|allows?|allowed|boundary|boundaries|minimum|maximum)\b/i.test(scenario.name)) return [] // the status is the behaviour
  const texts = scenario.steps.map(s => s.text)
  const success = scenario.steps.find(s => SUCCESS_STATUS.test(s.text))
  if (!success) return []
  const inspectsBody = texts.some(t => /^(match|assert)\b/i.test(t) || /\bretry\s+until\b/i.test(t) || /^call\b|\bcall\s+read\(/i.test(t) || /\bresponse(?!Status)\w*\b/.test(t.replace(/^status\s+\d+/i, '')))
  if (inspectsBody) return []
  const calls = texts.filter(t => /^method\s+/i.test(t)).length
  if (calls !== 1) return [] // multi-call flows verify state by the later call
  return [{
    rule: 'karate-status-only-success',
    severity: 'warning',
    message: `Scenario "${scenario.name}" asserts only a 2xx status — the response body is never checked`,
    line: scenario.line,
    category: 'ai-slop',
    suggestion: 'Add a `match response ...` on the fields the scenario name promises, or follow up with a read'
  }]
}
