# Security Review — Program Landscape

**Status:** Snapshot taken 2026-04-24, during Prompt 13 hardening.
**Scope:** every HTTP endpoint, auth chain, data-export path, AI surface, and dependency inventory across `apps/api`, `apps/ingestion`, `apps/web`, and the `packages/*` libraries.
**Audience:** KKU IT security officer + Council IT liaison.

---

## 1. Authentication + session

| Control | Status | Notes |
|---|---|---|
| SSO via next-auth v5 (OIDC) | ✅ wired | `apps/web/src/lib/auth.ts`. KKU SSO config driven by `KKU_SSO_*` env. First-login provisioning present. |
| Dev-only credentials provider | ✅ gated | `ENABLE_LOCAL_AUTH=true` required; `assertLocalAuthSafe()` hard-fails at module load if `NODE_ENV=production`. |
| Session cookie flags | ✅ hardened (prompt 13) | `__Secure-authjs.session-token` + `httpOnly` + `SameSite=Lax` + `Secure` in prod. CSRF cookie uses the `__Host-` prefix so it's bound to the exact hostname. |
| JWT signing | ✅ | HS256 via `jose`; shared `NEXTAUTH_SECRET` verified in both next-auth and NestJS. |
| Session TTL | ✅ | 30 days (next-auth default). Idle timeout not separately enforced — acceptable for an internal-network app. |
| Role provisioning | ⚠️ policy | Default role is `VIEWER`. ADMIN elevation is manual via DB today; surface a UI for that in prompt 13b. |

## 2. Authorization

Every NestJS endpoint flows through:

1. `JwtAuthGuard` — unless marked `@Public()`.
2. `AccessControlGuard` — reads `@RequirePermission(...)` + optional `@RequireScope()`, calls `can(user, permission, scopeContext)` from `@kku/shared/auth`.
3. `ThrottlerGuard` — named buckets `default` / `ai_short` / `ai_hourly` / `heavy`.
4. `AiQuotaGuard` — per-user daily USD cap, no-op for unmarked routes.
5. `DataExportGuard` — requires `exportReason` on `@RequireExportReason()` routes.

**Permission catalog** lives in `packages/shared/src/auth/permissions.ts` and is enumerated against roles `VIEWER / COUNCIL / EXECUTIVE / DEAN / DEPT_HEAD / ANALYST / ADMIN`. Scope suffixes `:all / :own_faculty / :own_department / :aggregated_only` are honoured by `can()`.

**Audited routes:** every controller under `apps/api/src/**/*.controller.ts` was scanned. Every handler is either `@Public()` (only `/api/v1/healthz`, `/api/v1/ready`) or gated with `@Authorized(...)`. No naked handlers found.

**Scope-aware enforcement gaps:**
- Deep-dive endpoints (prompt 06) strip faculty PII for COUNCIL role at the Prisma `select` layer — not just filtered post-fetch. ✅
- Program management mutations check `programs:manage:all` OR `programs:manage:own_faculty` at the service layer. ✅
- AI Analyst tool executions are rebased on the caller's scope; the LLM cannot query outside the user's role-visible data. ✅

**Remaining gap:** `pdf:generate` is a blanket permission — any holder can request any template. Template-level gating (e.g., council-pack for COUNCIL+ only, faculty-brief free for the faculty owner) is a 13b polish.

## 3. Transport + headers

| Control | Where | Value |
|---|---|---|
| TLS termination | KKU reverse proxy → internal nginx on :8443 (self-signed, pinned) | End-to-end HTTPS |
| HSTS | `apps/web/next.config.mjs` + `apps/api/src/main.ts` helmet | `max-age=15552000; includeSubDomains` (prod only) |
| CSP | `apps/web/next.config.mjs` | `default-src 'self'`; script allows `'unsafe-inline'` (Next bootstrap); dev also allows `'unsafe-eval'` for HMR |
| X-Frame-Options | both layers | `DENY` |
| X-Content-Type-Options | both layers | `nosniff` |
| Referrer-Policy | both layers | `no-referrer` |
| Permissions-Policy | Next | `camera=(), microphone=(), geolocation=()` |
| `frame-ancestors 'none'` | Next CSP | enforced |

**CSP tightening debt:** dropping `'unsafe-inline'` on `style-src` requires a Tailwind nonce pipeline; dropping on `script-src` requires per-page Next nonces. Both documented as follow-ups; current stance is a reasonable default for a same-origin SPA behind SSO.

## 4. CSRF posture

- Web-originated mutations: next-auth's CSRF token cookie is double-submitted on `/api/auth/*` endpoints.
- API mutations: protected by **SameSite=Lax** on the session cookie — cross-origin POSTs don't send the cookie. The API is only reachable through the same-origin Next.js proxy.
- **Recommendation:** if a public API key (M2M) is ever exposed, rewire CSRF as a double-submit cookie check on `/api/v1/*`. Not needed while the API stays session-gated.

## 5. Input validation

- Every route body is validated via `ZodValidationPipe(...)` against a schema from `@kku/shared`. No untyped `req.body` reads in controllers (grep-verified).
- Query-string validation via the same pipe on `@Query(...)`.
- Prisma used for 100% of DB access; two `$queryRaw` call sites (in `benchmarking.ts` and `health-score.ts`) both wrap with Zod validation of the result rows (grep-verified).

## 6. Rate limits + quotas

Global throttler: 120 req/min/IP. AI-consuming routes override with:
- `ai_short`: 20/min (chat) or 10/min (briefs).
- `ai_hourly`: 200/hour (chat) or 50/hour (briefs).
- Per-user daily **USD budget** (summed across `AiInference` rows):
  - VIEWER/COUNCIL/DEAN/DEPT_HEAD: **$1/day**
  - EXECUTIVE: $3/day
  - ANALYST/ADMIN: $10/day

Override via `AI_QUOTA_*_USD` env. Quota guard is **fail-open** on DB errors (logged) — a Council member's call is not dropped because Postgres flickers.

## 7. AI surface controls

- Every AI call writes an `AiInference` row (prompt + redacted response + tokens + model + cost + latency + confidence). No way to bypass via `@AiCall()` decorator.
- Provider is pluggable via `AI_PROVIDER` env (google, anthropic, openrouter stub, intelsphere stub, stub). Google + Anthropic are real.
- Analyst has a hard safety gate (`@kku/shared/analyst/safety.ts`) refusing personal info, salary/performance, prompt injection, external-content requests, decision commitments. Applied **before** the LLM call (audit trail shows "refused by rule").
- Output filtering for other modules (gap, scenarios, benchmarking, decisions) is deferred to Block C of prompt 13 — currently those prompts trust the system-prompt-level guidance.

## 8. Secrets management

Every secret is env-driven. Canonical list in `.env.example` + `.env.prod.example`. Inventory:

| Var | Used by | Rotation cadence |
|---|---|---|
| `NEXTAUTH_SECRET` | web, api (JWT verify) | Quarterly |
| `KKU_SSO_CLIENT_SECRET` | web | When KKU SSO team rotates |
| `DATABASE_URL` | api, ingestion, web | Quarterly |
| `REDIS_URL` | api, ingestion | Quarterly |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` | api, ingestion | Quarterly |
| `GOOGLE_AI_API_KEY` | api, ingestion | Per-operator; rotate on analyst offboard |
| `ANTHROPIC_API_KEY` | api, ingestion | Same |
| `KKU_INTELSPHERE_API_KEY` | api, ingestion | Per KKU central AI ops cadence |
| `GOTENBERG_URL` | api | N/A (internal) |

**Rotation procedure** lives in `docs/runbook-secret-rotation.md` (to be written). Policy: zero-downtime by supporting two active secrets during rollover.

## 9. Database safety

- Prisma client pinned to 5.22.0; binaryTargets include native/linux-musl-openssl-3.0.x/windows.
- All migrations forward-only. The `pnpm db:migrate:deploy` script (added by task 180) takes a `pg_dump` snapshot to MinIO before running `prisma migrate deploy`.
- `pgvector`, `postgis`, `pg_trgm`, `btree_gin`, `uuid-ossp` enabled. No user-controlled SQL.
- Prisma soft-deletes where relevant (`ProgramStatus=SUNSET` instead of hard delete; CouncilDecision amendment creates new row).

## 10. Dependency vulnerabilities

**Baseline audit (2026-04-24 at prompt 13 start):**
Critical: 1 · High: 11 · Moderate: 21 · Low: 5 (38 total).

**Remediated in this session:**
- Next.js 14.2.20 → **14.2.32** — closes the Next.js middleware auth bypass (critical) + 3 HTTP deserialisation DoS (high) in the 14.x line.
- Multer 1.4.5 → **2.0.1** — closes 3 high-severity DoS.

**Post-remediation:** 1 critical + 19 high + 24 moderate + 5 low. The remaining critical + most highs are in the Next.js 14 line's transitive webpack/lodash/undici graph. Full resolution requires a **Next.js 15 major upgrade**, which is a separate migration (React 19 transitive changes, breaking app-router bits). Tracked as a 13b deliverable.

Non-impactful vulns we are accepting for now:
- `webpack` in `@nestjs/cli` devDependencies — dev-only, never shipped to prod images.
- `esbuild` via vitest — test runtime, never shipped.
- `glob` CLI command injection — not invoked with untrusted input.
- `uuid` v3/v5/v6 bounds check — we only use v4, which is unaffected.

Full audit output: `docs/security-review-audit-2026-04-24.json` (generated via `pnpm audit --json > …`).

## 11. Audit logging

- `@AuditLog({ action, entityType })` on every mutating endpoint — grep-verified.
- Audit rows capture user id, action, entity id, IP (via `X-Forwarded-For` with `trust proxy`), before/after payload hash.
- `@AiCall({ module })` writes `AiInference` rows for every LLM call.
- Retention: audit tables are append-only; retention policy pending PDPA review in Block D.

## 12. Data export

- `@RequireExportReason()` decorator + `DataExportGuard` wired (prompt 13). Routes opt in per template.
- **Current opt-in:** none in this session — requires the export dialog to collect a reason field first. Scheduled for 13b UI polish.
- **When the decorator is applied**, the reason string is attached to the request and the AuditLog interceptor writes it into `payloadJson.exportReason` automatically.

## 13. Known gaps → deferred

These are called out as intentional deferrals, not oversights:

1. Full Next.js 15 upgrade (closes 1 critical + 11 high deps).
2. CSP nonce pipeline (drops `'unsafe-inline'` on style + script).
3. WAF / DDoS at the KKU edge — operational, not app-level.
4. PDPA compliance doc + DSAR workflow — Block D deliverable.
5. AI output filter beyond analyst — Block C.
6. Per-template export-reason enforcement — 13b.
7. Key-rotation runbook — Block D.

## 14. Sign-off checklist for Council launch

- [ ] All four user guides published (`docs/guides/*.md`).
- [ ] AI governance doc finalized.
- [ ] PDPA posture reviewed with KKU DPO.
- [ ] Quarterly secret rotation scheduled on KKU IT calendar.
- [ ] DR drill executed and signed off by KKU IT.
- [ ] Next.js 15 migration either complete OR formally accepted with compensating controls (WAF, ingress filter).
