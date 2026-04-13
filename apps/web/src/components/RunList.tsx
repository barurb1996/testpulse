import type { Run } from '../api.js'

function scoreClass(s: number) {
  if (s >= 80) return 'score high'
  if (s >= 50) return 'score med'
  return 'score low'
}

export function RunList({ runs }: { runs: Run[] }) {
  return (
    <div className="panel">
      <h2>Recent runs</h2>
      {runs.length === 0 ? (
        <div className="empty">No runs for this project yet.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Branch</th>
              <th>Commit</th>
              <th>Files</th>
              <th>Issues</th>
              <th>Critical</th>
              <th>Score</th>
            </tr>
          </thead>
          <tbody>
            {runs.map(r => (
              <tr key={r.id}>
                <td>{new Date(r.createdAt).toLocaleString()}</td>
                <td>{r.branch ?? <span className="muted">—</span>}</td>
                <td>{r.commitSha ? <code>{r.commitSha.slice(0, 7)}</code> : <span className="muted">—</span>}</td>
                <td>{r.filesScanned}</td>
                <td>{r.totalIssues}</td>
                <td>{r.criticalIssues}</td>
                <td className={scoreClass(r.score)}>{r.score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
