# Security policy

## Reporting a vulnerability

Please report privately, not in a public issue: use GitHub's **Security → Report a vulnerability** on this repository
(private vulnerability reporting). Include what you found, how to reproduce it and the version (`npx testpulse --version`).

This is a side project maintained by one person, so I cannot promise a fixed response time, but a report with a working reproduction
will be looked at as soon as possible and credited if you wish.

## Scope

- **The CLI (`testpulse` on npm)** runs locally and analyses files without executing them. Relevant issues include command execution via crafted input,
  unexpected network access, credentials leaking into output, and unsafe handling of the opt-in features
  (`judge` sends redacted test code to the Anthropic API; `audit-mcp --stdio` starts the command you give it).
- **The self-hosted dashboard (`apps/api`, `apps/web`)**: authentication, project-token scoping, SSRF in repo scans and webhooks, XSS. The security model and its
  known limits are in [docs/SECURITY.md](docs/SECURITY.md).

Supported version: the latest release.
