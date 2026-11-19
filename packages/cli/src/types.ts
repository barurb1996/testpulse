export type IssueSeverity = 'critical' | 'warning' | 'info'
export type RuleCategory = 'ai-slop' | 'security-hygiene' | 'security-coverage' | 'ai-app'

export interface Issue {
  rule: string
  severity: IssueSeverity
  message: string
  line: number
  fingerprint?: string
  scenarioName?: string
  category?: RuleCategory
  suggestion?: string
}

export interface AnalysisResult {
  file: string
  issues: Issue[]
}

export interface EndpointCoverage {
  verb: string
  path: string
  file: string
  line: number
  scenarioName: string
  via: 'direct' | 'helper'
}

export interface ScenarioRunResult {
  suite: string
  name: string
  classname: string | null
  status: 'pass' | 'fail' | 'skip' | 'error'
  durationMs: number | null
  failureMessage: string | null
  failureDetail: string | null
}
