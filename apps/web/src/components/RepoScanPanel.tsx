import { useEffect, useState } from 'react'

interface RepoConfig {
  repoUrl: string | null
  hasToken: boolean
  repoBranch: string
  testPath: string
  appCodePath: string | null
  junitPath: string | null
  lastScanAt: string | null
}

export function RepoScanPanel({ project }: { project: string }) {
  const [config, setConfig] = useState<RepoConfig | null>(null)
  const [form, setForm] = useState({
    repoUrl: '', repoToken: '', repoBranch: 'main',
    testPath: '.', appCodePath: '', junitPath: ''
  })
  const [saving, setSaving] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanLog, setScanLog] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const headers: Record<string, string> = { 'content-type': 'application/json' }

  useEffect(() => {
    if (!project) return
    fetch(`/api/projects/${project}/repo`, { headers })
      .then(r => r.json())
      .then((d: RepoConfig) => {
        setConfig(d)
        setForm(prev => ({
          ...prev,
          repoUrl: d.repoUrl ?? '',
          repoBranch: d.repoBranch ?? 'main',
          testPath: d.testPath ?? '.',
          appCodePath: d.appCodePath ?? '',
          junitPath: d.junitPath ?? ''
        }))
      })
      .catch(() => {})
  }, [project])

  async function saveConfig() {
    setSaving(true); setError(null); setMessage(null)
    try {
      const body: Record<string, string | undefined> = {
        repoUrl: form.repoUrl || undefined,
        repoBranch: form.repoBranch || undefined,
        testPath: form.testPath || undefined,
        appCodePath: form.appCodePath || undefined,
        junitPath: form.junitPath || undefined
      }
      if (form.repoToken) body.repoToken = form.repoToken
      const res = await fetch(`/api/projects/${project}/repo`, { method: 'PATCH', headers, body: JSON.stringify(body) })
      if (!res.ok) throw new Error(`${res.status}`)
      setMessage('Repo config saved.')
      setForm(prev => ({ ...prev, repoToken: '' }))
    } catch (e) { setError(String(e)) }
    finally { setSaving(false) }
  }

  async function runScan() {
    setScanning(true); setScanLog([]); setError(null); setMessage(null)
    try {
      const res = await fetch(`/api/projects/${project}/scan`, {
        method: 'POST', headers,
        body: JSON.stringify({ scanCodebase: true })
      })
      const data = await res.json() as { runId?: string; score?: number; log?: string[]; error?: string }
      if (data.log) setScanLog(data.log)
      if (data.error) setError(data.error)
      else setMessage(`Scan complete. Run ${data.runId?.slice(0, 8)} — score ${data.score}/100`)
    } catch (e) { setError(String(e)) }
    finally { setScanning(false) }
  }

  return (
    <div className="panel">
      <h2>Repository scan</h2>
      <p className="muted small">
        Connect a Git repo — testpulse clones it, scans test code + app code, extracts endpoints and business rules, computes coverage and quality in one click.
      </p>

      <div className="repo-form">
        <div className="field" style={{ margin: '8px 0' }}>
          <span className="field-label">Repo URL (HTTPS)</span>
          <input className="project" style={{ width: '100%' }} value={form.repoUrl} onChange={e => setForm(p => ({ ...p, repoUrl: e.target.value }))} placeholder="https://github.com/org/repo.git" />
        </div>
        <div className="field" style={{ margin: '8px 0' }}>
          <span className="field-label">Access token (PAT — stored encrypted, leave blank to keep existing)</span>
          <input className="project" style={{ width: '100%' }} type="password" value={form.repoToken} onChange={e => setForm(p => ({ ...p, repoToken: e.target.value }))} placeholder={config?.hasToken ? '••• (configured)' : 'ghp_... or glpat-...'} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 }}>
          <div className="field" style={{ margin: 0 }}>
            <span className="field-label">Branch</span>
            <input className="project" style={{ width: '100%' }} value={form.repoBranch} onChange={e => setForm(p => ({ ...p, repoBranch: e.target.value }))} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <span className="field-label">Test path (relative)</span>
            <input className="project" style={{ width: '100%' }} value={form.testPath} onChange={e => setForm(p => ({ ...p, testPath: e.target.value }))} placeholder="src/test" />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <span className="field-label">App code path</span>
            <input className="project" style={{ width: '100%' }} value={form.appCodePath} onChange={e => setForm(p => ({ ...p, appCodePath: e.target.value }))} placeholder="src/main" />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <span className="field-label">JUnit XML glob</span>
            <input className="project" style={{ width: '100%' }} value={form.junitPath} onChange={e => setForm(p => ({ ...p, junitPath: e.target.value }))} placeholder="target/surefire-reports/*.xml" />
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
        <button className="ghost" onClick={saveConfig} disabled={saving}>{saving ? 'Saving…' : 'Save config'}</button>
        <button className="primary" onClick={runScan} disabled={scanning || !form.repoUrl}>{scanning ? 'Scanning…' : 'Scan now'}</button>
        {config?.lastScanAt && <span className="muted small">Last scan: {new Date(config.lastScanAt).toLocaleString()}</span>}
      </div>

      {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}
      {message && <div className="muted small" style={{ marginTop: 8 }}>{message}</div>}

      {scanLog.length > 0 && (
        <pre className="command" style={{ marginTop: 12, maxHeight: 300, overflow: 'auto' }}>
          {scanLog.join('\n')}
        </pre>
      )}
    </div>
  )
}
