import { useEffect, useState } from 'react'
import { fetchDigest, sendDigestToSlack, type DigestReport } from '../api.js'

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`
}

export function DigestPanel({ project }: { project: string }) {
  const [open, setOpen] = useState(false)
  const [days, setDays] = useState(7)
  const [digest, setDigest] = useState<DigestReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !project) return
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchDigest(project, days)
      .then(d => { if (!cancelled) setDigest(d) })
      .catch(e => { if (!cancelled) setError(String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, project, days])

  async function send() {
    setSending(true)
    setMessage(null)
    setError(null)
    try {
      const res = await sendDigestToSlack(project, days)
      if (res.error) setError(res.error)
      else setMessage('Digest delivered to Slack.')
    } catch (e) {
      setError(String(e))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="panel">
      <div className="gap-advanced-toggle">
        <button className="ghost small" onClick={() => setOpen(!open)}>
          {open ? '▾' : '▸'} Weekly digest
        </button>
      </div>
      {open && (
        <div className="gap-advanced">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className="muted small">Window:</span>
            {[1, 7, 14, 30].map(d => (
              <button
                key={d}
                className={`tab ${d === days ? 'active' : ''}`}
                style={{ padding: '4px 10px', fontSize: 12 }}
                onClick={() => setDays(d)}
              >{d}d</button>
            ))}
            <button className="primary" onClick={send} disabled={sending} style={{ marginLeft: 'auto' }}>
              {sending ? 'Sending…' : 'Send to Slack'}
            </button>
          </div>

          {loading && <div className="empty">Loading…</div>}
          {error && <div className="error">{error}</div>}
          {message && <div className="muted small">{message}</div>}

          {digest && !loading && (
            <div className="digest-body">
              {digest.runsInWindow === 0 ? (
                <div className="muted">No runs in this window.</div>
              ) : (
                <>
                  <div className="digest-summary muted small">
                    {digest.runsInWindow} run{digest.runsInWindow !== 1 ? 's' : ''}
                    {digest.scoreRange && (
                      <> · score range <strong>{digest.scoreRange.min}–{digest.scoreRange.max}</strong> (latest {digest.scoreRange.latest})</>
                    )}
                    {' · '}{digest.totalCriticals} criticals
                    {' · '}{digest.newSuggestionCount} new gap suggestion{digest.newSuggestionCount !== 1 ? 's' : ''}
                  </div>

                  {digest.flakyTop.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <div className="muted small" style={{ marginBottom: 4 }}><strong>Top flaky</strong></div>
                      <ul className="digest-list">
                        {digest.flakyTop.map((f, i) => (
                          <li key={i}>{f.name} — <span className="muted small">{f.passRate}% pass · {f.appearances} runs</span></li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {digest.slowestTop.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <div className="muted small" style={{ marginBottom: 4 }}><strong>Slowest</strong></div>
                      <ul className="digest-list">
                        {digest.slowestTop.map((s, i) => (
                          <li key={i}>{s.name} — <span className="muted small">{formatDuration(s.avgMs)} avg</span></li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
