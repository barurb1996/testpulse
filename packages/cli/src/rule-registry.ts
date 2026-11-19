import type { IssueSeverity, RuleCategory } from './types.js'

export interface RuleMeta {
  id: string
  category: RuleCategory
  frameworks: Array<'playwright' | 'karate' | 'cucumber'>
  severity: IssueSeverity
  description: string
}

export const RULE_REGISTRY: Record<string, RuleMeta> = {
  // ── Playwright: existing ────────────────────────────────────────────────
  'no-assertion': {
    id: 'no-assertion', category: 'ai-slop', frameworks: ['playwright', 'cucumber'],
    severity: 'critical', description: 'Test block has no expect() — always passes'
  },
  'no-hard-wait': {
    id: 'no-hard-wait', category: 'ai-slop', frameworks: ['playwright'],
    severity: 'critical', description: 'page.waitForTimeout() — use auto-waiting locators'
  },
  'missing-await': {
    id: 'missing-await', category: 'ai-slop', frameworks: ['playwright', 'cucumber'],
    severity: 'critical', description: 'Async Playwright method called without await'
  },
  'no-css-selector': {
    id: 'no-css-selector', category: 'ai-slop', frameworks: ['playwright'],
    severity: 'warning', description: 'CSS selector — prefer getByRole / getByTestId'
  },
  'no-generic-name': {
    id: 'no-generic-name', category: 'ai-slop', frameworks: ['playwright'],
    severity: 'warning', description: 'Generic test name (test, foo, under 5 chars)'
  },
  'playwright-test-only': {
    id: 'playwright-test-only', category: 'ai-slop', frameworks: ['playwright'],
    severity: 'critical', description: 'test.only() left in code — skips all other tests in CI'
  },
  'playwright-conditional-in-test': {
    id: 'playwright-conditional-in-test', category: 'ai-slop', frameworks: ['playwright'],
    severity: 'warning', description: 'if/switch at top level of test — tests should be deterministic'
  },
  'playwright-hardcoded-timeout': {
    id: 'playwright-hardcoded-timeout', category: 'ai-slop', frameworks: ['playwright'],
    severity: 'warning', description: 'test.setTimeout(N > 30s) — masks flakiness'
  },

  // ── Playwright: Faza 1 — AI slop ───────────────────────────────────────
  'tautological-assertion': {
    id: 'tautological-assertion', category: 'ai-slop', frameworks: ['playwright'],
    severity: 'critical', description: 'Assertion that can never fail (expect(true).toBe(true))'
  },
  'swallowed-error': {
    id: 'swallowed-error', category: 'ai-slop', frameworks: ['playwright'],
    severity: 'critical', description: 'Empty catch block or .catch(() => {}) silences failures'
  },
  'commented-out-assertion': {
    id: 'commented-out-assertion', category: 'ai-slop', frameworks: ['playwright'],
    severity: 'warning', description: 'expect() commented out — assertion not running'
  },
  'weak-assertion-only': {
    id: 'weak-assertion-only', category: 'ai-slop', frameworks: ['playwright'],
    severity: 'warning', description: 'Only existence checks (toBeDefined, toBeTruthy) — no value verified'
  },
  'snapshot-only': {
    id: 'snapshot-only', category: 'ai-slop', frameworks: ['playwright'],
    severity: 'info', description: 'All assertions are snapshots — intent hidden, regressions silent'
  },
  'happy-path-only': {
    id: 'happy-path-only', category: 'ai-slop', frameworks: ['playwright'],
    severity: 'warning', description: 'No negative tests in file — 4xx, errors, invalid input missing'
  },
  'name-body-mismatch': {
    id: 'name-body-mismatch', category: 'ai-slop', frameworks: ['playwright'],
    severity: 'warning', description: 'Test name implies error case but body has no error assertions'
  },
  'copy-paste-variant': {
    id: 'copy-paste-variant', category: 'ai-slop', frameworks: ['playwright'],
    severity: 'warning', description: 'Multiple tests differ only in data — candidate for test.each'
  },

  // ── Karate: existing ────────────────────────────────────────────────────
  'karate-no-assertion': {
    id: 'karate-no-assertion', category: 'ai-slop', frameworks: ['karate'],
    severity: 'critical', description: 'Scenario with no Then/match/status/assert'
  },
  'karate-empty-scenario': {
    id: 'karate-empty-scenario', category: 'ai-slop', frameworks: ['karate'],
    severity: 'critical', description: 'Scenario with zero steps'
  },
  'karate-explicit-sleep': {
    id: 'karate-explicit-sleep', category: 'ai-slop', frameworks: ['karate'],
    severity: 'warning', description: 'helpers.sleep() / Thread.sleep() — use retry'
  },
  'karate-hardcoded-auth-token': {
    id: 'karate-hardcoded-auth-token', category: 'security-hygiene', frameworks: ['karate', 'cucumber'],
    severity: 'critical', description: 'Bearer JWT / API key literal in step'
  },
  'karate-hardcoded-uuid': {
    id: 'karate-hardcoded-uuid', category: 'ai-slop', frameworks: ['karate'],
    severity: 'warning', description: 'Literal UUID in step — generate per-run with karate.uuid()'
  },
  'karate-hardcoded-localhost-url': {
    id: 'karate-hardcoded-localhost-url', category: 'security-hygiene', frameworks: ['karate'],
    severity: 'warning', description: 'http://localhost in step — move to karate-config.js'
  },
  'karate-generic-scenario-name': {
    id: 'karate-generic-scenario-name', category: 'ai-slop', frameworks: ['karate', 'cucumber'],
    severity: 'warning', description: 'Generic scenario name (test, foo, under 5 chars)'
  },
  'karate-repeated-setup': {
    id: 'karate-repeated-setup', category: 'ai-slop', frameworks: ['karate'],
    severity: 'warning', description: '3+ scenarios share identical first 3 steps — use Background'
  },
  'karate-unchecked-http-call': {
    id: 'karate-unchecked-http-call', category: 'ai-slop', frameworks: ['karate'],
    severity: 'warning', description: 'HTTP method call with no subsequent status/match assertion'
  },
  'karate-duplicate-scenario': {
    id: 'karate-duplicate-scenario', category: 'ai-slop', frameworks: ['karate', 'cucumber'],
    severity: 'warning', description: 'Byte-identical step sequences — copy-paste detected'
  },
  'karate-data-variation-duplicate': {
    id: 'karate-data-variation-duplicate', category: 'ai-slop', frameworks: ['karate'],
    severity: 'warning', description: 'Same structure, different literals — use Scenario Outline'
  },
  'karate-duplicate-assertion': {
    id: 'karate-duplicate-assertion', category: 'ai-slop', frameworks: ['karate'],
    severity: 'warning', description: 'Same match repeated on the same HTTP response window'
  },
  'karate-configure-retry-in-scenario': {
    id: 'karate-configure-retry-in-scenario', category: 'ai-slop', frameworks: ['karate'],
    severity: 'warning', description: 'Ad-hoc configure retry/timeout in scenario — move to karate-config.js'
  },
  'karate-endpoint-coverage-overlap': {
    id: 'karate-endpoint-coverage-overlap', category: 'ai-slop', frameworks: ['karate'],
    severity: 'info', description: '3+ scenarios hitting the same endpoint'
  },
  'karate-print-in-test': {
    id: 'karate-print-in-test', category: 'ai-slop', frameworks: ['karate'],
    severity: 'info', description: '* print left in committed test'
  },
  'karate-excessive-retry-window': {
    id: 'karate-excessive-retry-window', category: 'ai-slop', frameworks: ['karate'],
    severity: 'warning', description: 'Retry window > 30s — masks slow or unreliable infrastructure'
  },
  'karate-retry-plus-sleep': {
    id: 'karate-retry-plus-sleep', category: 'ai-slop', frameworks: ['karate'],
    severity: 'warning', description: 'configure retry + explicit sleep — redundant and slow'
  },

  // ── Cucumber ────────────────────────────────────────────────────────────
  'cucumber-empty-step-body': {
    id: 'cucumber-empty-step-body', category: 'ai-slop', frameworks: ['cucumber'],
    severity: 'critical', description: 'Step implementation is empty — always passes'
  },
  'cucumber-console-in-step': {
    id: 'cucumber-console-in-step', category: 'ai-slop', frameworks: ['cucumber'],
    severity: 'info', description: 'console.log left in a step definition'
  },

  // ── Security hygiene (all frameworks) ───────────────────────────────────
  'hardcoded-secret': {
    id: 'hardcoded-secret', category: 'security-hygiene', frameworks: ['playwright', 'karate', 'cucumber'],
    severity: 'critical', description: 'API key / token / password literal in test code'
  },
  'tls-verification-disabled': {
    id: 'tls-verification-disabled', category: 'security-hygiene', frameworks: ['playwright', 'karate', 'cucumber'],
    severity: 'warning', description: 'TLS certificate verification turned off'
  },
  'production-target': {
    id: 'production-target', category: 'security-hygiene', frameworks: ['playwright', 'karate', 'cucumber'],
    severity: 'critical', description: 'Test references a production domain (configured in .testpulse/config.json)'
  },
  'real-looking-pii': {
    id: 'real-looking-pii', category: 'security-hygiene', frameworks: ['playwright', 'karate', 'cucumber'],
    severity: 'warning', description: 'Valid card (Luhn) / IBAN / PESEL / non-reserved e-mail in test data'
  },
  'secret-in-test-output': {
    id: 'secret-in-test-output', category: 'security-hygiene', frameworks: ['playwright', 'karate', 'cucumber'],
    severity: 'warning', description: 'Token / credential printed to test output'
  },
  'insecure-http': {
    id: 'insecure-http', category: 'security-hygiene', frameworks: ['playwright', 'karate', 'cucumber'],
    severity: 'info', description: 'Plain http:// to a non-local host'
  },

  // ── AI-app (tests of LLM-backed apps) ───────────────────────────────────
  'nondeterministic-exact-match': {
    id: 'nondeterministic-exact-match', category: 'ai-app', frameworks: ['playwright', 'karate', 'cucumber'],
    severity: 'warning', description: 'Exact string match on LLM output — flaky by nature'
  },
  'eval-without-baseline': {
    id: 'eval-without-baseline', category: 'ai-app', frameworks: ['playwright', 'karate', 'cucumber'],
    severity: 'warning', description: 'Eval score checked only for existence / > 0 — no baseline'
  },
}
