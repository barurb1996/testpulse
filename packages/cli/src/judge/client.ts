import { SYSTEM_PROMPT, TOOL } from './prompt.js'

export interface Evaluation {
  test_name: string
  score: number
  verifies_stated_behavior: 'yes' | 'partly' | 'no'
  would_catch_regression: boolean
  missing_cases: string[]
  reasoning: string
  suggested_test?: string
}

export interface JudgeClientOptions {
  apiKey: string
  model: string
  baseUrl?: string
  timeoutMs?: number
}

export async function callJudge(userContent: string, opts: JudgeClientOptions): Promise<Evaluation[]> {
  const url = `${(opts.baseUrl ?? 'https://api.anthropic.com').replace(/\/$/, '')}/v1/messages`
  const body = JSON.stringify({
    model: opts.model,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    tools: [TOOL],
    tool_choice: { type: 'tool', name: TOOL.name },
    messages: [{ role: 'user', content: userContent }]
  })

  let lastErr = 'unknown error'
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 1000 * 2 ** attempt))
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': opts.apiKey, 'anthropic-version': '2023-06-01' },
        body,
        signal: controller.signal
      })
      if (res.status === 429 || res.status >= 500) { lastErr = `HTTP ${res.status}`; continue }
      if (!res.ok) {
        // never echo the request (it contains code); the API error body is safe and useful
        const text = await res.text()
        throw new Error(`Judge API error ${res.status}: ${text.slice(0, 300)}`)
      }
      const data = await res.json() as { content?: Array<{ type: string; name?: string; input?: { evaluations?: Evaluation[] } }> }
      const block = data.content?.find(c => c.type === 'tool_use' && c.name === TOOL.name)
      const evals = block?.input?.evaluations
      if (!Array.isArray(evals)) throw new Error('Judge returned no structured evaluations')
      return evals.filter(e => typeof e.test_name === 'string' && Number.isInteger(e.score) && e.score >= 1 && e.score <= 5)
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Judge')) throw err
      lastErr = err instanceof Error ? err.message : String(err)
    } finally {
      clearTimeout(timer)
    }
  }
  throw new Error(`Judge request failed after retries: ${lastErr}`)
}
