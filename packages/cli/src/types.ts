export type IssueSeverity = 'critical' | 'warning' | 'info'

export interface Issue {
  rule: string
  severity: IssueSeverity
  message: string
  line: number
  fingerprint?: string
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
