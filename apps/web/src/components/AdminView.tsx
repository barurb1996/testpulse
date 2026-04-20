import { useEffect, useState } from 'react'

interface AdminProject {
  id: string
  slug: string
  name: string
  runCount: number
  createdAt: string
}

interface Token {
  id: string
  name: string
  lastUsedAt: string | null
  createdAt: string
}

export function AdminView({ adminPassword, mfaCode }: { adminPassword: string; mfaCode?: string }) {
  const [projects, setProjects] = useState<AdminProject[]>([])
  const [error, setError] = useState<string | null>(null)
  const [newSlug, setNewSlug] = useState('')
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createdToken, setCreatedToken] = useState<string | null>(null)

  const [selectedProject, setSelectedProject] = useState<string | null>(null)
  const [tokens, setTokens] = useState<Token[]>([])
  const [newTokenName, setNewTokenName] = useState('ci')
  const [generatedToken, setGeneratedToken] = useState<string | null>(null)

  const headers: Record<string, string> = { 'x-admin-password': adminPassword, 'content-type': 'application/json' }
  if (mfaCode) headers['x-mfa-code'] = mfaCode

  async function loadProjects() {
    const res = await fetch('/api/admin/projects', { headers })
    if (!res.ok) { setError('Failed to load'); return }
    const data = await res.json() as { projects: AdminProject[] }
    setProjects(data.projects)
  }

  useEffect(() => { loadProjects() }, [])

  async function createProject() {
    if (!newSlug) return
    setCreating(true)
    setCreatedToken(null)
    const res = await fetch('/api/admin/projects', {
      method: 'POST',
      headers,
      body: JSON.stringify({ slug: newSlug, name: newName || newSlug })
    })
    const data = await res.json() as { token?: string; error?: string }
    if (!res.ok) { setError(data.error ?? 'Failed'); setCreating(false); return }
    setCreatedToken(data.token ?? null)
    setNewSlug('')
    setNewName('')
    setCreating(false)
    await loadProjects()
  }

  async function deleteProject(slug: string) {
    if (!confirm(`Delete project "${slug}" and all its data? This cannot be undone.`)) return
    await fetch(`/api/admin/projects/${slug}`, { method: 'DELETE', headers })
    if (selectedProject === slug) { setSelectedProject(null); setTokens([]) }
    await loadProjects()
  }

  async function loadTokens(slug: string) {
    setSelectedProject(slug)
    setGeneratedToken(null)
    const res = await fetch(`/api/admin/projects/${slug}/tokens`, { headers })
    if (!res.ok) return
    const data = await res.json() as { tokens: Token[] }
    setTokens(data.tokens)
  }

  async function generateNewToken() {
    if (!selectedProject) return
    setGeneratedToken(null)
    const res = await fetch(`/api/admin/projects/${selectedProject}/tokens`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: newTokenName || 'default' })
    })
    const data = await res.json() as { token?: string }
    if (data.token) setGeneratedToken(data.token)
    await loadTokens(selectedProject)
  }

  async function deleteToken(id: string) {
    await fetch(`/api/admin/tokens/${id}`, { method: 'DELETE', headers })
    if (selectedProject) await loadTokens(selectedProject)
  }

  return (
    <>
      <div className="panel">
        <h2>Projects</h2>
        {error && <div className="error">{error}</div>}
        <table>
          <thead><tr><th>Slug</th><th>Name</th><th className="num">Runs</th><th>Created</th><th></th><th></th></tr></thead>
          <tbody>
            {projects.map(p => (
              <tr key={p.slug}>
                <td><code>{p.slug}</code></td>
                <td>{p.name}</td>
                <td className="num">{p.runCount}</td>
                <td className="muted small">{new Date(p.createdAt).toLocaleDateString()}</td>
                <td><button className="ghost small" onClick={() => loadTokens(p.slug)}>Tokens</button></td>
                <td><button className="ghost small" onClick={() => deleteProject(p.slug)} style={{ color: 'var(--bad)' }}>Delete</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h2>Create project</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="field" style={{ margin: 0 }}>
            <span className="field-label">Slug (lowercase, dashes)</span>
            <input className="project" value={newSlug} onChange={e => setNewSlug(e.target.value)} placeholder="my-project" />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <span className="field-label">Display name</span>
            <input className="project" value={newName} onChange={e => setNewName(e.target.value)} placeholder="My Project" />
          </div>
          <button className="primary" onClick={createProject} disabled={creating || !newSlug}>
            {creating ? 'Creating…' : 'Create + generate token'}
          </button>
        </div>
        {createdToken && (
          <div className="gap-result" style={{ marginTop: 12 }}>
            <strong>Token (copy now — shown only once):</strong><br />
            <code className="token-display">{createdToken}</code>
          </div>
        )}
      </div>

      {selectedProject && (
        <div className="panel">
          <h2>Tokens for <code>{selectedProject}</code></h2>
          <table>
            <thead><tr><th>Name</th><th>Created</th><th>Last used</th><th></th></tr></thead>
            <tbody>
              {tokens.map(t => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td className="muted small">{new Date(t.createdAt).toLocaleDateString()}</td>
                  <td className="muted small">{t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString() : 'never'}</td>
                  <td><button className="ghost small" onClick={() => deleteToken(t.id)} style={{ color: 'var(--bad)' }}>Revoke</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
            <input className="project" value={newTokenName} onChange={e => setNewTokenName(e.target.value)} placeholder="ci" style={{ width: 140 }} />
            <button className="ghost" onClick={generateNewToken}>Generate new token</button>
          </div>
          {generatedToken && (
            <div className="gap-result" style={{ marginTop: 8 }}>
              <strong>New token (copy now):</strong><br />
              <code className="token-display">{generatedToken}</code>
            </div>
          )}
        </div>
      )}
    </>
  )
}
