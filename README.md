# Testpulse

[![CI](https://github.com/barurb1996/testpulse/actions/workflows/ci.yml/badge.svg)](https://github.com/barurb1996/testpulse/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/testpulse?color=a78bfa)](https://www.npmjs.com/package/testpulse)
[![license](https://img.shields.io/badge/license-MIT-a78bfa)](LICENSE)
[![node](https://img.shields.io/node/v/testpulse?color=a78bfa)](package.json)

**Your tests are green. Do they check anything?**

Testpulse is static analysis for Playwright, Karate and Cucumber suites. It finds tests that pass but verify nothing, and shows which
security behaviours your tests never exercise (no 401 test, no 403 test, no test of another user's data). It runs on your machine,
needs no changes to your CI, and nothing leaves it unless you ask.

Site: **[testpulse.app](https://testpulse.app)**

## Try it

```bash
npx testpulse ./e2e
```

```text
  test/corpus/ai-generated/users/tests/users.spec.ts
    ⚠ [status-only-success (ai-slop)] line 9: Test "returns 200 for valid credentials" asserts only a 2xx status —
      the returned/changed data is never verified
      → Also assert the response body or follow up with a read (e.g. GET after create/update/delete)
    ⚠ [status-only-success (ai-slop)] line 30: Test "creates a user" asserts only a 2xx status —
      the returned/changed data is never verified
    … (3 more)

Quality score: 85/100
```

That is real output on one of the AI-written fixtures in this repo (long lines wrapped, three findings omitted). The exit code is 1 when a critical issue is found (`--no-exit` to disable), so it works as a CI gate. Needs Node 20 or newer.

## What it finds

- **Tests that pass but verify nothing.** Missing, tautological and weak assertions, swallowed errors, commented-out assertions, API tests that check a 2xx
  status and never look at the data, duplicated scenarios, flaky waits. This is the typical failure of AI-generated tests: green and meaningless.
- **Security gaps against your OpenAPI spec.** Which endpoints have no test for 401, 403, another user's resource (BOLA/IDOR) or invalid input:

  ```bash
  npx testpulse security-coverage ./tests --openapi openapi.yaml --min-coverage 60
  ```

  ```text
  ENDPOINT              AUTH  401  403  BOLA  INPUT
  GET /bookings          🔒   ✓   ·    ·     ·
  POST /bookings         🔒   ✓   ✗    ·     ✓
  GET /bookings/:id      🔒   ✓   ✗   ✗     ·
  DELETE /bookings/:id   🔒   ✓   ✗   ✗    ✗

  Security coverage: 45% (5/11 applicable checks)
  ```

  Works for Karate and Playwright API tests.
- **Security hygiene in test code.** Hardcoded secrets, disabled TLS verification, production URLs, real-looking PII, secrets printed to test output.
- **Tests of AI apps and MCP servers.** OWASP LLM test coverage (`ai-coverage`) and an audit of an MCP server's tool descriptions (`audit-mcp`).

The full list is in [docs/RULES.md](docs/RULES.md) (46 rules, generated from the code).

## In CI

```yaml
- uses: actions/checkout@v4
  with: { fetch-depth: 0 }
- uses: barurb1996/testpulse@v0.3.0
  with:
    path: ./e2e
    project: my-project
    min-score: 60
```

Add `--format sarif --output testpulse.sarif` to get findings as GitHub code-scanning alerts, and `--changed-since origin/main` to report only
files changed in the branch. See [docs/GITHUB-ACTION.md](docs/GITHUB-ACTION.md) and [docs/CLI.md](docs/CLI.md).

## Evidence, and its limits

| What | Result |
| --- | --- |
| Rules run on 602 test files from Rocket.Chat, Grafana, Superset, Supabase and Karate | the first version of several rules produced mostly false positives; each was narrowed, before/after recorded |
| 120 AI-written API tests, labelled by an independent reviewer | only 7 were slop, almost all "asserts status 200, never checks the data" |
| Security coverage of five AI-written suites against their specs | 25–67%: happy paths and many 401s covered, most "another user's resource" and invalid-input cases missing |

These are small samples. Rules were tuned on the same files they were measured on, the labels come from an AI reviewer rather than a person, and the
specs for the security exercise were written for it. Treat the numbers as a regression check, not a benchmark. The full history, including a first run
that was wrong, is in [docs/VALIDATION.md](docs/VALIDATION.md).

Rules are heuristics: expect false positives. You can suppress a finding by fingerprint, turn a rule off or re-grade it
([docs/CONFIG.md](docs/CONFIG.md)), and false-positive reports are the most useful contribution you can make
([CONTRIBUTING.md](CONTRIBUTING.md)).

## Privacy

- Analysis runs **locally**. Nothing is uploaded unless you pass `--push` with the address of a server you run yourself.
- `testpulse judge` is opt-in, uses **your** Anthropic API key, and sends test code only when you run that command, with credentials redacted first.
- `audit-mcp --stdio` starts the command you give it on your machine, so only audit servers you would run anyway.

## More

| | |
| --- | --- |
| [docs/CLI.md](docs/CLI.md) | all flags and subcommands |
| [docs/RULES.md](docs/RULES.md) | every rule |
| [docs/CONFIG.md](docs/CONFIG.md) | ignores, rule config, scoring |
| [docs/VALIDATION.md](docs/VALIDATION.md) | how the rules were measured |
| [docs/DASHBOARD.md](docs/DASHBOARD.md) | the self-hosted dashboard (history, flaky detection, Slack digests); early |
| [docs/SECURITY.md](docs/SECURITY.md) · [SECURITY.md](SECURITY.md) | security model, reporting a vulnerability |
| [docs/ROADMAP.md](docs/ROADMAP.md) | where this is going |

## Project

```
packages/cli/             the analyzer (this is what `npx testpulse` runs)
action.yml · action/       the GitHub Action (installs the published CLI from npm)
apps/api/ · apps/web/     self-hosted dashboard (Fastify + Postgres, React)
site/                     the landing page (static)
docs/                     documentation
```

Solo side project: expect rough edges. MIT licensed, see [LICENSE](LICENSE).
