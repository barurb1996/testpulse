import { useState } from 'react'

export function LoginGate({ onLogin }: { onLogin: (password: string, mfaCode?: string) => void }) {
  const [pw, setPw] = useState('')
  const [mfaCode, setMfaCode] = useState('')
  const [mfaRequired, setMfaRequired] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const headers: Record<string, string> = { 'x-admin-password': pw }
      const res = await fetch('/api/admin/auth-check', { headers })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        setError(body.error ?? 'Authentication failed')
        setSubmitting(false)
        return
      }
      const data = await res.json() as { mfaRequired?: boolean }
      if (data.mfaRequired && !mfaCode) {
        setMfaRequired(true)
        setSubmitting(false)
        return
      }
      if (data.mfaRequired) {
        const verifyRes = await fetch('/api/admin/mfa/verify-login', {
          method: 'POST',
          headers: { 'x-admin-password': pw, 'content-type': 'application/json' },
          body: JSON.stringify({ code: mfaCode })
        })
        if (!verifyRes.ok) {
          setError('Invalid MFA code')
          setSubmitting(false)
          return
        }
      }
      onLogin(pw, mfaCode || undefined)
    } catch (err) {
      setError(String(err))
      setSubmitting(false)
    }
  }

  return (
    <div className="container">
      <div className="panel login-panel">
        <h1>Test<span className="accent">pulse</span></h1>
        <p className="muted">Dashboard access requires admin password{mfaRequired ? ' and MFA code' : ''}.</p>
        <form onSubmit={submit}>
          <input
            type="password"
            className="project"
            style={{ width: '100%', marginBottom: 12 }}
            placeholder="Admin password"
            value={pw}
            onChange={e => { setPw(e.target.value); setError(null) }}
            autoFocus
            disabled={mfaRequired}
          />
          {mfaRequired && (
            <input
              type="text"
              className="project"
              style={{ width: '100%', marginBottom: 12, letterSpacing: 4, textAlign: 'center', fontSize: 18 }}
              placeholder="6-digit code"
              value={mfaCode}
              onChange={e => { setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setError(null) }}
              maxLength={6}
              autoFocus
            />
          )}
          {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}
          <button type="submit" className="primary" style={{ width: '100%' }} disabled={submitting}>
            {submitting ? 'Signing in…' : mfaRequired ? 'Verify MFA' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
