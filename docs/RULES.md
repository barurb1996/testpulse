# Rule reference

_Generated from `packages/cli/src/rule-registry.ts` (46 rules). Do not edit by hand: run `node scripts/gen-rules-doc.mjs`._

Severity scoring: critical −10, warning −3, info −3 from a baseline of 100 (floor 0). A critical issue makes the CLI exit 1 unless `--no-exit` is passed.
Rules are heuristics and can be wrong; see [docs/VALIDATION.md](VALIDATION.md) for how they were measured and [docs/CONFIG.md](CONFIG.md) to silence or re-grade one.

## Test quality ("AI slop")

| Rule | Severity | Frameworks | What it catches |
| --- | --- | --- | --- |
| `commented-out-assertion` | ⚠ warning | playwright | expect() commented out — assertion not running |
| `copy-paste-variant` | ⚠ warning | playwright | Several tests differ only in data values: candidate for test.each |
| `cucumber-console-in-step` | ℹ info | cucumber | console.log left in a step definition |
| `cucumber-empty-step-body` | ✗ critical | cucumber | Step implementation is empty — always passes |
| `happy-path-only` | ⚠ warning | playwright | API test file where no asserted call expects a 4xx / unauthorised outcome |
| `karate-configure-retry-in-scenario` | ⚠ warning | karate | Ad-hoc configure retry/timeout in scenario — move to karate-config.js |
| `karate-data-variation-duplicate` | ⚠ warning | karate | Same structure, different literals — use Scenario Outline |
| `karate-duplicate-assertion` | ⚠ warning | karate | Same match repeated on the same HTTP response window |
| `karate-duplicate-scenario` | ⚠ warning | karate, cucumber | Byte-identical step sequences — copy-paste detected |
| `karate-empty-scenario` | ✗ critical | karate | Scenario with zero steps |
| `karate-endpoint-coverage-overlap` | ℹ info | karate | 3+ scenarios hitting the same endpoint |
| `karate-excessive-retry-window` | ⚠ warning | karate | Retry window > 30s — masks slow or unreliable infrastructure |
| `karate-explicit-sleep` | ⚠ warning | karate | helpers.sleep() / Thread.sleep() — use retry |
| `karate-generic-scenario-name` | ⚠ warning | karate, cucumber | Generic scenario name (test, foo, under 5 chars) |
| `karate-hardcoded-uuid` | ⚠ warning | karate | Literal UUID in step — generate per-run with karate.uuid() |
| `karate-no-assertion` | ✗ critical | karate | Scenario with no Then/match/status/assert |
| `karate-print-in-test` | ℹ info | karate | * print left in committed test |
| `karate-repeated-setup` | ⚠ warning | karate | 3+ scenarios share identical first 3 steps — use Background |
| `karate-retry-plus-sleep` | ⚠ warning | karate | configure retry + explicit sleep — redundant and slow |
| `karate-status-only-success` | ⚠ warning | karate | Scenario asserts only a 2xx status and never checks the response body |
| `karate-unchecked-http-call` | ⚠ warning | karate | HTTP method call with no subsequent status/match assertion |
| `missing-await` | ✗ critical | playwright, cucumber | Async Playwright method called without await |
| `name-body-mismatch` | ⚠ warning | playwright | Test name promises a failure (reject, 401, expired…) but the test asserts a 2xx response |
| `no-assertion` | ✗ critical | playwright, cucumber | Test has no assertion (warning instead of critical when it only calls helpers or page objects that might assert) |
| `no-css-selector` | ⚠ warning | playwright | CSS selector — prefer getByRole / getByTestId |
| `no-generic-name` | ⚠ warning | playwright | Generic test name (test, foo, under 5 chars) |
| `no-hard-wait` | ✗ critical | playwright | page.waitForTimeout() — use auto-waiting locators |
| `playwright-conditional-in-test` | ⚠ warning | playwright | if/switch at top level of test — tests should be deterministic |
| `playwright-hardcoded-timeout` | ⚠ warning | playwright | test.setTimeout(N > 30s) — masks flakiness |
| `playwright-test-only` | ✗ critical | playwright | test.only() left in code — skips all other tests in CI |
| `snapshot-only` | ℹ info | playwright | All assertions are snapshots — intent hidden, regressions silent |
| `status-only-success` | ⚠ warning | playwright | API test asserts only a 2xx status — returned/changed data never verified |
| `swallowed-error` | ✗ critical | playwright | Empty catch block or .catch(() => {}) silences failures |
| `tautological-assertion` | ✗ critical | playwright | Assertion that can never fail (expect(true).toBe(true)) |
| `vacuous-loop-assertion` | ⚠ warning | playwright | Assertions inside a loop over a list never checked for emptiness |
| `weak-assertion-only` | ⚠ warning | playwright | Only toBeDefined / toBeTruthy assertions: nothing about the value is verified |

## Security hygiene in test code

| Rule | Severity | Frameworks | What it catches |
| --- | --- | --- | --- |
| `hardcoded-secret` | ✗ critical | playwright, karate, cucumber | API key / token / password literal in test code |
| `insecure-http` | ℹ info | playwright, karate, cucumber | Plain http:// to a non-local host |
| `karate-hardcoded-auth-token` | ✗ critical | karate, cucumber | Bearer JWT / API key literal in step |
| `karate-hardcoded-localhost-url` | ⚠ warning | karate | http://localhost in step — move to karate-config.js |
| `production-target` | ✗ critical | playwright, karate, cucumber | Test references a production domain (configured in .testpulse/config.json) |
| `real-looking-pii` | ⚠ warning | playwright, karate, cucumber | Valid card (Luhn) / IBAN / PESEL / non-reserved e-mail in test data |
| `secret-in-test-output` | ⚠ warning | playwright, karate, cucumber | Token / credential printed to test output |
| `tls-verification-disabled` | ⚠ warning | playwright, karate, cucumber | TLS certificate verification turned off |

## Tests of LLM-backed apps

| Rule | Severity | Frameworks | What it catches |
| --- | --- | --- | --- |
| `eval-without-baseline` | ⚠ warning | playwright, karate, cucumber | Eval score checked only for existence / > 0 — no baseline |
| `nondeterministic-exact-match` | ⚠ warning | playwright, karate, cucumber | Exact string match on LLM output — flaky by nature |

## Not rules, but commands

`security-coverage` (OpenAPI × tests matrix), `ai-coverage` (OWASP LLM test coverage), `audit-mcp` and `judge` are separate commands, documented in [docs/CLI.md](CLI.md).
