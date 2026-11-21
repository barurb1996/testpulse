# Changelog

## Unreleased
- `karate-hardcoded-uuid`: reports a fixed ID only when it ends up in a request body (inline or through a constant the same scenario sends). Constants for reference data, `match` values, `param`/`header`, `path`/`url` and function arguments are left alone. On folio-integration-tests: 1,034 → 104 findings.
- `karate-status-only-success`: skips setup/cleanup scenarios (imperative names such as "Create item", "clean test instance") and setup/helper files; "creates a user"-style behaviour names are still checked.
- `karate-duplicate-scenario`: copies spread over several files (usually pasted setup) are `info`; copies in the same file stay `warning`.
- `karate-no-assertion`: critical only when a scenario sends an HTTP request and checks nothing. Scenarios that only call unresolved helpers, only drive the browser, send no request, or sit in setup/helper files (`init`, `util`, `reusable`, `common`, …) are now warnings; mock-server scenarios are skipped. On 1,661 feature files from four public Karate repositories this took the criticals from 1,241 to 5 (the rest became warnings or were skipped).

## 0.3.0 — 2026-11-21
- Rule descriptions rewritten to match how the narrowed rules actually behave (`no-assertion`, `happy-path-only`, `name-body-mismatch`, …); no change to findings or scores.
- The Action's default `testpulse-version` is now `~0.3.0`.
- Hard-wait rules (Playwright `no-hard-wait`, Karate `karate-explicit-sleep` / `karate-retry-plus-sleep`, Cucumber `cucumber-java-explicit-sleep`) now recognise sleeps behind any common helper namespace (`helpers`, `utils`, `tools`, `fixtures`, `helperFunctions`, `support`, `common`, `lib`) and `sleep` / `pause` / `delay`, not only `helpers.sleep`. Karate `def x = utils.foo` aliases resolve the same way.
- GitHub Action rewritten for the Marketplace: installs the published CLI from npm (no source build), inputs via environment, summary comment that updates in place, optional SARIF upload, `min-score`, `changed-since`; logic unit-tested (`action/`).
- Windows: cross-platform build and test scripts, CI job on `windows-latest`, LF line endings enforced for fixtures.
- Dashboard API: the repo-scan route resolves the CLI engine correctly (it could not run before).

## 0.2.1 — 2026-11-20
- npm manifest: `homepage` points to https://testpulse.app; leftover example comment removed from the build.

## 0.2.0 — 2026-11-20
First npm release (package renamed to `testpulse`).
- 46 rules across Playwright, Karate and Cucumber, now with a category and a one-line suggestion per finding.
- Security hygiene rules for test code (secrets, TLS, production URLs, PII, secrets in output).
- `security-coverage`: endpoint × test-kind matrix against an OpenAPI spec (401 / 403 / BOLA / input validation) for Karate and Playwright API tests.
- `ai-coverage` (OWASP LLM test coverage) and `audit-mcp` (MCP tool descriptions).
- `judge`: optional LLM review of test quality with your own Anthropic key (secrets redacted, cached).
- `--format sarif|json`, `--changed-since <ref>`, `--version`.
- Rules were narrowed after measuring them on 602 files from public repositories; see docs/VALIDATION.md.
- Dashboard: every API route now requires an admin session or a project-scoped token; login sessions with MFA, brute-force lockout and SSRF protections (docs/SECURITY.md).
