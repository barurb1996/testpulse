# Security model

## Authentication

- Every `/api/*` route (except `/api/admin/login`, `/api/admin/session`, `/api/admin/mfa/status`) goes through one gate
  (`apps/api/src/gate.ts`). `/health` is the only other open route.
- **Admin session**: `POST /api/admin/login` with the password (and a TOTP code when MFA is enabled) returns a random session token
  (kept hashed in memory, 8 h absolute / 2 h idle). The dashboard keeps it in `sessionStorage` only. The password itself is never stored client-side or sent again.
- **Project token** (`tp_<slug>_<hex>`, only its SHA-256 is stored): scoped to one project, may push and read that project, blocked from
  `/api/admin/*`, the project list, project rename/Slack webhook, repo settings, server-side scans and digest sending.
- Failed logins are limited per IP (5 / 15 min) and globally (20 / 15 min); responses are generic; password comparison is constant-time and length-independent.
  A TOTP code can be used once.
- With no `ADMIN_PASSWORD` set the API answers 503 to everything. `TESTPULSE_INSECURE_NO_AUTH=true` disables auth for local development and is ignored when `NODE_ENV=production`.

## Data and outbound calls

- Repo tokens, Slack webhooks and the MFA secret are AES-256-GCM encrypted at rest (`ENCRYPTION_KEY`; startup fails in production without it).
- Outbound webhooks only go to allow-listed https hosts, without redirects.
- Server-side repo scans: https URLs only, no embedded credentials, hosts resolving to private addresses are refused, clone credentials are passed via git config in the
  environment (not argv/URL), symlinks are disabled, configured paths must stay inside the clone, one scan at a time, errors are redacted before logging.
- `testpulse judge` sends test code (secrets redacted) to the Anthropic API only when you run it. `testpulse audit-mcp --stdio` starts the command you give it.

## Known limits

- Admin sessions are in-memory: a restart logs everyone out; running several API instances would need a shared store (and a shared login limiter).
- The login limiter can be used to lock the admin out for 15 minutes with repeated bad attempts; that is the price of resisting distributed password/TOTP guessing.
- DNS-based SSRF checks for repo URLs resolve once before cloning; a hostile DNS server could still rebind. Run scans on a host without access to internal networks if that matters.
- The dashboard's Content-Security-Policy must be set by whatever serves the static files; the API only sets it on its own responses.
- Two moderate/low advisories remain in dev-only tooling (esbuild via `tsx` / `drizzle-kit`); none in production dependencies.
- Login and MFA flows were covered by unit tests of the gate, limiter and session store, but not exercised end-to-end against a database (none was available in the development environment).

Report vulnerabilities privately to the maintainer rather than in a public issue.
