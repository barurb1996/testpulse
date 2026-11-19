# Testpulse

Test quality analyzer for QA teams. Static analysis of Playwright and Karate test suites — finds real problems: missing assertions, hardcoded waits, duplicate scenarios, coverage gaps. Ships a web dashboard with history, flaky detection, LLM-powered gap analysis, and Slack digests.

**Open-core:** CLI + rules are MIT. Dashboard, history, and AI features are self-hosted SaaS.

---

## Quick start — CLI only

```bash
# analyse a directory (Playwright, Karate, Cucumber)
npx testpulse ./e2e

# analyse and push results to your dashboard
npx testpulse ./e2e \
  --push https://testpulse.example.com \
  --project my-project \
  --token tp_my-project_...
```

Or from source (Node 20, pnpm 10 required):

```bash
pnpm install
pnpm --filter @testpulse/cli exec tsc
node packages/cli/dist/index.js path/to/tests
```

### CLI flags

| Flag | Description |
|------|-------------|
| `--push <url>` | Push run to dashboard API |
| `--project <slug>` | Project slug (required with `--push`) |
| `--token <token>` | Bearer token (or `TESTPULSE_TOKEN` env var) |
| `--junit <glob>` | Parse JUnit XML for pass/fail per scenario |
| `--no-exit` | Don't exit 1 on critical issues |
| `--no-ignore` | Skip `.testpulse/ignores.json` |
| `--print-fingerprints` | Show issue fingerprints inline |
| `--format <text\|sarif\|json>` | Output format; `sarif` feeds GitHub code scanning |
| `--output <file>` | Write sarif/json to a file |
| `--changed-since <ref>` | Only report files changed vs a git ref (CI: `fetch-depth: 0`) |

### Subcommands

```bash
# upload an OpenAPI spec as coverage targets
npx testpulse ingest-openapi openapi.yaml --push <url> --project <slug>

# ingest business docs (.txt / .md / .docx) for LLM context
npx testpulse ingest-docs docs/ --push <url> --project <slug>

# scan app source code to auto-discover endpoints
npx testpulse scan-codebase src/ --push <url> --project <slug> --extract
```

---

## Dashboard — self-hosted

### Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✓ | Postgres connection string |
| `ADMIN_PASSWORD` | ✓ | Admin password (plain text, compared with timing-safe equal) |
| `PORT` | | API port (default `3001`) |
| `HOST` | | Bind address (default `0.0.0.0`) |
| `CORS_ORIGIN` | | Comma-separated allowed origins (default: open — lock down in prod) |
| `ANTHROPIC_API_KEY` | | Required for LLM gap analysis |
| `ENCRYPTION_KEY` | | 64 hex chars for AES-256-GCM column encryption. Generate: `openssl rand -hex 32` |
| `REQUIRE_AUTH` | | Set `true` to require bearer token on run ingest (POST /runs etc.) |
| `AUTO_SEED` | | Set `true` to auto-seed `demo-acme-bank` demo project on first start |

### Local setup (three terminals)

```bash
# 1. Postgres
docker compose up -d postgres

# 2. API (port 3001) — migrations run automatically on startup
cd apps/api
cp .env.example .env   # then fill in ADMIN_PASSWORD etc.
pnpm install
pnpm dev

# 3. Dashboard (port 5173, proxies /api → :3001)
cd apps/web
pnpm install
pnpm dev
```

Migrations run automatically on every startup via `drizzle-orm/node-postgres/migrator` — no manual `drizzle-kit migrate` needed. To re-seed the demo project manually: `pnpm --filter @testpulse/api db:seed`.

### Railway deploy

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template)

1. Create a new Railway project, add a **PostgreSQL** plugin.
2. Deploy this repo. Railway will detect `apps/api` as the service.
3. Set environment variables:

```
DATABASE_URL          <provided by Railway Postgres plugin>
ADMIN_PASSWORD        <strong password>
ENCRYPTION_KEY        <openssl rand -hex 32>
ANTHROPIC_API_KEY     <your Anthropic key>
CORS_ORIGIN           https://your-frontend.railway.app
AUTO_SEED             true
```

4. Deploy `apps/web` as a static site, set `VITE_API_URL` to the API service URL.

Migrations run automatically on startup — no extra steps.

### Admin setup

1. Open `https://your-dashboard/` → sign in with `ADMIN_PASSWORD`.
2. Enable MFA: **Admin → Multi-factor authentication → Set up MFA**.
3. Create a project: **Admin → Create project** — a bearer token is shown once.
4. Store the token as a secret in your CI.

---

## GitHub Action

```yaml
# .github/workflows/quality.yml
name: Test quality

on: [push, pull_request]

jobs:
  testpulse:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Analyse test quality
        uses: barurb1996/testpulse/packages/github-action@master
        with:
          path: ./e2e
          project: my-project
          api-url: https://testpulse.example.com
          token: ${{ secrets.TESTPULSE_TOKEN }}
          min-score: 60          # fail PR if score drops below 60
          junit: target/surefire-reports/*.xml   # optional
```

### Action inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `path` | | `.` | Directory with test files |
| `project` | ✓ | | Project slug |
| `api-url` | | | Dashboard API URL (push results) |
| `token` | | | Project bearer token (use a secret) |
| `min-score` | | `0` | Fail step if score < N (0 = disabled) |
| `junit` | | | JUnit XML glob |
| `no-exit` | | `false` | Don't fail on critical issues |

### Action outputs

| Output | Description |
|--------|-------------|
| `score` | Quality score 0–100 |

Results are also written to the **GitHub Step Summary** automatically.

---

## What it flags

### Playwright (`.spec.ts`)

| Rule | Severity | What it catches |
|---|---|---|
| `no-assertion` | critical | `test(...)` blocks with no `expect` call |
| `no-hard-wait` | critical | `page.waitForTimeout(...)` — use auto-waiting locators |
| `missing-await` | critical | Async Playwright methods called without `await` |
| `no-css-selector` | warning | `page.locator('.foo')` — prefer `getByRole` / `getByTestId` |
| `no-generic-name` | warning | `test('test', …)`, `test('foo', …)` or name under 5 chars |
| `playwright-test-only` | critical | `test.only(...)` left in code — skips everything else in CI |
| `playwright-conditional-in-test` | warning | `if` / `switch` at top of a `test(...)` body — tests should be deterministic |
| `playwright-hardcoded-timeout` | warning | `test.setTimeout(N)` with N > 30s — usually masks flakiness |

### Karate (`.feature`)

| Rule | Severity | What it catches |
|---|---|---|
| `karate-no-assertion` | critical | Scenarios with no `Then`, no `match` / `status` / `assert` |
| `karate-empty-scenario` | critical | Scenario with zero steps |
| `karate-explicit-sleep` | warning | `helpers.sleep(...)`, `Thread.sleep(...)` — use `retry` |
| `karate-hardcoded-auth-token` | critical | Bearer JWT / API key literal in a step |
| `karate-hardcoded-uuid` | warning | Literal UUID in step text — generate per-run |
| `karate-hardcoded-localhost-url` | warning | `http://localhost:...` — move to `karate-config.js` |
| `karate-repeated-setup` | warning | 3+ scenarios sharing the same first 3 steps — use `Background` |
| `karate-unchecked-http-call` | warning | `method <verb>` with no subsequent `status`/`match` |
| `karate-duplicate-scenario` | warning | Byte-identical step sequences — copy-paste detected |
| `karate-data-variation-duplicate` | warning | Identical structure, different literals — use `Scenario Outline` |
| `karate-duplicate-assertion` | warning | Same `match` repeated on the same HTTP response window |
| `karate-configure-retry-in-scenario` | warning | Ad-hoc `* configure retry/timeout` inside a scenario |
| `karate-endpoint-coverage-overlap` | info | 3+ scenarios hitting the same endpoint |
| `karate-generic-scenario-name` | warning | Generic names (`test`, `foo`, under 5 chars) |
| `karate-print-in-test` | info | `* print ...` left in committed test |

### Cucumber

Gherkin files without Karate DSL tokens are treated as plain Cucumber. Generic rules apply: `empty-scenario`, `duplicate-scenario`, `data-variation-duplicate`, `generic-scenario-name`, `repeated-setup`, `hardcoded-auth-token`, `hardcoded-uuid`, `hardcoded-localhost-url`.

Cucumber JS/TS step definitions: same Playwright rules + `cucumber-empty-step-body` (critical), `cucumber-console-in-step` (info).

Cucumber Java step definitions (regex-based): `cucumber-java-empty-step-body` (critical), `cucumber-java-explicit-sleep` (warning), `cucumber-java-print-in-step` (info).

---

## Security coverage (OpenAPI x tests)

```bash
npx testpulse security-coverage ./tests --openapi openapi.yaml [--fail-on critical|warning] [--min-coverage 70] [--format json]
```

Reads `security`, `responses` and input constraints from the spec, classifies every Karate HTTP call
(happy / 401 / 403 / cross-user / invalid-input) and prints an endpoint x test-kind matrix with gaps sorted by risk:
`missing-unauthenticated-test`, `missing-forbidden-test`, `missing-object-level-authz-test` (BOLA/IDOR),
`missing-input-validation-test`, `undocumented-endpoint-tested`. Karate only for now; Playwright `request` is next.

## Suppressing false positives

```bash
# print fingerprints
testpulse ./e2e --print-fingerprints
```

```json
// .testpulse/ignores.json
{
  "version": 1,
  "ignores": [
    {
      "fingerprint": "ba3c199b89df",
      "rule": "karate-generic-scenario-name",
      "reason": "intentional demo scenario"
    }
  ]
}
```

Ignores can also be managed from the dashboard UI. Stale ignores (fingerprint no longer matches any issue) are surfaced in the report and dashboard.

### `.testpulse/config.json`

```json
{
  "rules": {
    "karate-endpoint-coverage-overlap": "off",
    "karate-print-in-test": { "severity": "warning" }
  },
  "ignoreFiles": ["**/legacy/**", "**/generated/**"]
}
```

### Scoring

Critical = −10, warning/info = −3, floor at 0. One critical issue = exit 1 (unless `--no-exit`).

---

## Project layout

```
packages/cli/             # analyzer CLI (MIT)
  src/rules/              # one rule per file
packages/github-action/   # GitHub Action wrapper
apps/api/                 # Fastify + Drizzle + PostgreSQL backend
apps/web/                 # Vite + React + Recharts dashboard
examples/                 # intentionally-broken specs for rule testing
```

## License

CLI and rules: **MIT**  
Dashboard API and web app: proprietary / self-hosted
