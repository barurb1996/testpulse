# Landing page

A single static file (`index.html`): no build step, no dependencies, no external requests. It reuses the dashboard's colour tokens
(`apps/web/src/index.css`), so keep the two in sync if the theme changes.

Deploy by serving this directory from any static host (GitHub Pages, Cloudflare Pages, Netlify, S3 + CDN).
Set a Content-Security-Policy at the host; the page needs `style-src 'unsafe-inline'`, `script-src 'unsafe-inline'` and `img-src data:`
(inline style and script, data-URI favicon), or move the inline blocks to files and tighten it.

The numbers in the "What we measured" section come from `docs/VALIDATION.md`; update both together.
