# Landing page

Static files, no build step, no external requests: `index.html`, `style.css`, `app.js`, `favicon.svg`, `404.html`, `robots.txt`,
and `_headers` (security headers, read by Cloudflare Pages and Netlify). The page reuses the dashboard's colour tokens
(`apps/web/src/index.css`), so keep the two in sync if the theme changes. The numbers in "What we measured" come from
`docs/VALIDATION.md`; update both together.

The CSP in `_headers` is strict (`default-src 'none'`, scripts and styles from the same origin only). That is why the page has no inline
CSS, JavaScript or `style=` attributes: keep it that way, or the browser will silently drop them.

## Deploy on Cloudflare Pages

Dashboard: Workers & Pages → Create → Pages → Connect to Git → pick the repository, then:

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
