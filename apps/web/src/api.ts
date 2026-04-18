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

export interface GapSuggestion {
  id: string
  targetId: string
  title: string
  rationale: string | null
  severity: Severity
  steps: string[]
  model: string | null
  createdAt: string
  targetVerb: string
  targetPath: string
  targetDomain: string | null
  targetSummary: string | null
}

export interface GapAnalyzeResult {
  analysed: number
  generated: number
  cached: number
  failed?: number
  skippedByBlock?: number
  errors?: string[]
  total: number
  message?: string
  error?: string
  dryRun?: boolean
  wouldAnalyse?: number
  model?: string
  payloads?: Array<{
    verb: string
    path: string
    summary: string | null
    operationId: string | null
    domain: string | null
    existingScenarios: string[]
  }>
}

export async function fetchGapSuggestions(projectSlug: string): Promise<GapSuggestion[]> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectSlug)}/gap-suggestions`)
  if (!res.ok) throw new Error(`API ${res.status}`)
  const data = await res.json() as { suggestions: GapSuggestion[] }
  return data.suggestions
}

export interface GapAnalyzeOptions {
  forceRefresh?: boolean
  dryRun?: boolean
  blockedPaths?: string[]
}

export async function runGapAnalysis(projectSlug: string, opts: GapAnalyzeOptions = {}): Promise<GapAnalyzeResult> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectSlug)}/gap-analyze`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(opts)
  })
  const data = await res.json() as GapAnalyzeResult
  if (!res.ok && !data.error) throw new Error(`API ${res.status}`)
  return data
}

export interface CoverageTrendPoint {
  runId: string
  createdAt: string
  covered: number
  total: number
  coveragePercent: number
}

export interface ScenarioResult {
  id: string
  suite: string
  name: string
  classname: string | null
  status: 'pass' | 'fail' | 'skip' | 'error'
  durationMs: number | null
  failureMessage: string | null
  failureDetail: string | null
}

export interface ScenarioResultsResponse {
  scenarios: ScenarioResult[]
  counts: { pass: number; fail: number; skip: number; error: number }
}

export async function fetchRunScenarios(runId: string): Promise<ScenarioResultsResponse> {
  const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/scenarios`)
  if (!res.ok) throw new Error(`API ${res.status}`)
  return await res.json() as ScenarioResultsResponse
}

export interface FlakyScenario {
  suite: string
  name: string
  classname: string | null
  appearances: number
  passes: number
  fails: number
  passRate: number
  flipCount: number
  history: Array<{ createdAt: string; status: string; runId: string; failureMessage: string | null }>
  staticHints?: string[]
}

export interface FlakyReport {
  flaky: FlakyScenario[]
  minRuns: number
  totalScenariosTracked: number
}

export interface RegressionReport {
  newFailures: Array<{ suite: string; classname: string | null; name: string; failureMessage: string | null; previousStatus: string }>
  fixed: Array<{ suite: string; classname: string | null; name: string; previousMessage: string | null }>
  previousRunId: string | null
  totalComparedAgainst: number
  note?: string
}

export interface TimingChange {
  suite: string
  classname: string | null
  name: string
  previousMs: number
  currentMs: number
  deltaMs: number
  deltaPercent: number
}

export interface TimingChangesReport {
  slower: TimingChange[]
  faster: TimingChange[]
  previousRunId: string | null
  thresholds?: { deltaPercent: number; deltaAbsMs: number }
  note?: string
}

export async function fetchTimingChanges(runId: string): Promise<TimingChangesReport> {
  const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/timing-changes`)
  if (!res.ok) throw new Error(`API ${res.status}`)
  return await res.json() as TimingChangesReport
}

export async function fetchRegressions(runId: string): Promise<RegressionReport> {
  const res = await fetch(`/api/runs/${encodeURIComponent(runId)}/regressions`)
  if (!res.ok) throw new Error(`API ${res.status}`)
  return await res.json() as RegressionReport
}

export interface SlowScenario {
  suite: string
  name: string
  classname: string | null
  appearances: number
  fails: number
  avgMs: number
  maxMs: number
  p95Ms: number
}

export async function fetchSlowest(projectSlug: string): Promise<{ slowest: SlowScenario[]; totalTimeInSampleMs: number }> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectSlug)}/slowest`)
  if (!res.ok) throw new Error(`API ${res.status}`)
  return await res.json() as { slowest: SlowScenario[]; totalTimeInSampleMs: number }
}

export async function updateProject(
  projectSlug: string,
  input: { name?: string; slackWebhookUrl?: string | null }
): Promise<void> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectSlug)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input)
  })
  if (!res.ok) throw new Error(`API ${res.status}`)
}

export async function fetchFlaky(projectSlug: string): Promise<FlakyReport> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectSlug)}/flaky`)
  if (!res.ok) throw new Error(`API ${res.status}`)
  return await res.json() as FlakyReport
}

export interface CoverageHistoryEntry {
  runId: string
  createdAt: string
  totalCovered: number
  totalTargets: number
  gained: Array<{ verb: string; path: string; domain: string | null; summary: string | null }>
  lost: Array<{ verb: string; path: string; domain: string | null; summary: string | null }>
}

export interface HealthComponent {
  name: string
  raw: string
  score: number
  weight: number
}

export interface HealthReport {
  score: number | null
  components: HealthComponent[]
  basedOn?: { runId: string; createdAt: string; totalScenariosTracked: number; coverageTargets: number }
  note?: string
}

export interface HealthTrendPoint {
  runId: string
  createdAt: string
  staticScore: number
  healthScore: number | null
}

export async function fetchHealthTrend(projectSlug: string): Promise<HealthTrendPoint[]> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectSlug)}/health-trend`)
  if (!res.ok) throw new Error(`API ${res.status}`)
  const data = await res.json() as { trend: HealthTrendPoint[] }
  return data.trend
}

export interface BranchSummary {
  branch: string
  runCount: number
  lastRunAt: string
}

export async function fetchBranches(projectSlug: string): Promise<BranchSummary[]> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectSlug)}/branches`)
  if (!res.ok) throw new Error(`API ${res.status}`)
  const data = await res.json() as { branches: BranchSummary[] }
  return data.branches
}

export interface BranchComparisonSide {
  branch: string
  runId: string
  score: number
  healthScore: number | null
  criticals: number
  createdAt: string
  coveragePercent: number | null
}

export interface BranchComparison {
  base: BranchComparisonSide
  compare: BranchComparisonSide
  scenarioChanges: {
    newFailures: Array<{ suite: string; classname: string | null; name: string; failureMessage: string | null }>
    fixed: Array<{ suite: string; classname: string | null; name: string }>
    slower: Array<{ suite: string; classname: string | null; name: string; baseMs: number; compareMs: number; deltaMs: number }>
    faster: Array<{ suite: string; classname: string | null; name: string; baseMs: number; compareMs: number; deltaMs: number }>
  }
  error?: string
}

export async function fetchBranchComparison(projectSlug: string, base: string, compare: string): Promise<BranchComparison> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectSlug)}/branch-comparison?base=${encodeURIComponent(base)}&compare=${encodeURIComponent(compare)}`)
  const data = await res.json() as BranchComparison
  if (!res.ok && !data.error) throw new Error(`API ${res.status}`)
  return data
}

export interface ProjectDoc {
  id: string
  filename: string
  charCount: number
  source: string
  createdAt: string
}

export async function fetchProjectDocs(projectSlug: string): Promise<ProjectDoc[]> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectSlug)}/docs`)
  if (!res.ok) throw new Error(`API ${res.status}`)
  const data = await res.json() as { docs: ProjectDoc[] }
  return data.docs
}

export async function deleteProjectDoc(projectSlug: string, docId: string): Promise<void> {
  await fetch(`/api/projects/${encodeURIComponent(projectSlug)}/docs/${encodeURIComponent(docId)}`, { method: 'DELETE' })
}

export async function fetchHealth(projectSlug: string): Promise<HealthReport> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectSlug)}/health`)
  if (!res.ok) throw new Error(`API ${res.status}`)
  return await res.json() as HealthReport
}

export interface DigestReport {
  project: { slug: string; name: string }
  windowDays: number
  windowStart: string
  runsInWindow: number
  scoreRange: { min: number; max: number; latest: number } | null
  totalCriticals: number
  flakyTop: Array<{ suite: string; classname: string | null; name: string; passRate: number; appearances: number }>
  slowestTop: Array<{ suite: string; classname: string | null; name: string; avgMs: number; appearances: number }>
  newSuggestionCount: number
}

export async function fetchDigest(projectSlug: string, days = 7): Promise<DigestReport> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectSlug)}/digest?days=${days}`)
  if (!res.ok) throw new Error(`API ${res.status}`)
  return await res.json() as DigestReport
}

export async function sendDigestToSlack(projectSlug: string, days = 7): Promise<{ delivered: boolean; preview?: string; error?: string }> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectSlug)}/digest/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ days })
  })
  const data = await res.json() as { delivered?: boolean; preview?: string; error?: string }
  if (!res.ok && !data.error) throw new Error(`API ${res.status}`)
  return { delivered: data.delivered ?? false, preview: data.preview, error: data.error }
}

export async function fetchCoverageHistory(projectSlug: string): Promise<CoverageHistoryEntry[]> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectSlug)}/coverage-history`)
  if (!res.ok) throw new Error(`API ${res.status}`)
  const data = await res.json() as { history: CoverageHistoryEntry[] }
  return data.history
}

export async function fetchCoverageTrend(projectSlug: string): Promise<CoverageTrendPoint[]> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectSlug)}/coverage-trend`)
  if (!res.ok) throw new Error(`API ${res.status}`)
  const data = await res.json() as { trend: CoverageTrendPoint[] }
  return data.trend
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
