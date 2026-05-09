# Plan — Prompt 04: Endpoint authorization matrix

**Mode:** read-only audit. **No** code changes; **no** decorators added.

## Inputs

- All `apps/api/src/**/*.controller.ts` (31 controllers).
- All `apps/web/app/api/**/route.ts` (29 route handlers).
- NextAuth callbacks (`apps/web/src/lib/auth.ts`, `apps/web/app/api/auth/[...nextauth]/route.ts`, the SSONext start + callback routes).
- Guards (`apps/api/src/common/{jwt-auth,access,ai-quota,data-export}.guard.ts`).
- Permission catalog (`packages/shared/src/auth/{permissions,roles}.ts`).
- Role + scope model: `User` table (Prisma) + `UserScope` extension.
- Web middleware (`apps/web/middleware.ts`).

## Method

For each route in api + web:

1. **Method + path** — extract from `@Controller(prefix) + @Get/@Post/@Patch/@Delete/@Put` (Nest) or `export async function GET/POST/...` (Next).
2. **Auth required?** — every Nest route is `@Public()` OR JwtAuthGuard-gated by default (global guard); every Next handler reads the session via `auth()` or via cookie.
3. **Required permission** — from `@Authorized(...)` / `@RequirePermission(...)` decorator.
4. **Required role** — derived from the permission via `ROLE_PERMISSIONS` mapping; record the *minimum role* that holds it.
5. **Scope context** — `@RequireScope()` decorator + `:own_faculty` / `:own_program` / `:all` suffix.
6. **Row-level filter applies?** — does the service explicitly filter results by the caller's scope?

## Method (Next.js)

Each handler is read for: `auth()` call, role check (e.g., `if (session.user.role !== 'ADMIN')`), and what backend it forwards to. The `proxy/*` and `admin-*` paths are thin Next handlers fronting NestJS — the auth contract is whatever the Next side enforces (since it strips/re-adds auth headers).

## Deliverable shape

`docs/hardening/04-authz-matrix.report.md`:

1. **Methodology** — guard chain, role taxonomy, scope semantics.
2. **API matrix** — one row per Nest route. ~150–200 rows.
3. **Web matrix** — one row per Next route handler.
4. **Auth-bypass / public-route audit** — every `@Public()` + every `auth()`-bypassing handler.
5. **Violations** — sorted by severity (critical / high / medium / low / info).
6. **Fix proposals** — one per violation: exact decorator(s) to add, file:line.
7. **Acceptance check** — every route appears exactly once.

## Out of scope

- Applying decorator changes (prompt 05).
- Modifying `permissions.ts` taxonomy.
- Writing new tests.
