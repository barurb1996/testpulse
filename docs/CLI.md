# CLI reference

## Flags

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

## Subcommands

```bash
# upload an OpenAPI spec as coverage targets
npx testpulse ingest-openapi openapi.yaml --push <url> --project <slug>

# ingest business docs (.txt / .md / .docx) for LLM context
npx testpulse ingest-docs docs/ --push <url> --project <slug>

# scan app source code to auto-discover endpoints
npx testpulse scan-codebase src/ --push <url> --project <slug> --extract
```

---

## Security coverage, AI apps, MCP and the LLM judge

### Security coverage (OpenAPI x tests)

```bash
npx testpulse security-coverage ./tests --openapi openapi.yaml [--fail-on critical|warning] [--min-coverage 70] [--format json]
```

Reads `security`, `responses` and input constraints from the spec, classifies every Karate HTTP call
(happy / 401 / 403 / cross-user / invalid-input) and prints an endpoint x test-kind matrix with gaps sorted by risk:
`missing-unauthenticated-test`, `missing-forbidden-test`, `missing-object-level-authz-test` (BOLA/IDOR),
`missing-input-validation-test`, `undocumented-endpoint-tested`. Works for Karate and Playwright (`request.get/post/…`, `page.request`) tests.

### LLM judge (optional, bring your own key)

```bash
export ANTHROPIC_API_KEY=...
npx testpulse judge ./e2e --changed-since origin/main [--max-files 10] [--min-score 3] [--format json]
npx testpulse judge-eval labels.json ./e2e     # agreement with your own human scores
```

Reviews each test against the behaviour its name promises (score 1-5, missing cases, a suggested test for weak ones),
using the static findings and locally imported modules as context. Test code is sent to the Anthropic API **only when you run `judge`**,
with credentials redacted first. Results are cached by content hash in `.testpulse/cache/` (git-ignored), model via `TESTPULSE_JUDGE_MODEL`.
`judge-eval` measures exact / within-1 agreement against a labelled set; `packages/cli/test/corpus/ai-slop/labels.seed.json` is a small seed, not a validated benchmark.

### Testing AI apps and MCP servers

```bash
npx testpulse ai-coverage ./tests [--fail-on critical]
npx testpulse audit-mcp --stdio "npx -y some-mcp-server" --tests ./tests [--fail-on critical]
npx testpulse audit-mcp --url https://mcp.example.com/mcp
```

- `ai-coverage` detects LLM-backed apps from the tests themselves and checks for OWASP LLM-style tests: prompt injection (LLM01),
  system-prompt leakage (LLM07), unsafe output handling (LLM05) and, for agents/tools, permission and excessive-agency tests (LLM06).
  Presence is keyword-based, so treat a ✓ as "something targets this", not proof of quality.
- Two per-file rules run in the normal analysis: `nondeterministic-exact-match` and `eval-without-baseline`.
- `audit-mcp` lists a server's tools and flags tool poisoning (hidden instructions, exfiltration cues, invisible Unicode), excessive permissions,
  unconstrained free-form inputs, missing annotations and tools no test mentions. `--stdio` **starts the given command locally** — only audit servers you would run anyway.
