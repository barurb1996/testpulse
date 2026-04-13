import type { Issue } from '../types.js'
import type { KarateScenario } from '../parsers/karate.js'

const CONFIGURE_STEP = /^configure\s+(retry|timeout|charset|connectTimeout|readTimeout|driver|proxy|ssl|logPrettyRequest|logPrettyResponse)\b/i

export function karateConfigureRetryInScenario(scenario: KarateScenario): Issue[] {
  const issues: Issue[] = []
  for (const step of scenario.steps) {
    const m = CONFIGURE_STEP.exec(step.text)
    if (!m) continue
    issues.push({
      rule: 'karate-configure-retry-in-scenario',
      severity: 'warning',
      message: `Ad-hoc "configure ${m[1]}" inside a scenario — move to karate-config.js (global) or a Background block (scoped) so behaviour is explicit and consistent`,
      line: step.line
    })
  }
  return issues
}
