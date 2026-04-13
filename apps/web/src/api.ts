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
  fingerprint: string | null
  isIgnored?: boolean
}

export interface IgnoreEntry {
  id: string
  projectId: string
  fingerprint: string
  rule: string | null
  file: string | null
  line: number | null
  reason: string | null
  createdAt: string
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

export interface ProjectSummary {
  slug: string
  name: string
  runCount: number
  lastRunAt: string | null
  latestScore: number | null
  latestCritical: number | null
}

export async function fetchProjects(): Promise<ProjectSummary[]> {
  const res = await fetch('/api/projects')
  if (!res.ok) throw new Error(`API ${res.status}`)
  const data = await res.json() as { projects: ProjectSummary[] }
  return data.projects
}

export async function fetchRunDetail(id: string): Promise<RunDetail> {
  const res = await fetch(`/api/runs/${encodeURIComponent(id)}`)
  if (!res.ok) throw new Error(`API ${res.status}`)
  return await res.json() as RunDetail
}

export async function fetchIgnores(projectSlug: string): Promise<IgnoreEntry[]> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectSlug)}/ignores`)
  if (!res.ok) throw new Error(`API ${res.status}`)
  const data = await res.json() as { ignores: IgnoreEntry[] }
  return data.ignores
}

export async function addIgnore(
  projectSlug: string,
  input: { fingerprint: string; rule?: string; file?: string; line?: number; reason?: string }
): Promise<IgnoreEntry> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectSlug)}/ignores`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input)
  })
  if (!res.ok) throw new Error(`API ${res.status}`)
  const data = await res.json() as { ignore: IgnoreEntry }
  return data.ignore
}

export interface CoverageTarget {
  id: string
  verb: string
  path: string
  operationId: string | null
  summary: string | null
  domain: string | null
  source: string
}

export interface CoverageDomain {
  domain: string
  total: number
  covered: number
}

export interface CoverageReport {
  stats: {
    totalTargets: number
    coveredCount: number
    uncoveredCount: number
    coveragePercent: number
    orphanCount: number
  }
  covered: CoverageTarget[]
  uncovered: CoverageTarget[]
  byDomain: CoverageDomain[]
  orphans: Array<{ verb: string; path: string }>
}

export async function fetchCoverage(projectSlug: string): Promise<CoverageReport> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectSlug)}/coverage`)
  if (!res.ok) throw new Error(`API ${res.status}`)
  return await res.json() as CoverageReport
}

export async function removeIgnore(projectSlug: string, fingerprint: string): Promise<void> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectSlug)}/ignores/${encodeURIComponent(fingerprint)}`, {
    method: 'DELETE'
  })
  if (!res.ok && res.status !== 204) throw new Error(`API ${res.status}`)
}
