const KEY = 'tp-session'

/** The session token lives in sessionStorage only: cleared when the tab closes, never persisted to disk. */
export function getSessionToken(): string | null {
  try { return sessionStorage.getItem(KEY) } catch { return null }
}

export function setSessionToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(KEY, token)
    else sessionStorage.removeItem(KEY)
  } catch { /* storage unavailable: the user simply has to log in again */ }
}

/** Remove the old plaintext password an earlier version kept in localStorage. */
export function purgeLegacyCredentials(): void {
  try {
    localStorage.removeItem('tp-admin-pw')
    sessionStorage.removeItem('tp-admin-mfa')
  } catch { /* ignore */ }
}

export const AUTH_EXPIRED_EVENT = 'tp-auth-expired'

/** Attach the session token to same-origin /api calls and surface expired sessions to the UI. */
export function installAuthFetch(): void {
  const original = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
    if (!url.startsWith('/api/')) return original(input, init)

    const token = getSessionToken()
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    if (token && !headers.has('authorization')) headers.set('authorization', `Bearer ${token}`)
    const res = await original(input, { ...init, headers })
    if (res.status === 401 && !url.startsWith('/api/admin/login') && !url.startsWith('/api/admin/session')) {
      setSessionToken(null)
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT))
    }
    return res
  }
}

export interface LoginResult { ok: boolean; mfaRequired?: boolean; error?: string }

export async function login(password: string, code?: string): Promise<LoginResult> {
  const res = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password, code: code || undefined })
  })
  const data = await res.json().catch(() => ({})) as { token?: string; mfaRequired?: boolean; error?: string }
  if (res.ok && data.token) { setSessionToken(data.token); return { ok: true } }
  if (res.status === 401 && data.mfaRequired) return { ok: false, mfaRequired: true }
  if (res.status === 429) return { ok: false, error: 'Too many failed attempts — try again in a few minutes.' }
  return { ok: false, error: data.error ?? 'Login failed' }
}

export async function logout(): Promise<void> {
  try { await fetch('/api/admin/logout', { method: 'POST' }) } catch { /* ignore */ }
  setSessionToken(null)
}

export interface SessionState { configured: boolean; authenticated: boolean }

export async function checkSession(): Promise<SessionState> {
  try {
    const res = await fetch('/api/admin/session')
    if (!res.ok) return { configured: false, authenticated: false }
    return await res.json() as SessionState
  } catch {
    return { configured: false, authenticated: false }
  }
}
