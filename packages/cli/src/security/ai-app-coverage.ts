import { readdir, readFile } from 'fs/promises'
import path from 'path'
import { LLM_SIGNAL, TOOL_SIGNAL } from '../rules/ai-app.js'

export interface AiAppGap {
  check: string
  owasp: string
  severity: 'critical' | 'warning'
  detail: string
}

export interface AiAppReport {
  llmApp: boolean
  agentic: boolean
  filesScanned: number
  gaps: AiAppGap[]
  covered: string[]
}

const TEST_FILE = /\.(spec|test)\.[tj]sx?$|\.feature$|(Test|Tests|Steps)\.java$|test_.*\.py$|.*_test\.py$/
const SKIP_DIR = /(^|\/)(node_modules|dist|\.git|build|target)(\/|$)/

interface Probe {
  check: string
  owasp: string
  severity: 'critical' | 'warning'
  needs: 'llm' | 'tools'
  pattern: RegExp
  detail: string
}

const PROBES: Probe[] = [
  {
    check: 'missing-prompt-injection-test', owasp: 'LLM01', severity: 'critical', needs: 'llm',
    pattern: /ignore\s+(all\s+)?(the\s+)?(previous|prior|above)\s+instructions|prompt[-\s]?injection|jailbreak|disregard\s+(your|the)\s+(rules|instructions)|you\s+are\s+now\s+(dan|in\s+developer)/i,
    detail: 'No test feeds adversarial instructions ("ignore previous instructions", indirect injection via documents/web content) and asserts the app does not comply'
  },
  {
    check: 'missing-system-prompt-leak-test', owasp: 'LLM07', severity: 'warning', needs: 'llm',
    pattern: /(reveal|repeat|print|show|leak|disclose)[^\n]{0,40}(system\s+prompt|your\s+instructions|initial\s+instructions|above\s+text)|system[-_\s]?prompt[-_\s]?(leak|disclosure|extraction)/i,
    detail: 'No test tries to extract the system prompt / hidden instructions and asserts they are not disclosed'
  },
  {
    check: 'missing-output-handling-test', owasp: 'LLM05', severity: 'warning', needs: 'llm',
    pattern: /<script|javascript:|onerror\s*=|sanitiz|escap(e|ing)\s+(html|output)|xss|dangerouslySetInnerHTML|sql\s*injection|;\s*drop\s+table/i,
    detail: 'No test checks that model output is sanitised before it is rendered or passed to a shell/DB/API (XSS, injection via LLM output)'
  },
  {
    check: 'missing-tool-permission-test', owasp: 'LLM06', severity: 'critical', needs: 'tools',
    pattern: /(unauthori[sz]ed|forbidden|not\s+allowed|permission|denied|least[-\s]privilege|allow-?list|confirm(ation)?\s+required)[^\n]{0,60}(tool|function|action|agent)|(tool|function|action|agent)[^\n]{0,60}(unauthori[sz]ed|forbidden|not\s+allowed|permission|denied|allow-?list)/i,
    detail: 'App exposes tools/agents but no test verifies that unauthorised or destructive tool calls are refused or need confirmation (excessive agency)'
  },
]

async function collectTestFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true })
  return entries
    .filter((e): e is string => typeof e === 'string')
    .filter(e => TEST_FILE.test(e) && !SKIP_DIR.test(e))
    .map(e => path.join(dir, e))
}

export function analyseAiAppCoverage(files: Array<{ file: string; text: string }>): AiAppReport {
  const all = files.map(f => f.text).join('\n')
  const llmApp = LLM_SIGNAL.test(all)
  const agentic = llmApp && TOOL_SIGNAL.test(all)
  const gaps: AiAppGap[] = []
  const covered: string[] = []
  if (llmApp) {
    for (const p of PROBES) {
      if (p.needs === 'tools' && !agentic) continue
      if (p.pattern.test(all)) covered.push(p.check)
      else gaps.push({ check: p.check, owasp: p.owasp, severity: p.severity, detail: p.detail })
    }
  }
  return { llmApp, agentic, filesScanned: files.length, gaps, covered }
}

export async function scanAiAppCoverage(dir: string): Promise<AiAppReport> {
  const paths = await collectTestFiles(dir)
  const files = await Promise.all(paths.map(async f => ({ file: f, text: await readFile(f, 'utf-8').catch(() => '') })))
  return analyseAiAppCoverage(files)
}
