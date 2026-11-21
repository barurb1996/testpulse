# Changelog

## 0.2.2 — unreleased
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
