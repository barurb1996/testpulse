export interface Run {
  id: string
  projectSlug: string
  commitSha: string | null
  branch: string | null
  score: number
  totalIssues: number
  criticalIssues: number
  filesScanned: number
  createdAt: string
}

export async function fetchRuns(project: string, limit = 50): Promise<Run[]> {
  const res = await fetch(`/api/runs?project=${encodeURIComponent(project)}&limit=${limit}`)
  if (!res.ok) throw new Error(`API ${res.status}`)
  const data = await res.json() as { runs: Run[] }
  return data.runs
}
