import type { Run } from '../api.js'

function scoreClass(s: number) {
  if (s >= 80) return 'score high'
  if (s >= 50) return 'score med'
  return 'score low'
}

export function RunList({
  runs,
  selectedId,
  onSelect
}: {
  runs: Run[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <div className="panel">
      <h2>Recent runs <span className="muted small">(click a row for details)</span></h2>
      {runs.length === 0 ? (
        <div className="empty">No runs for this project yet.</div>
      ) : (
        <table className="clickable">
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
              <tr
                key={r.id}
                className={r.id === selectedId ? 'selected' : ''}
                onClick={() => onSelect(r.id)}
              >
                <td>{new Date(r.createdAt).toLocaleString()}</td>
                <td>{r.branch ?? <span className="muted">—</span>}</td>
                <td>{r.commitSha ? <code>{r.commitSha.slice(0, 7)}</code> : <span className="muted">—</span>}</td>
                <td>{r.filesScanned}</td>
                <td>{r.totalIssues}</td>
                <td>{r.criticalIssues > 0 ? <span className="badge critical">{r.criticalIssues}</span> : 0}</td>
                <td className={scoreClass(r.score)}>{r.score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
