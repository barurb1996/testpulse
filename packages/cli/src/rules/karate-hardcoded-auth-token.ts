import type { Issue } from '../types.js'
import type { KarateScenario } from '../parsers/karate.js'

const BEARER_JWT = /Bearer\s+eyJ[A-Za-z0-9._-]{20,}/
const API_KEY_HEADER = /\b(x-api-key|apikey|api[-_]?key)\s*[:=]\s*['"][A-Za-z0-9._-]{20,}['"]/i
const BASIC_AUTH = /Basic\s+[A-Za-z0-9+/=]{20,}/

export function karateHardcodedAuthToken(scenario: KarateScenario): Issue[] {
  const issues: Issue[] = []
  for (const step of scenario.steps) {
    const match = BEARER_JWT.exec(step.text) || API_KEY_HEADER.exec(step.text) || BASIC_AUTH.exec(step.text)
    if (!match) continue
    issues.push({
      rule: 'karate-hardcoded-auth-token',
      severity: 'critical',
      message: `Hardcoded credential in step — move to karate-config.js / env var: "${match[0].slice(0, 60)}..."`,
      line: step.line
    })
  }
  return issues
}
