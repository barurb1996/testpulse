import { spawn } from 'child_process'

export interface McpTool {
  name: string
  description?: string
  inputSchema?: { properties?: Record<string, { type?: string; enum?: unknown[]; pattern?: string; maxLength?: number; description?: string }> }
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean }
}

export interface McpFinding {
  tool: string
  check: 'tool-poisoning' | 'hidden-characters' | 'excessive-permissions' | 'unconstrained-input' | 'missing-annotations' | 'no-contract-test'
  severity: 'critical' | 'warning' | 'info'
  detail: string
}

// ── analysis ────────────────────────────────────────────────────────────────

const POISON_PATTERNS: Array<{ re: RegExp; why: string }> = [
  { re: /<\s*(important|system|instructions?|secret)\s*>/i, why: 'hidden instruction block in description' },
  { re: /ignore\s+(all\s+)?(the\s+)?(previous|prior|above)\s+instructions|disregard\s+(the\s+)?(user|previous)/i, why: 'tries to override the agent\'s instructions' },
  { re: /(do\s+not|don'?t|never)\s+(tell|mention|inform|reveal|show)[^.]{0,40}\buser\b/i, why: 'asks the agent to hide actions from the user' },
  { re: /(read|cat|open|access|send|upload|include)[^.]{0,60}(~\/\.ssh|id_rsa|\.env\b|credentials|api[_-]?key|passwd|\/etc\/)/i, why: 'directs the agent to sensitive files or secrets' },
  { re: /(before|after|when)\s+(using|calling|running)\s+(this|any|every|other)\s+tool/i, why: 'tries to shape how other tools are used' },
  { re: /\b(instead\s+of|rather\s+than|replace)\s+(using\s+)?(the\s+)?[`'"]?[a-z_][\w-]{2,}[`'"]?\s+tool/i, why: 'redirects calls away from another tool (shadowing)' },
  { re: /[A-Za-z0-9+/]{120,}={0,2}/, why: 'long base64-like blob in description' },
]

// zero-width, bidi controls and Unicode "tag" characters used to smuggle invisible text
const HIDDEN_CHARS = /[​-‏‪-‮⁠-⁤\u{E0000}-\u{E007F}]/u

const DANGEROUS_NAME = /(exec|shell|bash|run[_-]?command|eval|sql|query|delete|drop|remove|write[_-]?file|chmod|kill|sudo)/i
const FREEFORM_PARAM = /^(command|cmd|script|code|sql|query|path|file(path|name)?|url|expression)$/i

export function analyseTools(tools: McpTool[], testedText?: string): McpFinding[] {
  const out: McpFinding[] = []
  for (const t of tools) {
    const texts = [t.description ?? '', ...Object.values(t.inputSchema?.properties ?? {}).map(p => p.description ?? '')]
    const blob = texts.join('\n')

    const reasons = POISON_PATTERNS.filter(p => p.re.test(blob)).map(p => p.why)
    if (reasons.length > 0) {
      out.push({ tool: t.name, check: 'tool-poisoning', severity: 'critical', detail: `Description ${reasons.join('; ')}` })
    }
    if (HIDDEN_CHARS.test(blob) || HIDDEN_CHARS.test(t.name)) {
      out.push({ tool: t.name, check: 'hidden-characters', severity: 'critical', detail: 'Contains invisible Unicode (zero-width / bidi / tag characters) — text a human reviewer cannot see' })
    }

    const risky = DANGEROUS_NAME.test(t.name) || /\b(execute|arbitrary|any\s+command|any\s+file|delete|overwrite)\b/i.test(t.description ?? '')
    if (risky) {
      const readOnly = t.annotations?.readOnlyHint === true
      if (!readOnly) out.push({ tool: t.name, check: 'excessive-permissions', severity: 'warning', detail: 'Powerful capability (exec / filesystem / SQL / delete) exposed to the model — confirm it is scoped and gated by user approval' })
    }

    for (const [param, def] of Object.entries(t.inputSchema?.properties ?? {})) {
      if (FREEFORM_PARAM.test(param) && def.type === 'string' && !def.enum && !def.pattern && def.maxLength === undefined) {
        out.push({ tool: t.name, check: 'unconstrained-input', severity: 'warning', detail: `Parameter "${param}" is a free-form string with no enum/pattern/maxLength — injection / traversal surface` })
      }
    }

    if (risky && t.annotations?.destructiveHint === undefined && t.annotations?.readOnlyHint === undefined) {
      out.push({ tool: t.name, check: 'missing-annotations', severity: 'info', detail: 'No readOnlyHint / destructiveHint — clients cannot warn the user before calling it' })
    }

    if (testedText !== undefined && !new RegExp(`\\b${t.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(testedText)) {
      out.push({ tool: t.name, check: 'no-contract-test', severity: 'warning', detail: 'Tool name does not appear in any test — no contract/behaviour test covers it' })
    }
  }
  return out
}

// ── transports ──────────────────────────────────────────────────────────────

const PROTOCOL = '2025-03-26'
const initMsg = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'testpulse-audit', version: '0.1.0' } } }

export async function listToolsStdio(command: string, args: string[], timeoutMs = 20_000): Promise<McpTool[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'ignore'], shell: false })
    let buf = ''
    let done = false
    const finish = (err: Error | null, tools?: McpTool[]) => {
      if (done) return
      done = true
      clearTimeout(timer)
      child.kill()
      err ? reject(err) : resolve(tools ?? [])
    }
    const timer = setTimeout(() => finish(new Error(`MCP server did not respond within ${timeoutMs / 1000}s`)), timeoutMs)
    const send = (m: unknown) => child.stdin.write(JSON.stringify(m) + '\n')
    child.on('error', e => finish(e))
    child.on('exit', code => finish(new Error(`MCP server exited early (code ${code})`)))
    child.stdout.on('data', chunk => {
      buf += chunk.toString()
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line) continue
        let msg: { id?: number; result?: { tools?: McpTool[] }; error?: { message: string } }
        try { msg = JSON.parse(line) } catch { continue }
        if (msg.id === 1) {
          send({ jsonrpc: '2.0', method: 'notifications/initialized' })
          send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
        } else if (msg.id === 2) {
          msg.error ? finish(new Error(msg.error.message)) : finish(null, msg.result?.tools ?? [])
        }
      }
    })
    send(initMsg)
  })
}

async function rpcHttp(url: string, body: unknown, session?: string): Promise<{ json: any; session?: string }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(session ? { 'mcp-session-id': session } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000)
  })
  if (!res.ok) throw new Error(`MCP HTTP ${res.status}`)
  const text = await res.text()
  const dataLine = res.headers.get('content-type')?.includes('text/event-stream')
    ? text.split('\n').find(l => l.startsWith('data:'))?.slice(5).trim()
    : text
  return { json: dataLine ? JSON.parse(dataLine) : null, session: res.headers.get('mcp-session-id') ?? session }
}

export async function listToolsHttp(url: string): Promise<McpTool[]> {
  const init = await rpcHttp(url, initMsg)
  await rpcHttp(url, { jsonrpc: '2.0', method: 'notifications/initialized' }, init.session).catch(() => undefined)
  const list = await rpcHttp(url, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, init.session)
  if (list.json?.error) throw new Error(list.json.error.message)
  return list.json?.result?.tools ?? []
}
