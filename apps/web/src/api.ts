export type Severity = 'critical' | 'warning' | 'info'

export interface Run {
  id: string
  projectSlug: string
  projectName?: string
  commitSha: string | null
  branch: string | null
  score: number
  totalIssues: number
  criticalIssues: number
  filesScanned: number
  createdAt: string
}

export interface RunIssue {
  file: string
  line: number
  rule: string
  severity: Severity
  message: string
}

export interface RunDetail {
  run: Run
  issues: RunIssue[]
}

export async function fetchRuns(project: string, limit = 50): Promise<Run[]> {
  const res = await fetch(`/api/runs?project=${encodeURIComponent(project)}&limit=${limit}`)
  if (!res.ok) throw new Error(`API ${res.status}`)
  const data = await res.json() as { runs: Run[] }
  return data.runs
}

export async function fetchRunDetail(id: string): Promise<RunDetail> {
  const res = await fetch(`/api/runs/${encodeURIComponent(id)}`)
  if (!res.ok) throw new Error(`API ${res.status}`)
  return await res.json() as RunDetail
}
