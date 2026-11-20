# Testpulse

Test quality analyzer for QA teams. CLI does static analysis of test code (Playwright first, Karate next) and flags quality issues. Future: SaaS dashboard with history, flaky detection, Slack alerts. Open-core model — CLI + basic rules MIT, value-add modules closed.

Target user: QA Lead (champion) → QA Manager (budget) → C-level (approval).

## Stack

- Node.js 20, TypeScript, **ESM modules** (note: local imports use `.js` extension even in `.ts` files)
- pnpm workspaces + turborepo
- Parser: `@typescript-eslint/typescript-estree`
- Planned: Fastify + PostgreSQL backend, React + Recharts frontend, Railway hosting

## Layout

```
packages/cli/             # the analyzer CLI (open source, MIT)
  src/
    index.ts              # entry point, bin target
    analyzer.ts           # walks directory, dispatches to parsers
    types.ts              # Issue, AnalysisResult
    parsers/playwright.ts # AST parse + traverse, calls each rule
    rules/*.ts            # one rule per file — (node, parent?) => Issue[]
    reporter/index.ts     # terminal output + quality score + exit code
apps/api/                 # (planned) Fastify backend
apps/web/                 # (planned) React dashboard
action.yml, action/       # GitHub Action: installs the published CLI from npm (script is unit-tested)
```

## Commands

All from repo root unless noted.

```bash
# build CLI
cd packages/cli && pnpm exec tsc

# typecheck only
cd packages/cli && pnpm exec tsc --noEmit

# run CLI against a directory
node packages/cli/dist/index.js <path-to-specs>
```

Turborepo `pnpm -w build` currently errors on a workspaces-resolution issue — use the direct `tsc` invocation above until that's fixed.

## Rule conventions

Every rule lives in `packages/cli/src/rules/<rule-name>.ts` and exports a function:

```ts
export function ruleName(node: TSESTree.Node, parent?: TSESTree.Node): Issue[]
```

Return `[]` when the rule doesn't match. Register the rule in `packages/cli/src/parsers/playwright.ts` inside `simpleTraverse({ enter })`.

Severity levels: `critical` (blocks merge, -10 to score, exit 1), `warning` (-3), `info` (-3).

When adding a rule, also test it with a fixture spec file in `/tmp` — don't commit fixtures unless they're explicitly test cases.

## Product guardrails

- **Open-core split matters.** Moat features (history, flaky detection, coverage map, alerts, dashboards) belong in the closed SaaS side, NOT in the open CLI. Basic static rules are fine in the CLI.
- **Don't over-couple to Playwright.** Parser interface should let us drop in Karate next without rewriting rules infrastructure.
- **Framework priority:** Playwright → Karate → Cypress. Don't suggest supporting others before customer validation.

## Working style

- Polish in chat, English in code and commits.
- User has granted autonomy — commit, push to master, run shell commands without asking. Still flag genuinely destructive ops (force-push to master with divergent history, rm on unrelated paths) before running.
- Skip boilerplate confirmations. State what you did at the end, move on.
- When uncertain whether a feature is open-core or SaaS-side, ask rather than assume.
