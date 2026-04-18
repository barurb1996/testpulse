import { useEffect, useState } from 'react'
import { fetchProjectDocs, deleteProjectDoc, type ProjectDoc } from '../api.js'

export function DocsPanel({ project }: { project: string }) {
  const [docs, setDocs] = useState<ProjectDoc[]>([])

  useEffect(() => {
    if (!project) return
    fetchProjectDocs(project).then(setDocs).catch(() => {})
  }, [project])

  async function remove(id: string) {
    await deleteProjectDoc(project, id)
    setDocs(prev => prev.filter(d => d.id !== id))
  }

  return (
    <div className="panel">
      <h2>Ingested documents <span className="muted small">({docs.length})</span></h2>
      {docs.length === 0 ? (
        <div className="empty" style={{ padding: 16 }}>
          <p className="muted">
            No documents ingested yet. Upload business requirements, specs, or architecture docs
            to enrich gap analysis with domain context:
          </p>
          <pre className="command">testpulse ingest-docs ./docs --push http://your-api --project {project}</pre>
          <p className="muted small">
            Supported: <code>.txt</code>, <code>.md</code>, <code>.docx</code>. Documents are chunked and
            matched to endpoints by keyword overlap when Claude runs gap analysis.
          </p>
        </div>
      ) : (
        <table>
          <thead>
            <tr><th>File</th><th className="num">Size</th><th>Source</th><th>Added</th><th></th></tr>
          </thead>
          <tbody>
            {docs.map(d => (
              <tr key={d.id}>
                <td><code>{d.filename}</code></td>
                <td className="num muted">{(d.charCount / 1000).toFixed(1)}k chars</td>
                <td className="muted small">{d.source}</td>
                <td className="muted small">{new Date(d.createdAt).toLocaleDateString()}</td>
                <td><button className="ghost small" onClick={() => remove(d.id)} style={{ color: 'var(--bad)' }}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
