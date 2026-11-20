# Contributing

The most useful contribution is a **false-positive report**: a test that Testpulse flags but that is fine (or a real slop test it misses).
Use the "False positive / missed finding" issue template and include the rule id and the smallest snippet that reproduces it.
Heuristic rules live or die on real code, so these reports directly improve precision.

## Setup

Node 20+ and pnpm 10.

```bash
pnpm install
pnpm run typecheck                     # all workspaces
pnpm --filter testpulse run test       # builds the CLI, then 47+ unit, end-to-end and corpus-regression tests
pnpm --filter @testpulse/api run test  # API tests; set TEST_DATABASE_URL to also run the Postgres integration tests
pnpm run check                         # typecheck + tests + npm package gate + regenerate docs/RULES.md
```

The integration tests need a **throwaway** Postgres database (they create projects and reset MFA settings), for example:
`docker run -d -p 5432:5432 -e POSTGRES_USER=testpulse -e POSTGRES_PASSWORD=testpulse -e POSTGRES_DB=testpulse_test postgres:16-alpine`
and `export TEST_DATABASE_URL=postgres://testpulse:testpulse@127.0.0.1:5432/testpulse_test`.

CI runs the same things on every push and pull request (`.github/workflows/ci.yml`): CLI on Node 20 and 22, API with a Postgres service,
dashboard build, an npm package gate (pack, install into an empty project, run), a check that `docs/RULES.md` is current, and workflow linting.
`security.yml` adds a dependency audit and CodeQL. The corpus regression test (`test/unit/regression.test.ts`) fails if recall drops or false positives grow
against the labelled AI-written tests; if a change legitimately moves those numbers, update the baseline together with `docs/VALIDATION.md`.

## Adding or changing a rule

1. One rule per file in `packages/cli/src/rules/<rule-name>.ts`, a pure function returning `Issue[]`
   (Playwright rules take an AST node or a `PlaywrightTestCase`; Karate rules take a scenario).
2. Wire it into `parsers/playwright.ts` or `parsers/karate.ts` and **register it in `rule-registry.ts`** (id, category, frameworks, severity, description).
3. Add examples to the corpus: something it must flag in `packages/cli/test/corpus/*/bad*`, and a near-miss it must not flag in the matching `good*`.
4. Run it against real code, not just fixtures. The bar from the roadmap: at most about 10% false positives on a sample and at least one genuine finding in a real repository.
   Several rules in this project were first written, then measured on public repos and rewritten because they were noisy; see [docs/VALIDATION.md](docs/VALIDATION.md).
5. If you have labelled AI-generated tests, `node packages/cli/test/corpus/ai-generated/eval.mjs` reports precision and recall against them.
6. Regenerate the rule reference: `node scripts/gen-rules-doc.mjs` (it is built from the registry; do not edit `docs/RULES.md` by hand).

Severity: `critical` means the test is silently broken or cannot fail; `warning` is a bad practice; `info` is stylistic. When in doubt, pick the lower one:
a noisy critical rule blocks people's CI and costs trust.

## Conventions

- TypeScript, ESM. Local imports use the `.js` extension even in `.ts` files.
- English in code, comments and commit messages. Conventional-commit style prefixes (`feat`, `fix`, `chore`, `docs`).
- Do not commit anything from a real company or customer: no real test suites, endpoints, hostnames, credentials or data, in fixtures or in issues.
- Do not add rules that need to run the tests. Testpulse is static analysis by design.

## Security

Do not open a public issue for a vulnerability; see [SECURITY.md](SECURITY.md).
