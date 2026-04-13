# Testpulse

Static analysis for test suites. Think ESLint, but for test quality — does your `test('login')` block actually assert anything? Is `page.click('#submit')` missing an `await`? Are 40 of your Karate scenarios silently passing because the author forgot a `Then status 200`?

Built for QA Leads who want a quality gate on their test code, not just their product code. Playwright and Karate today; Cypress next.

## What it flags

### Playwright (`.spec.ts`)

| Rule | Severity | What it catches |
|---|---|---|
| `no-assertion` | critical | `test(...)` blocks with no `expect` call anywhere in the body |
| `no-hard-wait` | critical | `page.waitForTimeout(...)` — use auto-waiting locators |
| `missing-await` | critical | Async Playwright methods (`click`, `fill`, `goto`, …) called without `await` |
| `no-css-selector` | warning | `page.locator('.foo')` / `page.$('#bar')` — prefer `getByRole` / `getByTestId` |
| `no-generic-name` | warning | `test('test', …)`, `test('foo', …)` or any name under 5 chars |

### Karate (`.feature`)

| Rule | Severity | What it catches |
|---|---|---|
| `karate-no-assertion` | critical | Scenarios with no `Then`, no `match` / `status` / `assert`, and no resolvable call to an asserting helper (classpath + helper-object resolution, with fallback to name heuristic) |
| `karate-empty-scenario` | critical | Scenario with zero steps |
| `karate-explicit-sleep` | warning | `helpers.sleep(...)`, `Thread.sleep(...)`, etc. — use Karate's `retry` / `configure retry` |
| `karate-hardcoded-localhost-url` | warning | `http://localhost:...` in step text — move to `karate-config.js` |
| `karate-repeated-setup` | warning | 3+ scenarios in a feature sharing the same first 3 steps — move to a `Background` block |
| `karate-unchecked-http-call` | warning | `method <verb>` step with no subsequent `status`/`match`/validating-call (skipped when the scenario uses `retry until`) |
| `karate-duplicate-scenario` | warning | Two or more scenarios (anywhere in the suite) with byte-identical step sequences after whitespace normalisation — pure copy-paste |
| `karate-data-variation-duplicate` | warning | Scenarios with identical step structure differing only in string/number literals / `#(var)` / UUIDs — candidate for `Scenario Outline` + `Examples` |
| `karate-duplicate-assertion` | warning | Same `match` / `assert` repeated on the same HTTP response window (windows are split by `method <verb>` or `call ...`) |
| `karate-endpoint-coverage-overlap` | info | 3+ scenarios exercising the same `(verb, normalised path)` — path params and query strings are stripped before grouping |
| `karate-generic-scenario-name` | warning | Generic scenario names (`test`, `foo`, under 5 chars) |
| `karate-print-in-test` | info | `* print ...` left in a committed test |

`@ignore`-tagged features and scenarios are excluded — they're Karate's convention for helper libraries, not runnable tests.

### Scoring

Each file accumulates issues, each severity deducts points from a 100-baseline: critical = −10, warning / info = −3. Floor at 0. One critical issue blocks the CLI (exit 1) unless `--no-exit` is passed.

## Layout

```
packages/cli/             # the analyzer itself — open source, MIT
  src/
    index.ts              # entry point, bin target
    analyzer.ts           # walks a directory, dispatches to parsers
    parsers/
      playwright.ts       # TypeScript AST via @typescript-eslint/typescript-estree
      karate.ts           # line-based Gherkin parser (docstrings, tags, Examples, Background)
      karate-project.ts   # project-wide pre-pass: assertion map + classpath/helper resolution
    rules/                # one rule per file
    reporter/             # terminal output + quality score
    pusher.ts             # POSTs results to the API when --push is set
apps/api/                 # Fastify + Drizzle + Postgres backend (history, trends)
apps/web/                 # Vite + React + Recharts dashboard
examples/                 # intentionally-broken specs used by the dogfood workflow
action.yml                # GitHub Action (composite, at repo root for clean `uses:`)
.github/workflows/        # dogfood CI running the Action against examples/
```

## Quick start — CLI only

Prereqs: Node 20, pnpm 10.

```bash
pnpm install
pnpm --filter @testpulse/cli exec tsc

# analyse a directory of specs / .feature files
node packages/cli/dist/index.js path/to/your/tests
```

The CLI walks the directory recursively, dispatches each file to the right parser, prints issues, shows a quality score, and exits 1 if any `critical` issues were found.

Flags:

```bash
--push <api-url>       POST the result to a running API (see next section)
--project <slug>       required when --push is set
--no-exit              don't exit 1 on critical issues
--help, -h             print usage
```

When running inside a GitHub Actions job, the pusher auto-fills `commitSha` / `branch` from `GITHUB_SHA` / `GITHUB_REF_NAME`.

## Full stack — CLI + API + dashboard

Three moving parts, three terminals.

```bash
# 1. Postgres (persistent volume; run once, survives reboots)
docker compose up -d postgres

# 2. API (Fastify, port 3001)
cd apps/api
cp .env.example .env
pnpm install
pnpm exec drizzle-kit generate   # only the first time, or after schema changes
pnpm exec tsx src/db/migrate.ts  # apply migrations
pnpm dev

# 3. Dashboard (Vite, port 5173, proxies /api to :3001)
cd apps/web
pnpm install
pnpm dev
```

Point the CLI at anything and push the result:

```bash
node packages/cli/dist/index.js /path/to/tests \
  --push http://localhost:3001 \
  --project my-project
```

Open `http://localhost:5173`, type `my-project` in the input, and you'll see a quality-score-over-time chart and a table of every run.

### API surface

- `GET  /health`
- `POST /api/runs` — upserts the project by slug, stores the run + issues in one transaction
- `GET  /api/runs?project=<slug>&limit=<n>` — history ordered by `createdAt` desc

Payload shape (see `packages/cli/src/pusher.ts` for the source of truth):

```json
{
  "projectSlug": "string",
  "projectName": "string | undefined",
  "commitSha":   "string | undefined",
  "branch":      "string | undefined",
  "score": 0-100,
  "filesScanned": 0,
  "issues": [
    { "file": "string", "line": 0, "rule": "string",
      "severity": "critical | warning | info", "message": "string" }
  ]
}
```

No auth yet — this is local-only until the deploy lands.

## GitHub Action

Consume it from your own repo's workflow:

```yaml
name: Testpulse
on: [push, pull_request]

jobs:
  analyse:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write   # needed for the PR comment
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: barurb1996/testpulse@master
        with:
          path: tests                      # default: ./e2e
          fail-on-critical: 'true'         # default
          comment-on-pr: 'true'            # default
```

On a pull request it posts a collapsed comment with the score and the full analyzer output. On a push, no comment — just CI pass/fail.

A dogfood workflow (`.github/workflows/dogfood.yml`) runs the Action against `examples/` on every push to master.

## Rule conventions

Each rule lives at `packages/cli/src/rules/<kebab-name>.ts` and exports a pure function.

- Playwright rules take a `TSESTree.Node` (and optionally the parent) and return `Issue[]`. Register inside `simpleTraverse` in `parsers/playwright.ts`.
- Karate rules take a `KarateScenario` (or `KarateFeature` for feature-level rules) and return `Issue[]`. Register inside the scenario loop in `parsers/karate.ts`. Rules that need cross-file resolution receive the `KarateProjectContext` as a third arg.

Severity semantics:

- `critical` — the test is silently broken or the scenario can't fail (no assertions, missing await, hardcoded sleep). Blocks CI.
- `warning` — bad practice, fix when you can.
- `info` — stylistic / debug leftovers.

When adding a rule, write a throwaway fixture in `/tmp` and confirm it fires exactly where you expect. Don't commit fixtures unless they're deliberate test cases.

## Status

Solo side project. Open-core plan: CLI and basic rules stay MIT. Flaky detection, Coverage Map, Slack alerts, the hosted dashboard — SaaS-only.

Not on npm yet. Today you run it from source.
