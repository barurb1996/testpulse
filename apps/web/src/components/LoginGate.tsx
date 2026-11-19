import { useState } from 'react'
import { login } from '../auth.js'

export function LoginGate({ onLogin, configured = true }: { onLogin: () => void; configured?: boolean }) {
  const [pw, setPw] = useState('')
  const [mfaCode, setMfaCode] = useState('')
  const [mfaRequired, setMfaRequired] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const result = await login(pw, mfaRequired ? mfaCode : undefined)
    setSubmitting(false)
    if (result.ok) { setPw(''); setMfaCode(''); onLogin(); return }
    if (result.mfaRequired) { setMfaRequired(true); return }
    setError(result.error ?? 'Login failed')
    if (mfaRequired) setMfaCode('')
  }

  return (
    <div className="container">
      <div className="panel login-panel">
        <h1>Test<span className="accent">pulse</span></h1>
        {!configured && <div className="error">This server has no ADMIN_PASSWORD configured, so the API refuses all requests. Set it and restart.</div>}
        <p className="muted">Dashboard access requires the admin password{mfaRequired ? ' and your authenticator code' : ''}.</p>
        <form onSubmit={submit}>
          <input
            type="password"
            className="project"
            style={{ width: '100%', marginBottom: 12 }}
            placeholder="Admin password"
            autoComplete="current-password"
            value={pw}
            onChange={e => { setPw(e.target.value); setError(null) }}
            autoFocus
            disabled={mfaRequired}
          />
          {mfaRequired && (
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
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
          <button type="submit" className="primary" style={{ width: '100%' }} disabled={submitting || !pw}>
            {submitting ? 'Signing in…' : mfaRequired ? 'Verify' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
