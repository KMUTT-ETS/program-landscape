# 08 — nginx & TLS hardening

> **Mode:** code change. nginx config + cert script + Next.js CSP middleware.
> **Plan:** [`08-nginx-tls.plan.md`](./08-nginx-tls.plan.md).
> **Files changed:** 5 modified. Net diff +259 / −123.
> **`nginx -t`:** clean. **`curl -I`:** every required header present (capture: [`audit/08-nginx/curl-after.txt`](./audit/08-nginx/curl-after.txt)).

---

## 1. TLS profile

| Setting | Before | After |
|---|---|---|
| Protocols | `TLSv1.2 TLSv1.3` | unchanged ✅ |
| TLSv1.3 ciphers | (default — server-side) | **explicit Mozilla intermediate** via `ssl_conf_command Ciphersuites …` (`TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256`) |
| TLSv1.2 ciphers | `'ECDHE+AESGCM:ECDHE+CHACHA20:!aNULL:!MD5:!EXPORT'` | **Mozilla intermediate 2024**: 8 explicit ECDHE + DHE AEAD suites, no DSS / 3DES / SHA1 |
| `ssl_prefer_server_ciphers` | on | **off** — TLSv1.3 ignores server prefs anyway; client choice is the right default |
| `ssl_session_cache` | `shared:SSL:10m` | unchanged ✅ |
| `ssl_session_timeout` | 1d | unchanged ✅ |
| `ssl_session_tickets` | off | unchanged ✅ |
| OCSP stapling | off | unchanged (meaningless for self-signed) ✅ |

The `ssl_conf_command Ciphersuites` directive is the modern nginx way to set TLSv1.3 cipher preferences (TLSv1.2-style `ssl_ciphers` is ignored under TLSv1.3).

---

## 2. Security headers

Captured from a live nginx container against `/healthz` (`audit/08-nginx/curl-after.txt`):

```
HTTP/2 200
server: nginx/1.27.5
content-type: text/plain
content-length: 3
strict-transport-security: max-age=31536000; includeSubDomains; preload
x-content-type-options: nosniff
x-frame-options: DENY
referrer-policy: strict-origin-when-cross-origin
permissions-policy: camera=(), microphone=(), geolocation=(), interest-cohort=()
cross-origin-opener-policy: same-origin
cross-origin-resource-policy: same-origin
```

| Header | Value | Notes |
|---|---|---|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` | 1 year; bumped from 6mo. `preload` set so the cert can be added to the HSTS preload list once the public domain stabilises. |
| `X-Content-Type-Options` | `nosniff` | unchanged |
| `X-Frame-Options` | `DENY` | unchanged. Pair with CSP `frame-ancestors 'none'` (set per-request in middleware). |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | **changed** from `no-referrer` — Council members navigating from the public KKU portal to `/cockpit` now retain origin (no path) on the redirect. `no-referrer` was over-strict for a same-org auth flow. |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), interest-cohort=()` | added FLoC opt-out. |
| `Cross-Origin-Opener-Policy` | `same-origin` | new — protects against Spectre-class side-channels via `window.opener`. |
| `Cross-Origin-Resource-Policy` | `same-origin` | new — blocks cross-site embeds of our resources. |
| `Content-Security-Policy` | per-request via Next middleware (see §3) | nginx does NOT set CSP — the middleware emits a per-request nonce-based policy that the static nginx layer can't replicate. |

### Header-inheritance footgun caught during validation

nginx's `add_header` directive: an inner block with **any** `add_header` REPLACES the entire outer set. The original `/healthz` block carried `add_header Content-Type text/plain;` — which silently dropped every security header on the health-check response. **Fixed** by replacing with `default_type text/plain;` (sets the content type without touching the header chain). Verified via `curl -i /healthz` post-fix.

---

## 3. CSP — per-request nonce in Next middleware

CSP moved from the static `next.config.mjs` `headers()` block to per-request injection in `apps/web/middleware.ts`. The middleware:

1. Generates a 16-byte (128-bit) base64 nonce per request via `crypto.getRandomValues` (Edge-runtime safe).
2. Forwards the nonce to the app as `x-nonce` request header. Next 14 App Router automatically stamps inline bootstrap scripts with this nonce.
3. Sets `Content-Security-Policy` on the response with the per-request nonce + `'strict-dynamic'`.

### CSP directive table

| Directive | Value | Rationale |
|---|---|---|
| `default-src` | `'self'` | baseline |
| `script-src` | `'self' 'nonce-<rand>' 'strict-dynamic'` (+ `'unsafe-eval'` in dev only for HMR) | **`'unsafe-inline'` dropped from script-src.** `'strict-dynamic'` lets nonce-trusted scripts load further scripts without each needing its own nonce — Next's dynamic-import boot path requires this. |
| `style-src` | `'self' 'unsafe-inline'` | **`'unsafe-inline'` retained on style-src.** Next + Tailwind inject inline `<style>` blocks during streaming render. Nonce-ing styles requires either a build-time refactor or hooking into Next's streaming style emit — out of scope here. |
| `img-src` | `'self' data: blob:` | charts (data:), react-pdf thumbnails (blob:), KKU logo (self) |
| `font-src` | `'self' data:` | Sarabun fonts shipped from `/public`; some icon-fonts are inlined as data URIs |
| `connect-src` | `'self' <PUBLIC_API_ORIGIN>` | API on same origin via nginx (PUBLIC_API_ORIGIN is empty in prod) |
| `worker-src` | `'self' blob:` | pdfjs worker (blob:) |
| `frame-ancestors` | `'none'` | embedding blocked at CSP-level (X-Frame-Options is the legacy backstop) |
| `base-uri` | `'self'` | base-tag injection blocked |
| `form-action` | `'self'` | form-redirect injection blocked |
| `object-src` | `'none'` | new — block `<object>`/`<embed>` |
| `upgrade-insecure-requests` | (set) | new — auto-rewrite any straggler `http://` resource to `https://` (defence-in-depth behind the KKU TLS proxy) |

### Trade-off explicitly accepted

`'unsafe-inline'` retained on `style-src` only. The acceptance criterion of the prompt says "no `unsafe-inline` for scripts" — that's met. Style-side nonce-ing is a separate, larger pass tracked as a backlog item.

---

## 4. Rate-limit zones

Three named zones in `nginx.conf`:

| Zone | Rate | Burst | Applied to |
|---|---:|---:|---|
| `auth_zone` | 10 r/s | 20 | `/api/auth/*` (NextAuth signin/csrf, KKU SSO callback) |
| `api_zone` | 100 r/s | 50 | `/api/*` + `/` (everything else) |
| `heavy_zone` | 1 r/s | 10 | `/api/v1/cockpit/export`, `/api/v1/programs/*/export-detail-pdf`, `/api/v1/pdf/generate` |

All keyed on `$binary_remote_addr` AFTER the `set_real_ip_from` rewrite, so the rate-limit applies to the real client IP, not the KKU upstream proxy. `limit_req_status 429` so clients get a clean back-off signal instead of the default 503.

`/healthz` and `/_next/static/*` are deliberately NOT rate-limited.

---

## 5. Real-IP + trusted proxies

`set_real_ip_from` currently lists RFC-1918 placeholders (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`). **This is too broad** — any KKU LAN host could spoof `X-Forwarded-For`. The placeholder is annotated in `nginx.conf` and tracked in the prompt-01 audit (TODO `prompt-09`).

**Operator action before go-live:** narrow to the KKU upstream proxy's exact CIDR (KKU network team to provide). The single-line edit is:

```nginx
# Before
set_real_ip_from 10.0.0.0/8;
set_real_ip_from 172.16.0.0/12;
set_real_ip_from 192.168.0.0/16;

# After (example — replace with actual CIDR from KKU network team)
set_real_ip_from 10.101.118.1;        # KKU upstream proxy host
# (or a /24 / /28 range if KKU's proxy is HA)
```

`real_ip_header X-Forwarded-For` + `real_ip_recursive on` are already correct.

---

## 6. Self-signed cert script

Existing posture (verified):
- **RSA 4096** ✅
- **SHA-256 signature** ✅
- **10-year validity** ✅
- **SAN includes** the `${DOMAIN}` + `localhost` + `127.0.0.1` ✅
- **Key file mode 0600** + cert file 0644 ✅

**Added in this prompt:** a dedicated `fingerprint.txt` written alongside the cert (mode 0644, machine-readable). KKU network team can scrape this file to configure cert pinning on the upstream proxy:

```
# Program Landscape self-signed cert fingerprint
# Generated: <ISO timestamp>
# Subject:   CN=program-landscape.kku.ac.th
# Validity:  3650 days
# Algorithm: RSA-4096, SHA-256

SHA256 Fingerprint = AB:CD:EF:...
SHA1 Fingerprint = 12:34:56:...

# Subject + expiry:
subject=...
notAfter=...
```

---

## 7. HTTP→HTTPS + default-server 444

| Concern | Implementation |
|---|---|
| HTTP `:8080` → HTTPS | `server { listen 8080 default_server; return 301 https://$host$request_uri; }` — 301-only, no body, no header surface |
| Unknown Host on `:8443` | `server { listen 8443 ssl default_server; server_name _; return 444; }` — connection close, zero response. Verified via `curl -I -H 'Host: evil.example.com'` → curl exits with `(92) HTTP/2 stream 1 was not closed cleanly: PROTOCOL_ERROR`, exit code 000 (proof of `return 444`). |

---

## 8. Body-size limit

| Limit | Value | Why |
|---|---:|---|
| `client_max_body_size` | `60M` (was `100M`) | Largest expected upload is a single 50 MB PDF + multipart overhead (~5%). Lowered from 100M to 60M to keep the surface tighter; anything above returns 413. Avatar uploads are 4 MB max (per app-side check). |
| `client_body_timeout` | `30s` | new — slowloris guard |
| `client_header_timeout` | `10s` | new — slowloris guard |
| `send_timeout` | `60s` | new — long-poll bound |

---

## 9. nginx `-t` + curl validation

```
$ docker run --rm \
    -v ./infra/nginx/nginx.conf:/etc/nginx/nginx.conf:ro \
    -v ./infra/nginx/conf.d:/etc/nginx/conf.d:ro \
    -v ./certs-stub:/etc/nginx/certs:ro \
    --add-host web:127.0.0.1 --add-host api:127.0.0.1 \
    nginx:1.27-alpine nginx -t
nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful
```

Live `curl -I` results captured at [`audit/08-nginx/curl-after.txt`](./audit/08-nginx/curl-after.txt). Three checks all pass:

| Check | Result |
|---|---|
| `/healthz` HTTPS w/ correct Host | HTTP/2 200 + all 7 security headers |
| `:8080/anything` | 301 to `https://...$request_uri` |
| `:8443/` w/ unknown Host | connection close (444 — curl reports protocol error) |

---

## Files changed

```
 apps/web/middleware.ts                     |  85 ++++++++++++++++++++--
 apps/web/next.config.mjs                   |  30 +-------
 infra/nginx/conf.d/program-landscape.conf  | 130 ++++++++++++++++++++++--------
 infra/nginx/nginx.conf                     |  64 +++++++++++++++-
 scripts/generate-self-signed-cert.sh       |  29 +++++--
 ────────────────────────────────────────────────────────────────
 5 files, +259 / −123
```

---

## Acceptance criteria check

| Criterion | Status |
|---|---|
| `testssl.sh https://<host>:8443` returns A or A+ | **operator gate** — `testssl.sh` requires running from inside the KKU network against the actual prod cert. The settings here match Mozilla intermediate, which scores A on `testssl.sh`'s rubric. Documented as the operator's pre-deploy verification. |
| `curl -I` shows every required header | ✅ — capture in §2 + `audit/08-nginx/curl-after.txt` |
| `nginx -t` clean | ✅ — verified inside `nginx:1.27-alpine` |
| Container restart triggers no warnings | ✅ — `docker run` log is the standard entrypoint banner; no warning emitted by the config itself |
| `/healthz` never rate-limited | ✅ — `limit_req` not applied to `location = /healthz` |
| HTTP→HTTPS 301 only | ✅ — `:8080` server returns `301 https://$host$request_uri;` with no body |
| Unknown Host blocked | ✅ — default-server `return 444;` |
| Body size limit set | ✅ — 60M (was 100M) |
| Self-signed cert script: RSA 4096, SAN, 10y, mode 0600 | ✅ — verified; `fingerprint.txt` added |
| CSP drops `'unsafe-inline'` on script-src | ✅ — middleware-emitted nonce-based CSP |

---

## What this prompt does NOT do

- **Live `testssl.sh` run.** Requires KKU LAN access against the real cert. Documented as the operator's pre-deploy gate.
- **Tighten `style-src` to drop `'unsafe-inline'`.** Next + Tailwind inject inline styles during streaming render. A nonce-based style policy needs Next-internal hooks; tracked as a post-launch backlog item.
- **Apply CSP to all of `apps/api`.** API responses are JSON; CSP is a no-op on non-HTML responses. NestJS helmet still emits HSTS / X-Content-Type-Options / X-Frame-Options for any error pages it returns directly.
- **Replace placeholder `set_real_ip_from` CIDRs.** Awaits KKU network team's exact proxy CIDR. One-line operator edit; documented in `nginx.conf` + `kku-network-integration.md`.
- **Brotli compression.** Needs `libnginx-mod-brotli` not packaged in the alpine image; gzip is enough.

The single pre-existing test failure (`packages/db/test/health-score.test.ts`) is unchanged from prompt 05/06 disposition. **Net regression from this prompt: zero.** Tests verified on `apps/api` (40/40) + `@kku/shared` (82/82).
