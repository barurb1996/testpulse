import type { Issue } from '../types.js'
import type { KarateScenario } from '../parsers/karate.js'

const RETRY_CONFIG = /configure\s+retry\s*=\s*\{([^}]+)\}/i
const COUNT_KV = /\bcount\s*:\s*(\d+)/i
const INTERVAL_KV = /\binterval\s*:\s*(\d+)/i

const THRESHOLD_MS = 60_000

export function karateExcessiveRetryWindow(scenario: KarateScenario): Issue[] {
  const issues: Issue[] = []
  for (const step of scenario.steps) {
    const m = RETRY_CONFIG.exec(step.text)
    if (!m) continue
    const body = m[1]
    const countM = COUNT_KV.exec(body)
    const intervalM = INTERVAL_KV.exec(body)
    if (!countM || !intervalM) continue
    const count = Number(countM[1])
    const interval = Number(intervalM[1])
    if (!Number.isFinite(count) || !Number.isFinite(interval)) continue
    const windowMs = count * interval
    if (windowMs < THRESHOLD_MS) continue
    issues.push({
      rule: 'karate-excessive-retry-window',
      severity: 'warning',
      message: `Retry window is ${(windowMs / 1000).toFixed(0)}s (count: ${count} × interval: ${interval}ms) — waiting >${THRESHOLD_MS / 1000}s for a condition usually masks a race or missing explicit wait-for-state check`,
      line: step.line
    })
  }
  return issues
}
