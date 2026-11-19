import type { Issue } from '../types.js'

/** Strong signals that the code under test is (or talks to) an LLM. Deliberately avoids bare "prompt" (Playwright dialogs). */
export const LLM_SIGNAL = /\b(openai|anthropic|claude|gpt-?\d|gemini|llama|mistral|langchain|llamaindex|llm|chatbot|copilot|completions?|embeddings?)\b|system[_ ]prompt/i
export const TOOL_SIGNAL = /\b(tool_use|tool_calls?|function_call|tools\/call|mcp|agent(ic)?|function[-_ ]calling)\b/i

const LLM_OUTPUT_SUBJECT = /(content|text|answer|completion|message|output|reply|response\.?body|result)/i
const EXACT_LLM_STRING = /expect\(([^)]*)\)\s*\.(toBe|toEqual|toStrictEqual)\(\s*(['"`])((?:(?!\3).){20,})\3/
const KARATE_EXACT = /\bmatch\s+(\S*(content|text|answer|completion|message|output|reply)\S*)\s*==\s*(['"])((?:(?!\3).){20,})\3/i
const WEAK_SCORE = /expect\(([^)]*(score|accuracy|similarity|f1|rouge|bleu)[^)]*)\)\s*\.(toBeGreaterThan\(\s*0\s*\)|toBeDefined\(\s*\)|toBeTruthy\(\s*\)|toBeLessThanOrEqual\(\s*1\s*\))/i

export function scanAiApp(source: string): Issue[] {
  if (!LLM_SIGNAL.test(source)) return []
  const issues: Issue[] = []
  const lines = source.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const exact = EXACT_LLM_STRING.exec(line)
    const karate = KARATE_EXACT.exec(line)
    if ((exact && LLM_OUTPUT_SUBJECT.test(exact[1])) || karate) {
      issues.push({
        rule: 'nondeterministic-exact-match',
        severity: 'warning',
        message: 'Exact string match on LLM output — flaky by nature, breaks on any rephrasing',
        line: i + 1,
        category: 'ai-app',
        suggestion: 'Assert structure/properties (JSON schema, required facts, regex, semantic similarity) or pin temperature=0 and mock the model'
      })
    }
    if (WEAK_SCORE.test(line)) {
      issues.push({
        rule: 'eval-without-baseline',
        severity: 'warning',
        message: 'Eval score is only checked for existence / > 0 — no baseline, so quality regressions pass',
        line: i + 1,
        category: 'ai-app',
        suggestion: 'Compare against a recorded baseline or a minimum threshold (e.g. expect(score).toBeGreaterThanOrEqual(baseline - tolerance))'
      })
    }
  }
  return issues
}
