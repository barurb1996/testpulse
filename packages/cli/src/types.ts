export type IssueSeverity = 'critical' | 'warning' | 'info'

export interface Issue {
  rule: string
  severity: IssueSeverity
  message: string
  line: number
}

export interface AnalysisResult {
  file: string
  issues: Issue[]
}
