# testpulse

Static analysis for test suites. It finds tests that pass but verify nothing, and shows which security behaviours your tests never exercise.
Works on Playwright, Karate and Cucumber (JS/TS and Java).

```bash
npx testpulse ./e2e
```

Exit code is 1 when a critical issue is found (`--no-exit` to disable), so it works as a CI gate.

## What it checks

- **Test quality**: missing or tautological assertions, swallowed errors, status-only API tests, commented-out assertions, duplicated scenarios, flaky waits and more
  (`testpulse --help` lists every command, see the repository for the full rule list).
- **Security hygiene in tests**: hardcoded secrets, disabled TLS verification, production targets, real-looking PII, secrets in test output.
- **Security coverage** against an OpenAPI spec: which endpoints have no test for 401, 403, another user's resource (BOLA/IDOR) or invalid input.
- **AI apps and MCP servers**: OWASP LLM test coverage and an audit of an MCP server's tool descriptions.

## Commands

```bash
npx testpulse <path>                                   # analyse a directory
npx testpulse <path> --changed-since origin/main       # only files changed vs a git ref
npx testpulse <path> --format sarif --output out.sarif # SARIF for GitHub code scanning (also: json)
npx testpulse security-coverage <tests> --openapi openapi.yaml [--fail-on critical] [--min-coverage 70]
npx testpulse ai-coverage <tests>
npx testpulse audit-mcp --stdio "npx -y some-mcp-server"
npx testpulse judge <path>                             # optional LLM review, needs ANTHROPIC_API_KEY
```

Suppress a finding with its fingerprint in `.testpulse/ignores.json`, and tune rules in `.testpulse/config.json`
(see the repository README).

## Privacy

Analysis runs locally and nothing is uploaded unless you pass `--push <url>` to your own Testpulse server.
`judge` sends test code (credentials redacted) to the Anthropic API, and only when you run that command.
`audit-mcp --stdio` starts the command you give it on your machine.

## Limits

These are heuristic rules, so expect some false positives; they were tuned on a few hundred files from public repositories and a small set of
AI-written tests. Karate and Playwright API tests are supported for the security matrix; other frameworks are not.

MIT licensed. Source and issues: https://github.com/barurb1996/testpulse
