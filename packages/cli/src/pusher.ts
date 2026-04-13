import type { AnalysisResult, EndpointCoverage } from './types.js'
import type { Summary } from './reporter/index.js'

export interface PushOptions {
  url: string
  projectSlug: string
  projectName?: string
  commitSha?: string
  branch?: string
  endpoints?: EndpointCoverage[]
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
      fingerprint: i.fingerprint
    }))),
    endpoints: opts.endpoints ?? []
  }

  const endpoint = opts.url.replace(/\/$/, '') + '/api/runs'
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Push failed: ${res.status} ${res.statusText} — ${body}`)
  }

  const data = await res.json() as { runId: string }
  console.log(`Pushed run ${data.runId} to ${endpoint}`)
}
