import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'path'
import { corpus, repoRoot, rulesByFile } from './helpers.js'
import { analyzeDirectory } from '../../src/analyzer.js'

const has = (s: Set<string> | undefined, ...rules: string[]) => rules.forEach(r => assert.ok(s?.has(r), `expected ${r}, got ${[...(s ?? [])].join(', ')}`))
const lacks = (s: Set<string> | undefined, ...rules: string[]) => rules.forEach(r => assert.ok(!s?.has(r), `did not expect ${r}`))

test('ai-slop fixtures: the bad file triggers every slop rule, the good file triggers none of them', async () => {
  const m = await rulesByFile(path.join(corpus, 'ai-slop'))
  has(m.get('bad.spec.ts'), 'tautological-assertion', 'weak-assertion-only', 'swallowed-error', 'snapshot-only', 'commented-out-assertion', 'name-body-mismatch', 'copy-paste-variant')
  has(m.get('bad-api.spec.ts'), 'happy-path-only')
  lacks(m.get('good.spec.ts'), 'tautological-assertion', 'weak-assertion-only', 'swallowed-error', 'snapshot-only', 'commented-out-assertion',
    'name-body-mismatch', 'copy-paste-variant', 'no-assertion', 'happy-path-only', 'status-only-success', 'vacuous-loop-assertion')
})

test('security-hygiene fixtures', async () => {
  const m = await rulesByFile(path.join(corpus, 'security-hygiene'))
  has(m.get('bad.spec.ts'), 'hardcoded-secret', 'tls-verification-disabled', 'insecure-http', 'secret-in-test-output', 'real-looking-pii')
  const good = m.get('good.spec.ts')
  lacks(good, 'hardcoded-secret', 'tls-verification-disabled', 'insecure-http', 'secret-in-test-output', 'real-looking-pii')
})

test('AI-app fixtures', async () => {
  const m = await rulesByFile(path.join(corpus, 'ai-app'))
  has(m.get('chat.spec.ts'), 'nondeterministic-exact-match', 'eval-without-baseline')
})

test('examples/ keeps producing the expected framework findings', async () => {
  const m = await rulesByFile(path.join(repoRoot, 'examples'))
  has(m.get('bad-patterns.spec.ts'), 'no-assertion', 'no-hard-wait', 'missing-await')
  has(m.get('api.feature'), 'karate-no-assertion', 'karate-unchecked-http-call', 'karate-generic-scenario-name')
  has(m.get('cucumber/login.feature'), 'karate-duplicate-scenario', 'karate-empty-scenario')
})

test('.testpulse/ignores.json suppresses by fingerprint and reports stale entries', async () => {
  const dir = path.join(repoRoot, 'examples')
  const all = await analyzeDirectory(dir, { skipIgnores: true })
  const filtered = await analyzeDirectory(dir, { skipIgnores: false })
  const total = (o: typeof all) => o.results.reduce((n, r) => n + r.issues.length, 0)
  assert.ok(total(filtered) < total(all), 'at least one issue is suppressed by the repo ignore file')
  assert.ok(filtered.suppressed >= 1)
  assert.ok(filtered.staleIgnoreFingerprints.includes('deadbeefdead'), 'the intentionally stale fingerprint is reported')
})

test('fingerprints are stable across line moves and change with the flagged code', async () => {
  const { fingerprintFor } = await import('../../src/utils/fingerprint.js')
  const a = fingerprintFor('no-assertion', 'a/b.spec.ts', "  test('x', async () => {")
  assert.equal(a, fingerprintFor('no-assertion', 'a/b.spec.ts', "test('x',   async () => {"), 'whitespace is normalised')
  assert.notEqual(a, fingerprintFor('no-assertion', 'a/b.spec.ts', "test('y', async () => {"))
  assert.notEqual(a, fingerprintFor('other-rule', 'a/b.spec.ts', "test('x', async () => {"))
  assert.match(a, /^[0-9a-f]{12}$/)
})
