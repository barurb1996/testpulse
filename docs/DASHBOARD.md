# Dashboard (self-hosted, early)

> The dashboard (history, flaky detection, coverage map, Slack digests, repo scans) is an early, self-hosted app.
> It needs Postgres and an admin password. A hosting guide is not written yet.

### Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✓ | Postgres connection string |
| `ADMIN_PASSWORD` | ✓ | Admin password. The API refuses **every** `/api` request until it is set |
| `PORT` | | API port (default `3001`) |
| `HOST` | | Bind address (default `0.0.0.0`) |
| `CORS_ORIGIN` | | Dashboard origin(s) when served from a different origin than the API (default: same-origin only) |
| `TRUST_PROXY` | | `true` behind a reverse proxy so rate limits and login lockouts use the real client IP |
| `WEBHOOK_ALLOWED_HOSTS` | | Extra hosts allowed for outbound webhooks (`hooks.slack.com` always allowed) |
| `ANTHROPIC_API_KEY` | | Required for LLM gap analysis |
| `ENCRYPTION_KEY` | ✓ (prod) | 64 hex chars for AES-256-GCM column encryption. Generate: `openssl rand -hex 32`. Startup fails in production without it |
| `AUTO_SEED` | | Set `true` to auto-seed `demo-acme-bank` demo project on first start |

### Local setup (three terminals)

```bash
# 1. Postgres
docker compose up -d postgres

# 2. API (port 3001) — migrations run automatically on startup
cd apps/api
cp .env.example .env   # then fill in ADMIN_PASSWORD and ENCRYPTION_KEY
pnpm install
set -a && . ./.env && set +a   # the API reads real environment variables, not .env files
pnpm dev

# 3. Dashboard (port 5173, proxies /api → :3001)
cd apps/web
pnpm install
pnpm dev
```

Migrations run automatically on every startup via `drizzle-orm/node-postgres/migrator` — no manual `drizzle-kit migrate` needed. To re-seed the demo project manually: `pnpm --filter @testpulse/api db:seed`.

### Hosting

A hosting guide is not written yet. Two facts matter when you set one up: the dashboard calls `/api` on **its own origin**, so serve it from the
same origin as the API or behind a reverse proxy that forwards `/api`; and set `TRUST_PROXY=true` when running behind a proxy.

### Admin setup

All `/api` routes require authentication: an admin session (password login, plus TOTP code once MFA is on) or a project token
scoped to its own project. Project tokens can push runs and read their own project's data; they cannot reach admin endpoints,
the project list, Slack/repo settings or server-side scans. See `docs/SECURITY.md`.

1. Open `https://your-dashboard/` → sign in with `ADMIN_PASSWORD`.
2. Enable MFA: **Admin → Multi-factor authentication → Set up MFA**.
3. Create a project: **Admin → Create project** — a bearer token is shown once.
4. Store the token as a secret in your CI.
