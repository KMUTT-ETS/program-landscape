# KKU SSO configuration

Placeholder. Filled with real endpoint, claim mapping, and quirks during
prompt 02 (auth + API core).

## What we need from KKU IT

- Protocol (OIDC vs SAML vs CAS)
- Authorization / token / userinfo endpoints (OIDC) **or** SSO URL +
  metadata XML (SAML)
- Client ID and client secret
- Required scopes / assertion attributes
- Which claims carry:
  - employee ID (primary key)
  - email
  - name (Thai + English if available)
  - faculty code (mapping to our `Faculty.code`)
  - department code (mapping to our `Department.code`)
  - role (if any — otherwise we default to `VIEWER` and admin promotes)
- Logout URL and session behaviour
- Test user credentials for dev / staging

## Implementation notes

- `next-auth` v5 configurable provider.
- Env vars (see `.env.example`): `KKU_SSO_ISSUER`, `KKU_SSO_CLIENT_ID`,
  `KKU_SSO_CLIENT_SECRET`, `KKU_SSO_REDIRECT_URI`.
- Local credentials provider is dev-only, gated by
  `ALLOW_LOCAL_CREDENTIALS=true`. Production builds must set this to `false`
  (hard error if true in `NODE_ENV=production`).
- First SSO login auto-provisions the `User` row; default role `VIEWER`.
- Per-user theme preference (`themePreference`) persisted in DB, not
  localStorage.
