# Plan — Prompt 08: nginx & TLS hardening

**Mode:** code change. Internal nginx + cert script. No app-level CSP changes beyond what's required to drop `'unsafe-inline'` on script-src.

## Reads

- `infra/nginx/nginx.conf` (already read prompts 01 + 03 + 07).
- `infra/nginx/conf.d/program-landscape.conf` (same).
- `scripts/generate-self-signed-cert.sh` (need to re-open).
- `apps/web/next.config.mjs` — current CSP shape; what `unsafe-inline` removal would touch.

## Order of work

1. **`scripts/generate-self-signed-cert.sh`** — confirm RSA 4096 + SAN + 10y + key 0600; emit `certs/fingerprint.txt` for KKU network-team pinning. Add a verbose summary at the end.
2. **`infra/nginx/conf.d/program-landscape.conf`** — TLS profile (TLSv1.2/1.3 + Mozilla intermediate ciphers), HSTS preload, CSP `frame-ancestors`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` minimum, body-size limit (60 MB = 50 MB PDF + 10 MB headroom for multipart overhead), default 444 server, HTTP→HTTPS 301-only, real-ip from KKU proxy CIDR (placeholder retained — to be replaced by ops at first deploy).
3. **`infra/nginx/nginx.conf`** — `limit_req_zone` definitions + `set_real_ip_from` placeholder annotated. Body-size at the http{} level too.
4. **CSP nonce.** This is the trickiest item. Next 14's standalone runtime emits inline script tags for client-component hydration; without `'unsafe-inline'` on `script-src`, hydration breaks. The standard mitigation is per-request nonces injected via Next's middleware (`nonce` cookie) + `style-src 'self' 'unsafe-inline'` (we keep style-src loose since Tailwind injects inline `style=""` attributes for dynamic class merges). Implement minimal nonce middleware for `/` so `unsafe-inline` only stays on style-src.
5. **`docker compose run nginx -t`** to validate the conf.
6. **Capture `curl -I`** against the running container (or a syntax-only validation if compose-up is heavy).
7. **Report**: headers matrix + rate-limit zones table + before/after `curl -I`.

## Acceptance check

- `nginx -t` clean inside the alpine image.
- `curl -I https://localhost:8443/healthz -k` shows: `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `Content-Security-Policy` (or it's set further upstream by Next for HTML responses).
- `curl -I https://localhost:8080/anything -k` returns 301 to https.
- `curl -I https://localhost:8443/ -H 'Host: evil.example.com'` returns 444 (or connection close).

## Out of scope

- Running `testssl.sh` from inside KKU network (operator gate; not reachable from this dev machine). The acceptance gate lists the testssl test as the operator's pre-deploy verification — we list the expected output and the validation we can run locally.
- Replacing the self-signed cert with a CA-issued cert (KKU upstream terminates the public cert; the self-signed is only for the KKU-proxy ↔ us hop).
- Brotli compression (deliberate skip per nginx.conf comment — needs `libnginx-mod-brotli` apt package not in the alpine image).
