const DEFAULT_HOSTS = ['hooks.slack.com', 'hooks.slack-gov.com']

function allowedHosts(): string[] {
  const extra = (process.env.WEBHOOK_ALLOWED_HOSTS ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  return [...DEFAULT_HOSTS, ...extra]
}

/** Outbound webhooks may only target an allow-listed https host (prevents SSRF and data exfiltration to arbitrary URLs). */
export function isAllowedWebhookUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' && !u.username && !u.password && allowedHosts().includes(u.hostname.toLowerCase())
  } catch {
    return false
  }
}

export async function postWebhook(url: string, body: unknown): Promise<Response> {
  if (!isAllowedWebhookUrl(url)) throw new Error('webhook host is not allowed')
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    redirect: 'error', // a redirect could bounce the payload to an arbitrary host
    signal: AbortSignal.timeout(10_000)
  })
}
