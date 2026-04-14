import { useState } from 'react'
import { updateProject } from '../api.js'

export function ProjectSettingsPanel({ project, onSaved }: { project: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const [webhook, setWebhook] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    setMessage(null)
    setError(null)
    try {
      await updateProject(project, { slackWebhookUrl: webhook || null })
      setMessage(webhook ? 'Slack webhook saved. Regressions + criticals now ping your channel.' : 'Slack webhook removed.')
      setWebhook('')
      onSaved()
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="panel">
      <div className="gap-advanced-toggle">
        <button className="ghost small" onClick={() => setOpen(!open)}>
          {open ? '▾' : '▸'} Project settings
        </button>
      </div>
      {open && (
        <div className="gap-advanced">
          <div className="field">
            <span className="field-label">Slack webhook URL — fires on runs with new regressions or critical issues</span>
            <input
              type="url"
              className="project"
              style={{ width: '100%' }}
              value={webhook}
              placeholder="https://hooks.slack.com/services/…  (leave blank to clear)"
              onChange={e => setWebhook(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="primary" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save webhook'}
            </button>
            {message && <span className="muted small">{message}</span>}
            {error && <span className="error" style={{ padding: 0 }}>{error}</span>}
          </div>
        </div>
      )}
    </div>
  )
}
