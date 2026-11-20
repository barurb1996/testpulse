#!/usr/bin/env bash
# Usage: ./check-headers.sh https://your-site.pages.dev
# Fails if a deployed site is missing the security headers defined in _headers.
set -euo pipefail
url="${1:?usage: $0 <url>}"
headers="$(curl -sSI -m 15 "$url")"
status=0
for h in content-security-policy x-content-type-options x-frame-options referrer-policy permissions-policy strict-transport-security cross-origin-opener-policy; do
  if grep -qi "^$h:" <<<"$headers"; then echo "ok       $h"; else echo "MISSING  $h"; status=1; fi
done
grep -qi "script-src 'self'" <<<"$headers" && ! grep -qi "unsafe-inline" <<<"$headers" && echo "ok       CSP has no unsafe-inline" || { echo "CHECK    CSP missing or allows unsafe-inline"; status=1; }
exit $status
