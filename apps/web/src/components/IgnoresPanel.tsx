import type { IgnoreEntry } from '../api.js'

export function IgnoresPanel({
  ignores,
  onRemove
}: {
  ignores: IgnoreEntry[]
  onRemove: (fingerprint: string) => void
}) {
  if (ignores.length === 0) return null

  return (
    <div className="panel">
      <h2>Ignored issues <span className="muted small">({ignores.length})</span></h2>
      <table>
        <thead>
          <tr>
            <th>Rule</th>
            <th>File</th>
            <th>Fingerprint</th>
            <th>Reason</th>
            <th>Added</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {ignores.map(ig => (
            <tr key={ig.fingerprint}>
              <td>{ig.rule ? <code>{ig.rule}</code> : <span className="muted">—</span>}</td>
              <td>
                {ig.file ? <code className="file">{ig.file}</code> : <span className="muted">—</span>}
                {ig.line !== null && ig.line !== undefined && <span className="muted">:{ig.line}</span>}
              </td>
              <td><code>{ig.fingerprint}</code></td>
              <td className="ignore-reason">{ig.reason || <span className="muted">—</span>}</td>
              <td className="muted small">{new Date(ig.createdAt).toLocaleDateString()}</td>
              <td>
                <button className="ghost small" onClick={() => onRemove(ig.fingerprint)}>Unignore</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
