# Prompt 02 — Auth (KKU SSO via next-auth), Roles, and Core API Layer

> **When to use:** After data model. Establishes KKU SSO, RBAC including DEPT_HEAD, and API conventions.
> **Skills to invoke:** none specific (architecture session)

---

Read `CLAUDE.md` and `GLOBAL-UPDATES.md` first.

Build the authentication and authorization layer plus core API conventions.

### Authentication: KKU SSO via next-auth v5

1. Configure `next-auth` v5 in `apps/web` with two providers:
   - **KKU SSO** as the primary provider:
     - Use the OIDC provider (configurable via env: `KKU_SSO_ISSUER`, `KKU_SSO_CLIENT_ID`, `KKU_SSO_CLIENT_SECRET`, `KKU_SSO_REDIRECT_URI`, `KKU_SSO_SCOPES`)
     - If KKU SSO turns out to be SAML or CAS instead of OIDC, structure the provider config so it can swap easily; document this clearly in `docs/auth/kku-sso.md`
     - On first login, auto-provision a `User` row with claims (sso subject id, email, name, employee id if available, faculty/department codes if available)
     - Map KKU faculty/department codes to our internal `Faculty`/`Department` records via a `KkuOrgCodeMapping` table (seed with mappings between KKU's org codes and our internal IDs)
     - Default role: `VIEWER`. Admins promote.
   - **Credentials provider** (local dev only) — gated by `NODE_ENV !== 'production'` AND `ENABLE_LOCAL_AUTH=true`. Refuses to load otherwise. Produces clear startup error if someone tries to enable in prod.

2. JWT strategy. Token includes: `userId`, `role`, `facultyId`, `departmentId`, `themePreference`.
3. Helpers: `withAuth` (server actions / route handlers), `getSession` (server components), `useSession` (client). All typed.
4. Sign-in page styled per the aesthetic direction from prompt 00. Uses `frontend-design` skill.
5. **Production URL context:** the public URL is `https://program-landscape.kku.ac.th`. KKU's university reverse proxy terminates the public cert and re-encrypts to our server over HTTPS on `:8443` using a self-signed cert. Our internal nginx terminates that and forwards HTTP to the app services inside the docker network. NextAuth must generate callback URLs with the correct public scheme/host: set `NEXTAUTH_URL=https://program-landscape.kku.ac.th` and `AUTH_TRUST_HOST=true` in `.env.prod`. The KKU SSO redirect URI is `https://program-landscape.kku.ac.th/api/auth/callback/kku-sso`. Test that callbacks generate with the correct `https://` scheme even though the Node.js process receives HTTP from our internal nginx.
6. Document KKU SSO setup in `docs/auth/kku-sso.md`:
   - Discovery URL
   - Required scopes
   - Claim mapping table
   - Test users
   - Troubleshooting common issues (clock skew, redirect URI mismatch, etc.)
   - How to point at staging vs production KKU IDP

### RBAC

Roles: `VIEWER`, `COUNCIL`, `EXECUTIVE`, `DEAN`, `DEPT_HEAD`, `ANALYST`, `ADMIN`.

Build a role × permission matrix in `packages/shared/src/auth/permissions.ts`:

- `VIEWER`: read public-aggregated data only; cannot see financial details
- `COUNCIL`: read all aggregated data + scenarios + briefs at all four scopes; cannot see individual faculty member salaries; cannot edit
- `EXECUTIVE`: read all + create/edit scenarios + edit decisions, all scopes
- `DEAN`: full data for own faculty (including departments + programs within); aggregated only for other faculties; create scenarios for own faculty
- `DEPT_HEAD`: full data for own department (including programs within); read-only for own faculty aggregated; aggregated only for other departments
- `ANALYST`: read all data at all scopes; create scenarios; configure ingestion; cannot make decisions
- `ADMIN`: everything including user management, data source config, KKU SSO mapping management

Implement as `can(user, action, resource, scopeContext?)` with explicit permission strings. Examples:
- `programs:read:all`
- `programs:read:own_faculty`
- `programs:read:own_department`
- `financials:read:all`
- `financials:read:aggregated_only`
- `scenarios:create:any`
- `scenarios:create:own_faculty`
- `decisions:approve`
- `users:manage`
- `ingestion:configure`
- `pdf:upload`
- `pdf:approve_extraction`

The function takes `scopeContext` so a check like `can(user, 'programs:read', 'program', { scope: 'department', scopeId: 'dept-cse' })` can resolve correctly.

### API conventions in NestJS (`apps/api`)

1. All endpoints under `/api/v1`
2. Zod schemas (shared via `packages/shared`) for all request/response validation
3. **Every analytical endpoint accepts `scope` and `scopeId` query parameters** validated against the user's permissions
4. Standard response envelope:
   ```ts
   { data: T, meta: { freshnessDate, sources, confidence?, scope: { level, id } }, error: null }
   ```
5. Decorators (build these in `packages/shared/src/api/decorators/`):
   - `@Provenance()` — wraps responses with source metadata
   - `@AuditLog()` — logs every mutation to `AuditLog`
   - `@AiCall()` — wraps AI inferences and writes to `AiInference`
   - `@RequireScope(level)` — validates the requesting user can access the requested scope
   - `@RequirePermission(permission)` — gates the endpoint by RBAC
6. Global exception filter returning standardized errors
7. Rate limiting with `@nestjs/throttler` — strict limits on AI endpoints

### Initial endpoints
- `GET /api/v1/faculties`
- `GET /api/v1/faculties/:id`
- `GET /api/v1/faculties/:id/departments`
- `GET /api/v1/departments/:id`
- `GET /api/v1/departments/:id/programs`
- `GET /api/v1/programs?scope=&scopeId=&filters` with scope-aware filtering
- `GET /api/v1/programs/:id`
- `GET /api/v1/me` (current user, permissions, theme preference, scope access map)
- `PATCH /api/v1/me/theme` (update theme preference)
- `GET /api/v1/data-sources` (admin only)

### Frontend shell

Apply the aesthetic from `docs/design-system.md` (we'll fully build the design system in prompt 02b — for now just enough shell to log in and navigate):

1. App layout: top bar, left nav placeholder, content area
2. Top bar contains: logo, **scope selector** (placeholder — full build in prompt 02b), command palette trigger (Cmd+K hint), user menu (with theme toggle and language toggle for analysis content)
3. Sign-in page with KKU SSO button + (in dev only) credentials form
4. Authenticated home page showing: user info, scopes accessible, KPIs placeholder
5. **All UI labels in English.** Hardcode them for now or use `next-intl` namespace `ui`. (Analysis content i18n comes when modules are built.)
6. Theme provider with light/dark toggle, persists to user preference via `PATCH /me/theme`. System preference as default for new users. No flash of wrong theme on load (use `next-themes` or equivalent SSR-safe approach).

### Tests
- Unit tests for `can()` covering each role × scope combination
- Integration test for one protected endpoint per role
- E2E smoke test: dev login → home → theme toggle → scope switch (placeholder) → logout
- Test that local credentials provider refuses to load in production

### Deliverables
- Folder structure of new code
- Role × permission matrix as a markdown table in `docs/auth/rbac.md`
- KKU SSO setup doc with TODOs marked for real values
- Working sign-in flow (dev credentials), working theme toggle
- 3 suggestions for the next session — my plan is design system (prompt 02b)
