# KKU SSO — configuration and troubleshooting

Next-auth v5 is wired to accept KKU's SSO as an OIDC provider. This doc
captures every value we need from KKU IT, the claim mapping we assume, and
the common failure modes.

Status: **configured but not yet tested against a real KKU IDP.** The
provider loads only when `KKU_SSO_ISSUER` and `KKU_SSO_CLIENT_ID` are set;
with them unset, the sign-in page hides the SSO button entirely.

## What we need from KKU IT

Fill these values into `.env` (dev) / `.env.prod` (production):

| Env var | What it is | Example |
|---|---|---|
| `KKU_SSO_ISSUER` | OIDC discovery URL root (serves `/.well-known/openid-configuration`) | `https://sso.kku.ac.th` |
| `KKU_SSO_CLIENT_ID` | Registered client id | `program-landscape-prod` |
| `KKU_SSO_CLIENT_SECRET` | Client secret | (opaque) |
| `KKU_SSO_REDIRECT_URI` | Must match what's registered at KKU IdP | `https://program-landscape.kku.ac.th/api/auth/callback/kku-sso` |
| `KKU_SSO_SCOPES` | Space-separated OIDC scopes | `openid profile email` |

Ask KKU IT for:

- Discovery URL (`$ISSUER/.well-known/openid-configuration`)
- Supported `response_type`s (we use `code`)
- Token endpoint auth method (default `client_secret_basic`; some IdPs
  require `client_secret_post` — configurable)
- Which claims carry: subject, email, name, employee id, faculty code,
  department code
- Whether claims come in the id_token or via userinfo endpoint
- Test users for staging
- Whether they use OIDC, SAML, or CAS

**If it's SAML or CAS rather than OIDC:** swap the provider block in
`apps/web/src/lib/auth.ts`. The config is isolated to the one `providers`
array; the rest of the auth pipeline (JWT encode/decode, callbacks,
auto-provisioning) stays unchanged.

## Claim mapping (assumed)

The auto-provisioning path (`src/lib/auth/provisioning.ts`) reads:

| OIDC claim | Maps to |
|---|---|
| `sub` | `User.ssoSubject` (unique key) |
| `email` | `User.email` (unique key; fallback match for pre-provisioned users) |
| `name` | `User.name` |
| `employee_id` | (stored in audit logs only — not on User yet) |
| `faculty_code` | Resolves to `User.facultyId` via `KkuOrgCodeMapping` |
| `department_code` | Resolves to `User.departmentId` via `KkuOrgCodeMapping` |

If KKU uses different claim names, update `OidcProfileClaims` in
`src/lib/auth/provisioning.ts`. The seeded `KkuOrgCodeMapping` rows are
**development values** — real KKU codes come from KKU IT.

## JWT format

We override next-auth's default JWE with a **signed HS256 JWT** so the
NestJS API can verify tokens without shared decryption keys.

- Algorithm: `HS256`
- Signing key: `NEXTAUTH_SECRET` (same secret on web + api)
- Session duration: 30 days

The payload is `SessionUserSchema` from `@kku/shared`:
`userId`, `email`, `name`, `role`, `facultyId`, `departmentId`,
`themePreference`, plus `iat` / `exp` injected by jose.

## Production URL context

Public URL: `https://program-landscape.kku.ac.th`

The network path (two TLS hops):

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

For next-auth to emit the correct `https://program-landscape.kku.ac.th`
callback URLs from inside the HTTP-terminated container:

```
NEXTAUTH_URL=https://program-landscape.kku.ac.th
AUTH_TRUST_HOST=true
```

For NestJS audit logs to record the real remote IP rather than the
loopback address of our nginx:

```ts
app.getHttpAdapter().getInstance().set('trust proxy', 1);  // main.ts
```

## Staging vs production

Keep two sets of IdP credentials. Use `KKU_SSO_ISSUER_STAGING` /
`KKU_SSO_CLIENT_ID_STAGING` only if the staging IdP is a separate issuer;
otherwise register two clients at the same KKU IdP — one for staging and
one for production, each with its own redirect URI.

Redirect URIs to register with KKU IT:

- Dev:     `http://localhost:3000/api/auth/callback/kku-sso`
- Staging: `https://staging.program-landscape.kku.ac.th/api/auth/callback/kku-sso`
- Prod:    `https://program-landscape.kku.ac.th/api/auth/callback/kku-sso`

## Troubleshooting

### "redirect_uri_mismatch"

The IdP sees a callback URL that isn't in its allow-list. Causes:

- `NEXTAUTH_URL` mismatch with the browser-visible host
- Missing `AUTH_TRUST_HOST=true` when behind a reverse proxy
- Trailing slash or `http://` vs `https://` mismatch at the IdP

Fix: compare what KKU IT has registered against exactly what Next.js is
sending (log the redirect parameter on the failing request).

### "invalid_client" / 401 at the token endpoint

Wrong client id or secret; or the IdP expects `client_secret_post` but
we're sending `client_secret_basic` (or vice versa). Set the
`token_endpoint_auth_method` in the provider config in `auth.ts`.

### Clock skew (id_token "issued in the future")

The JWT `iat`/`exp` checks fail if the two servers drift more than a few
seconds apart. Enable NTP on the prod server; as a workaround, widen the
leeway in jose via `jwtVerify(... , { clockTolerance: '30s' })`.

### Claims missing

If `faculty_code` / `department_code` don't appear in the profile, the
auto-provisioner stores the user with `facultyId: null` —
`can('…:own_faculty')` will then deny them cleanly. Admin can populate
the scope later via `/admin/users` (prompt 13).

### First-login infinite loop

If the jwt callback throws (e.g. DB unreachable when provisioning), next-
auth loops back to signin. Watch the Next.js server logs and check
Postgres connectivity. The callback currently throws on missing email
claim; KKU IT sometimes returns email only via userinfo, so ensure the
`openid profile email` scopes are requested and the userinfo endpoint is
reachable.

### Local auth refuses to load

If `ENABLE_LOCAL_AUTH=true` is set with `NODE_ENV=production`, the module
throws at load. This is intentional — see
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
