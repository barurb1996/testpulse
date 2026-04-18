import type { AnalysisResult, EndpointCoverage, ScenarioRunResult } from './types.js'
import type { Summary } from './reporter/index.js'

export interface PushOptions {
  url: string
  projectSlug: string
  projectName?: string
  commitSha?: string
  branch?: string
  endpoints?: EndpointCoverage[]
  scenarioResults?: ScenarioRunResult[]
  token?: string
}

export async function pushRun(
  results: AnalysisResult[],
  summary: Summary,
  opts: PushOptions
): Promise<void> {
  const payload = {
    projectSlug: opts.projectSlug,
    projectName: opts.projectName,
    commitSha: opts.commitSha ?? process.env.GITHUB_SHA,
    branch: opts.branch ?? process.env.GITHUB_REF_NAME,
    score: summary.score,
    filesScanned: summary.filesScanned,
    issues: results.flatMap(r => r.issues.map(i => ({
      file: r.file,
      line: i.line,
      rule: i.rule,
      severity: i.severity,
      message: i.message,
      fingerprint: i.fingerprint,
      scenarioName: i.scenarioName
    }))),
    endpoints: opts.endpoints ?? [],
    scenarioResults: opts.scenarioResults ?? []
  }

  const endpoint = opts.url.replace(/\/$/, '') + '/api/runs'
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  const token = opts.token ?? process.env.TESTPULSE_TOKEN
  if (token) headers['authorization'] = `Bearer ${token}`

  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Push failed: ${res.status} ${res.statusText} — ${body}`)
  }

  const data = await res.json() as { runId: string }
  console.log(`Pushed run ${data.runId} to ${endpoint}`)
}
