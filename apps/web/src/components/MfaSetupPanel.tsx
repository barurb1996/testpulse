import { useEffect, useState } from 'react'

export function MfaSetupPanel() {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [qrPng, setQrPng] = useState<string | null>(null)
  const [otpUri, setOtpUri] = useState<string | null>(null)
  const [verifyCode, setVerifyCode] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function baseHeaders(): Record<string, string> {
    return { 'content-type': 'application/json' }
  }

  async function loadStatus() {
    const res = await fetch('/api/admin/mfa/status')
    if (res.ok) {
      const d = await res.json() as { enabled: boolean }
      setEnabled(d.enabled)
    }
  }

  useEffect(() => { loadStatus() }, [])

  async function setup() {
    setBusy(true); setError(null); setMessage(null); setQrPng(null); setOtpUri(null)
    const res = await fetch('/api/admin/mfa/setup', { method: 'POST', headers: baseHeaders() })
    if (!res.ok) {
      const b = await res.json().catch(() => ({})) as { error?: string }
      setError(b.error ?? 'Setup failed')
    } else {
      const d = await res.json() as { qrPng: string; otpUri: string }
      setQrPng(d.qrPng)
      setOtpUri(d.otpUri)
      setMessage('Scan the QR in Google Authenticator / Authy, then enter a 6-digit code below to activate.')
    }
    setBusy(false)
  }

  async function enable() {
    if (verifyCode.length !== 6) { setError('Enter 6-digit code'); return }
    setBusy(true); setError(null); setMessage(null)
    const res = await fetch('/api/admin/mfa/enable', {
      method: 'POST',
      headers: baseHeaders(),
      body: JSON.stringify({ code: verifyCode })
    })
    if (!res.ok) {
      const b = await res.json().catch(() => ({})) as { error?: string }
      setError(b.error ?? 'Verification failed')
    } else {
      setMessage('MFA enabled. You will need this code on every future login.')
      setQrPng(null); setOtpUri(null); setVerifyCode('')
      await loadStatus()
    }
    setBusy(false)
  }

  async function disable() {
    const code = prompt('Enter current MFA code to disable:')
    if (!code) return
    setBusy(true); setError(null); setMessage(null)
    const res = await fetch('/api/admin/mfa/disable', {
      method: 'POST',
      headers: baseHeaders(),
      body: JSON.stringify({ code })
    })
    if (!res.ok) {
      const b = await res.json().catch(() => ({})) as { error?: string }
      setError(b.error ?? 'Disable failed')
    } else {
      setMessage('MFA disabled.')
      await loadStatus()
    }
    setBusy(false)
  }

  return (
    <div className="panel">
      <h2>Multi-factor authentication</h2>
      <p className="muted small">
        Time-based one-time password (TOTP) — works with Google Authenticator, Authy, 1Password, Microsoft Authenticator.
      </p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
        <strong>Status:</strong>
        {enabled === null ? <span className="muted">…</span>
          : enabled ? <span className="score high">Enabled</span>
          : <span className="muted">Disabled</span>}
        {!enabled && <button className="primary" onClick={setup} disabled={busy}>Set up MFA</button>}
        {enabled && <button className="ghost" onClick={disable} disabled={busy} style={{ color: 'var(--bad)' }}>Disable MFA</button>}
      </div>

      {qrPng && (
        <div className="mfa-setup">
          <img src={qrPng} alt="MFA QR code" style={{ display: 'block', margin: '8px 0', borderRadius: 6 }} />
          <details style={{ marginBottom: 12 }}>
            <summary className="muted small">Can't scan? Show manual entry URI</summary>
            <code className="token-display">{otpUri}</code>
          </details>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              className="project"
              style={{ letterSpacing: 4, textAlign: 'center', fontSize: 18, width: 160 }}
              placeholder="000000"
              value={verifyCode}
              onChange={e => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              maxLength={6}
            />
            <button className="primary" onClick={enable} disabled={busy || verifyCode.length !== 6}>
              Activate
            </button>
          </div>
        </div>
      )}

      {message && <div className="muted small" style={{ marginTop: 8 }}>{message}</div>}
      {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}
    </div>
  )
}
