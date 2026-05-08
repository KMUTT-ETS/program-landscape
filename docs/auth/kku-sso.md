# KKU SSO — configuration and troubleshooting

KKU's institutional sign-on service is **SSONext** — a custom protocol
maintained by KKU IT. **It is NOT OIDC**, despite the surface similarity.
This doc captures the wire shape, our env config, and the common failure
modes.

Status: **wired and probe-tested against the UAT-Stage endpoints (2026-05-08).**
End-to-end browser sign-in is unblocked once KKU IT confirms the redirect URI
is registered.

> **Important — protocol clarification.** SSONext does NOT serve a
> `/.well-known/openid-configuration` document, does NOT use OAuth 2.0
> form-encoded token exchange, and does NOT use OIDC claim names. An earlier
> revision of this doc described an OIDC integration; that wiring would
> never have connected. The current implementation in
> `apps/web/src/lib/auth/kku-sso-client.ts` is built directly against
> SSONext's published shape.

## Wire protocol

UAT-Stage hosts (production endpoints will follow the same shape on
different domains):

```
WEB base:  https://sso-uat-web.kku.ac.th
API base:  https://sso-uat-api.kku.ac.th
```

### 1. Browser redirect (login)

```
GET ${WEB_BASE}/login?app=<AppID>
```

`<AppID>` is one of three values KKU IT issues per service (App ID,
Client ID, Client Secret). The browser is redirected here and KKU
shepherds it back via:

```
GET ${REDIRECT_URI}?code=<uuid>
```

The `code` is a UUID-shaped session handle.

### 2. Token exchange (server-to-server)

```
POST ${API_BASE}/auth.token
Content-Type: application/json

{
  "code": "<code from browser callback>",
  "redirectUrl": "<KKU_SSO_REDIRECT_URI>",
  "clientId": "<KKU_SSO_CLIENT_ID>",
  "clientSecret": "<KKU_SSO_CLIENT_SECRET>"
}
```

**Response (success — HTTP 200):**

```json
{
  "ok": true,
  "accessToken": "...",
  "email": "...",
  "immutableId": "...",
  "citizenId": "...",
  "firstName": "...",
  "lastName": "...",
  "employeeId": "..."
}
```

**Response (logical failure — also HTTP 200):**

```json
{ "ok": false, "error": "AUTH0001" }
```

Both branches return HTTP 200; the `ok` field is the discriminator. The
client must read it and raise on `false`.

### 3. Profile fetch

```
POST ${API_BASE}/user.profile
Authorization: Bearer <accessToken>
```

Returns `{ ok: true, profile: { email, userId, firstname, lastname,
firstnameEng, lastnameEng, facultyName, positionName, positionTypeName,
levelId, levelName, gender, workline, phoneNumber, personStatus, ... } }`.

`facultyName` is the only org signal. We resolve it against
`Faculty.nameTh` (exact match) in `provisionFromSsonext()`. There is no
department code or faculty code claim.

### 4. Logout

```
GET ${WEB_BASE}/logout?app=<AppID>
```

Browser redirects back to `KKU_SSO_LOGOUT_REDIRECT_URI` after the
session is killed at KKU.

## Env vars

Filled in `.env` (dev) / `.env.prod` (production):

| Env var | What it is | Example |
|---|---|---|
| `KKU_SSO_WEB_BASE` | Browser-facing host (login + logout) | `https://sso-uat-web.kku.ac.th` |
| `KKU_SSO_API_BASE` | Server-to-server host (token + profile) | `https://sso-uat-api.kku.ac.th` |
| `KKU_SSO_APP_ID` | Used in the login URL `?app=<AppID>` | `019e0556-...` |
| `KKU_SSO_CLIENT_ID` | Used in the token exchange JSON body | `019e0556-...` |
| `KKU_SSO_CLIENT_SECRET` | Used in the token exchange JSON body | (opaque 64-char) |
| `KKU_SSO_REDIRECT_URI` | Must match what KKU IT has registered | `http://10.101.111.233:3000/api/auth/callback/kku-sso` |
| `KKU_SSO_LOGOUT_REDIRECT_URI` | Where KKU sends the user after logout | `http://10.101.111.233:3000/signin?signout=1` |

`KKU_SSO_APP_ID` and `KKU_SSO_CLIENT_ID` may share the same value at
KKU's discretion (they do at UAT). Keep them as separate env vars so
the implementation is clean if KKU ever issues distinct values.

Ask KKU IT for:

- Production WEB + API hosts (probably `sso.kku.ac.th` and `api-sso.kku.ac.th`)
- AppID + Client ID + Client Secret per environment
- Confirmation that the redirect URI is registered for each env
- Test users for staging
- The error-code table (we currently only know `AUTH0001` empirically)

## Browser flow

```
/signin
  └── click "Continue with KKU SSO"
        └── GET /api/auth/kku-sso/start?from=/cockpit
              └── 302 Set-Cookie: kku-sso-from=/cockpit
                       Location: https://sso-uat-web.kku.ac.th/login?app=<AppID>
                    └── KKU login page
                          └── on success: 302 to ${KKU_SSO_REDIRECT_URI}?code=<uuid>
                                └── GET /api/auth/callback/kku-sso?code=<uuid>
                                      ├── POST /auth.token        (server-side)
                                      ├── POST /user.profile      (server-side)
                                      ├── provisionFromSsonext()  (DB upsert)
                                      ├── encodeJwt(SessionUser)  (HS256, our codec)
                                      └── 302 Set-Cookie: authjs.session-token=<jwt>
                                               Location: /cockpit
```

Files:

- `apps/web/app/api/auth/kku-sso/start/route.ts` — bounce
- `apps/web/app/api/auth/callback/kku-sso/route.ts` — exchange + cookie
- `apps/web/src/lib/auth/kku-sso-client.ts` — Zod-typed wire client
- `apps/web/src/lib/auth/provisioning.ts` — User upsert from SSONext profile
- `apps/web/src/lib/auth/jwt-codec.ts` — HS256 JWT (shared with NestJS API)

The two route files are static-segment overrides of NextAuth's
`[...nextauth]` catch-all and run on the Node.js runtime.

## Claim mapping

`provisionFromSsonext()` reads:

| SSONext field | Maps to |
|---|---|
| `immutableId` (token payload) | `User.ssoSubject` (unique key, primary) |
| `email` (profile preferred, token payload fallback) | `User.email` (unique key; fallback match) |
| `firstnameEng` + `lastnameEng` (English name) → fallback to `firstName` + `lastName` | `User.name` |
| `facultyName` | Resolved via `Faculty.nameTh` exact match → `User.facultyId` |
| (nothing) | `User.departmentId` — always null at first login |
| (nothing) | `User.role` — defaults to `VIEWER` |

`KkuOrgCodeMapping` is no longer used for SSO — it was an OIDC-era
table for resolving org codes that SSONext does not emit. The seeded
rows can stay for any future analyst-facing lookups, but the runtime
SSO path doesn't read them.

If `Faculty.nameTh` doesn't exact-match the SSONext `facultyName`
(typo upstream, faculty not yet seeded, English-only string), the
user lands with `facultyId: null` and `can('…:own_faculty')` denies
them cleanly. Admin can populate the scope later via `/admin/users`.

## JWT format

We override NextAuth's default JWE with a **signed HS256 JWT** so the
NestJS API can verify tokens without shared decryption keys.

- Algorithm: `HS256`
- Signing key: `NEXTAUTH_SECRET` (same secret on web + api)
- Session duration: 30 days
- Payload: `SessionUserSchema` from `@kku/shared`
  (`userId`, `email`, `name`, `role`, `facultyId`, `departmentId`,
  `themePreference`, plus `iat` / `exp` injected by jose)

Implemented in `apps/web/src/lib/auth/jwt-codec.ts`. Both the dev-
credentials path (NextAuth Credentials provider) and the SSONext path
(our manual callback route) write the same cookie format.

## Production URL context

Public URL: `https://program-landscape.kku.ac.th`

```
browser ──TLS (KKU public cert)──▶ KKU reverse proxy
                                     │
                                     ├── proxy_ssl_verify off (or SHA-256 pinned)
                                     ▼
         TLS (self-signed) ──▶ our nginx  :8443
                                     │
                                     ▼
         HTTP ──▶ next.js (web) :3000  /  nestjs (api) :4000
```

For NextAuth + our callback route to emit the correct
`https://program-landscape.kku.ac.th` URLs from inside the
HTTP-terminated container:

```
NEXTAUTH_URL=https://program-landscape.kku.ac.th
AUTH_TRUST_HOST=true
KKU_SSO_REDIRECT_URI=https://program-landscape.kku.ac.th/api/auth/callback/kku-sso
```

For NestJS audit logs to record the real remote IP rather than the
loopback address of our nginx:

```ts
app.getHttpAdapter().getInstance().set('trust proxy', 1);  // main.ts
```

## Probe

`apps/web/scripts/probe-kku-sso.mjs` exercises all four endpoints with
your `.env` credentials. Run after any config change:

```
node apps/web/scripts/probe-kku-sso.mjs
```

Expected output: 4 ✓ checks. The token endpoint is allowed to fail with
`ok:false, error:"AUTH0001"` (or similar) — that's the protocol working
correctly when it rejects a fabricated session id. The probe knows.

## Staging vs production

Keep two sets of credentials. KKU IT registers two clients at the
SSONext IdP — one per environment, each with its own redirect URI.

Redirect URIs to register:

- Dev:     `http://localhost:3000/api/auth/callback/kku-sso`
- Staging: `https://staging.program-landscape.kku.ac.th/api/auth/callback/kku-sso`
- Prod:    `https://program-landscape.kku.ac.th/api/auth/callback/kku-sso`

Note KKU's UAT-Stage IdP does accept `http://10.101.111.233:3000/...`
(LAN IP, no TLS) for our dev environment — most external IdPs would
reject this.

## Troubleshooting

### "Cannot find the session ..." when calling `/auth.token`

Either the code expired (KKU's session windows are short — exchange
must happen within seconds of receiving the redirect), or the
`redirectUrl` in the JSON body doesn't byte-for-byte match the URL
KKU registered. Worth double-checking trailing slashes and `http`
vs `https`.

### `redirect_uri_mismatch` (or its KKU equivalent)

The IdP sees a callback URL that isn't in its allow-list. Causes:

- `KKU_SSO_REDIRECT_URI` mismatch with the browser-visible host
- Trailing slash or `http://` vs `https://` mismatch at the IdP

Fix: compare what KKU IT has registered against exactly what we send.

### `invalid_client` / 401 at the token endpoint

Wrong Client ID or Client Secret. Re-check the Client Secret was
copied without a trailing newline or quote.

### `/user.profile` returns 401

The `accessToken` returned by `/auth.token` was rejected. Most common
cause: the token was already used in a previous request and expired
on KKU's side, or our request omitted the `Bearer ` prefix in the
Authorization header.

### Clock skew (id_token "issued in the future")

Doesn't apply to SSONext directly — there's no signed id_token. Our
own JWT (HS256) does check `iat`/`exp`, so if the dev machine drifts
significantly from the prod server's clock you'll see "Invalid token"
on the NestJS side. Enable NTP on the prod server.

### First-login infinite loop

If `provisionFromSsonext()` throws (e.g., DB unreachable, or email
claim missing), the callback redirects back to `/signin?error=...`
and the browser retries — looking like a loop. Watch the Next.js
server logs for the underlying error. The function refuses to
provision a User without an email, so the most common real failure is
an SSONext profile that comes back without `email` populated.

### Local auth refuses to load

If `ENABLE_LOCAL_AUTH=true` is set with `NODE_ENV=production`, the
module throws at load. Intentional — see
`apps/web/src/lib/auth/env-guard.ts`. Unset the var on prod deploys.

## Test users (dev only)

Seeded in `packages/db/prisma/seed.ts`. All passwords: `kku-dev`.

| Email | Role |
|---|---|
| `admin@kku.ac.th` | ADMIN |
| `council@kku.ac.th` | COUNCIL |
| `exec@kku.ac.th` | EXECUTIVE |
| `dean.en@kku.ac.th` | DEAN (Faculty of Engineering) |
| `dh.cpe@kku.ac.th` | DEPT_HEAD (Computer Engineering) |
| `analyst@kku.ac.th` | ANALYST |
| `viewer@kku.ac.th` | VIEWER |
