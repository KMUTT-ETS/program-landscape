# Plan — Prompt 01: Security inventory & threat surface map

**Mode:** read-only audit. No code changes, no dep upgrades, no test runs.

## Inputs read first

- `docs/production-infrastructure.md` ✅
- `docs/architecture.md` ✅
- `docs/security-review.md` ✅
- `docs/auth/kku-sso.md` ✅
- `docs/pdpa.md` ✅
- `docker-compose.prod.yml` ✅
- `infra/nginx/nginx.conf` + `infra/nginx/conf.d/*` (next)
- `apps/api/src/main.ts` + `apps/web/middleware.ts` (next)
- `packages/shared/src/auth/permissions.ts` (for role catalog)

## Structural reads (additional, narrow)

- `apps/api/src/app.module.ts` — guard + interceptor chain.
- `apps/ingestion/src/main.ts` — what surface (if any) it exposes.
- `apps/api/src/common/*guard.ts` — JwtAuthGuard / AccessControlGuard /
  AiQuotaGuard / DataExportGuard.

## Output sections

1. **Asset & data classification table** — every datastore + table family
   from `docs/architecture.md` mapped to {Public, Internal, Confidential,
   Restricted} × PDPA category.
2. **Trust-boundary diagram (mermaid)** — KKU upstream proxy → our nginx
   → web/api/ingestion → datastores → outbound third-party APIs and
   internal DB mirrors. Numbered hops.
3. **STRIDE-lite threat table** — one row per (boundary, STRIDE class)
   pair where applicable. Each row: threat → existing control → TODO
   if missing.
4. **Role catalog** — VIEWER / COUNCIL / EXECUTIVE / DEAN / DEPT_HEAD /
   ANALYST / ADMIN with permission summary + scope reach.

## Acceptance check

Re-derive from `docs/production-infrastructure.md`:
- 3 inbound rows × 1 boundary = 1 STRIDE block
- 11 outbound rows × N boundaries = ≥11 STRIDE rows
- 4 internal datastores = 4 STRIDE rows

→ Report must touch every row.

## TODO markers

Anything where a control is named but not implemented in code today
gets a `TODO(prompt-NN)` marker pointing at the prompt that should
land it.
