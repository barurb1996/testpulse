import { useState } from 'react'

export function LoginGate({ onLogin }: { onLogin: (password: string) => void }) {
  const [pw, setPw] = useState('')
  const [error, setError] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    try {
      const res = await fetch('/api/admin/auth-check', { headers: { 'x-admin-password': pw } })
      if (res.ok) {
        onLogin(pw)
      } else {
        setError(true)
      }
    } catch {
      setError(true)
    }
  }

  return (
    <div className="container">
      <div className="panel login-panel">
        <h1>Test<span className="accent">pulse</span></h1>
        <p className="muted">Dashboard access requires admin password.</p>
        <form onSubmit={submit}>
          <input
            type="password"
            className="project"
            style={{ width: '100%', marginBottom: 12 }}
            placeholder="Admin password"
            value={pw}
            onChange={e => { setPw(e.target.value); setError(false) }}
            autoFocus
          />
          {error && <div className="error" style={{ marginBottom: 12 }}>Invalid password.</div>}
          <button type="submit" className="primary" style={{ width: '100%' }}>Sign in</button>
        </form>
      </div>
    </div>
  )
}
