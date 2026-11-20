# Landing page

Static files, no build step, no external requests: `index.html`, `style.css`, `app.js`, `favicon.svg`, `404.html`, `robots.txt`,
and `_headers` (security headers, read by Cloudflare Pages and Netlify). The page reuses the dashboard's colour tokens
(`apps/web/src/index.css`), so keep the two in sync if the theme changes. The numbers in "What we measured" come from
`docs/VALIDATION.md`; update both together.

The CSP in `_headers` is strict (`default-src 'none'`, scripts and styles from the same origin only). That is why the page has no inline
CSS, JavaScript or `style=` attributes: keep it that way, or the browser will silently drop them.

## Deploy on Cloudflare Pages

Dashboard: Workers & Pages → Create → connect the Git repository. Two equivalent ways exist, depending on what the dashboard offers:

**Workers (static assets), uses `wrangler.jsonc` in the repo root:** Build command empty, Deploy command `npx wrangler deploy`, preview command `npx wrangler versions upload`, root directory `/`. The Worker name in the dashboard must be `testpulse` (matches `wrangler.jsonc`).

**Pages:**

| Setting | Value |
| --- | --- |
| Production branch | `master` |
| Framework preset | None |
| Build command | *(empty)* |
| Build output directory | `site` |

Or from the terminal (opens a browser to log in): `npx wrangler pages deploy site --project-name testpulse`.

Custom domain later: Pages project → Custom domains. HTTPS and the `_headers` file keep working unchanged.

After every deploy, check the headers are actually served:

```bash
./site/check-headers.sh https://<your-project>.pages.dev
```

Other static hosts work too, but GitHub Pages cannot set custom response headers, so the CSP and HSTS would not be applied there.
