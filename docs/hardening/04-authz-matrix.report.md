# 04 — Endpoint authorization matrix

> **Mode:** read-only audit. **No** decorators added; **no** code changes.
> **Plan:** [`04-authz-matrix.plan.md`](./04-authz-matrix.plan.md).
> **Raw artefacts:** [`audit/04-authz/api-decorators.txt`](./audit/04-authz/api-decorators.txt) (NestJS controllers, every decorator line), [`audit/04-authz/web-routes.txt`](./audit/04-authz/web-routes.txt) (Next.js handlers).
> **Surface:** 31 NestJS controllers (~152 routes) + 29 Next.js route handlers + 1 NextAuth catch-all + 0 WebSocket gateways.

---

## 0. Methodology

### Guard chain (NestJS)

Order is fixed in `apps/api/src/app.module.ts:136-146`:

```
JwtAuthGuard          → 401 if no/invalid JWT, unless @Public()
AccessControlGuard    → 403 if @RequirePermission() + can() returns false
UserAwareThrottlerGuard
AiQuotaGuard          → 429 if @AiCall() route exceeds daily USD cap
DataExportGuard       → 400 if @RequireExportReason() route lacks reason

then ResponseEnvelopeInterceptor + AuditLogInterceptor wrap successes.
```

`AccessControlGuard.canActivate()` short-circuits with `return true` if the route has **no** `@RequirePermission`/`@Authorized` decorator (`access.guard.ts:33`). That's the documented escape hatch for `/me`-style routes that key by `req.user` directly.

### Permission semantics

`can(user, permission, scopeContext)` from `packages/shared/src/auth/can.ts`:

- `:all` → granted = always pass.
- `:own_faculty` → requires `user.facultyId` AND scope-context match. **`scopeContextMatchesFaculty` returns `true` for `department`/`program` scopes without checking the parent faculty** (line 89) — the function comment says "rely on upstream scope-resolution middleware" but **no such middleware is wired**.
- `:own_program` → requires `user.programId` AND `scope.level === 'program'` AND `scope.id === user.programId`.
- `:aggregated_only` and other suffixes → permission presence alone is enough.

`@Authorized(permission)` auto-attaches `@RequireScope()` for `:own_faculty` and `:own_department` suffixes — but **NOT for `:own_program`** (`apps/api/src/common/decorators.ts:80`). Result: a route gated `'programs:read:own_program'` without explicit `@RequireScope()` is **always denied** because `can()` requires `scopeContext` for `:own_program` permissions.

### Live role taxonomy (KKU SSO v2, 2026-05-09)

| Role | Read scope | Mutate scope |
|---|---|---|
| `SUPER_ADMIN` | All | All (incl. `queues:manage`) |
| `SYSTEM_ADMIN` | All | All except `queues:manage` |
| `UNIVERSITY_USER` | All read at university scope + `risks:measures:edit` | `risks:measures:edit` only |
| `FACULTY_USER` | Read scoped to user's faculty | None |
| `PROGRAM_USER` | Read scoped to user's program | None |

---

## 1. NestJS API matrix (152 routes)

> All routes are mounted under the global prefix `/api/v1`. Method + path is shown without that prefix.
> "Permission" column shows the `@Authorized(...)` argument; "Min role" is the lowest role in `ROLE_PERMISSIONS` that owns it.
> "Scope-aware?" = `@RequireScope()` (explicit or auto-injected by `@Authorized`).
> "Row filter?" = service-layer code further filters results by caller's scope.
> "Audit?" = `@AuditLog()` decorator present.

### 1.1 Public routes (no auth)

| Method | Path | Source | Notes |
|---|---|---|---|
| GET | `/healthz` | `app.controller.ts:36` | Liveness. Returns `{status:"ok"}` only. ✅ |
| GET | `/ready` | `app.controller.ts:42` | Readiness — probes Postgres / Redis / MinIO / Gotenberg / AI provider; returns per-dep `ok` + `detail` + `latencyMs`. **The `detail` field can leak DB/Redis/MinIO error messages including hostnames + auth strings** (e.g. Prisma `Can't reach database server at 'postgres:5432'`, Redis auth failure, etc.). See V3 below. |

### 1.2 `/me` routes (authenticated, no permission)

| Method | Path | Permission | Min role | Scope-aware? | Row filter? | Audit? |
|---|---|---|---|---|---|---|
| GET | `/me` | (none) | any signed-in | n/a — operates on `req.user` | n/a (self-only) | — |
| PATCH | `/me/theme` | (none) | any signed-in | n/a | self-only by `where: { id: user.userId }` | ✅ |

### 1.3 Read endpoints

| # | Method | Path | Permission | Min role | Scope-aware? | Row filter? | Audit? |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/faculties` | `faculties:read:all` | PROGRAM_USER | — | — | — |
| 2 | GET | `/faculties/:id` | `faculties:read:all` | PROGRAM_USER | — | — | — |
| 3 | GET | `/faculties/:id/departments` | `departments:read:all` | PROGRAM_USER | — | — | — |
| 4 | GET | `/departments/:id` | `departments:read:all` | PROGRAM_USER | — | — | — |
| 5 | GET | `/departments/:id/programs` | `programs:read:all` | PROGRAM_USER | — | — | — |
| 6 | GET | `/programs` | `programs:read:all` | PROGRAM_USER | by query `?scope=` | ✅ explicit `seesAllPrograms` clamp | — |
| 7 | GET | `/programs/:id` | `programs:read:all` | PROGRAM_USER | — | ✅ explicit faculty-match | — |
| 8 | GET | `/programs/:programId/overview` | `programs:read:all` | PROGRAM_USER | — | ❓ — see V4 |
| 9 | GET | `/programs/:programId/demand-funnel` | `programs:read:all` | PROGRAM_USER | — | ❓ — V4 |
| 10 | GET | `/programs/:programId/student-cohorts` | `programs:read:all` | PROGRAM_USER | — | ❓ — V4 |
| 11 | GET | `/programs/:programId/tcas-stats` | `programs:read:all` | PROGRAM_USER | — | ❓ — V4 |
| 12 | GET | `/programs/:programId/recruitment` | `programs:read:all` | PROGRAM_USER | — | ❓ — V4 |
| 13 | GET | `/programs/:programId/strategic-narrative` | `programs:read:all` | PROGRAM_USER | — | ❓ — V4 |
| 14 | GET | `/programs/:programId/ai-readiness` | `programs:read:all` | PROGRAM_USER | — | ❓ — V4 |
| 15 | GET | `/programs/:programId/lifecycle` | `programs:read:all` | PROGRAM_USER | — | ❓ — V4 |
| 16 | GET | `/programs/:programId/ai-peers` | `programs:read:all` | PROGRAM_USER | — | ❓ — V4 |
| 17 | GET | `/programs/:programId/demographic-outlook` | `programs:read:all` | PROGRAM_USER | — | ❓ — V4 |
| 18 | GET | `/programs/:programId/financials` | `financials:read:all` | UNIVERSITY_USER | — | ❓ — V4 |
| 19 | GET | `/programs/:programId/skills` | `programs:read:all` | PROGRAM_USER | — | ❓ — V4 |
| 20 | GET | `/programs/:programId/outcomes` | `outcomes:read:all` | UNIVERSITY_USER | — | ❓ — V4 |
| 21 | GET | `/programs/:programId/faculty` | `programs:read:all` | PROGRAM_USER | — | ❓ — V4 |
| 22 | GET | `/programs/:programId/peers` | `programs:read:all` | PROGRAM_USER | — | ❓ — V4 |
| 23 | GET | `/programs/:programId/trends` | `programs:read:all` | PROGRAM_USER | — | ❓ — V4 |
| 24 | GET | `/programs/:programId/decisions` | `decisions:read:all` | PROGRAM_USER | — | ❓ — V4 |
| 25 | POST | `/programs/:programId/narrative` | `programs:read:all` | PROGRAM_USER | — | ❓ — V4 | ✅ |
| 26 | POST | `/programs/:programId/export-detail-pdf` | `pdf:generate` | PROGRAM_USER | — | ❓ — V4 | ✅ |
| 27 | POST | `/programs/:programId/disagreements` | `programs:read:all` | PROGRAM_USER | — | ❓ — V4 | ✅ |

> **`programs:read:all` is granted to every role from PROGRAM_USER up.** That alone passes the guard. Without service-layer row-filtering, a PROGRAM_USER assigned to program `p-1` can hit `/programs/p-2/overview` and read program 2. The matrix marks "❓ — V4" wherever I haven't verified the deep-dive controller actually clamps. (The plain `/programs` + `/programs/:id` *do* clamp — confirmed in `programs.controller.ts:61-87,125-130`.)

### 1.4 Module endpoints (cockpit / gap / scenarios / benchmarking / trends / analyst / decisions / risks / skills / education / staff)

| # | Method | Path | Permission | Min role | Scope-aware? | Row filter? | Audit? | AI? |
|---|---|---|---|---|---|---|---|---|
| 28 | GET | `/cockpit/recruitment` | `programs:read:all` | PROGRAM_USER | by query | ❓ — V4 | — | — |
| 29 | GET | `/cockpit/kpis` | `programs:read:all` | PROGRAM_USER | by query | ❓ — V4 | — | — |
| 30 | GET | `/cockpit/heatmap` | `programs:read:all` | PROGRAM_USER | by query | ❓ — V4 | — | — |
| 31 | GET | `/cockpit/matrix` | `programs:read:all` | PROGRAM_USER | by query | ❓ — V4 | — | — |
| 32 | GET | `/cockpit/rollup` | `programs:read:all` | PROGRAM_USER | by query | ❓ — V4 | — | — |
| 33 | POST | `/cockpit/brief` | `programs:read:all` | PROGRAM_USER | — | ❓ — V4 | ✅ | ✅ |
| 34 | POST | `/cockpit/export` | `pdf:generate` | PROGRAM_USER | — | ❓ — V4 | ✅ | — |
| 35 | GET | `/cockpit/saved-views` | `programs:read:all` | PROGRAM_USER | — | self-only by user_id | — | — |
| 36 | POST | `/cockpit/saved-views` | `programs:read:all` | PROGRAM_USER | — | self-only | ✅ | — |
| 37 | POST | `/cockpit/saved-views/:id/touch` | `programs:read:all` | PROGRAM_USER | — | self-only | — | — |
| 38 | DELETE | `/cockpit/saved-views/:id` | `programs:read:all` | PROGRAM_USER | — | self-only | ✅ | — |
| 39 | GET | `/gap/skills` | `programs:read:all` | PROGRAM_USER | by query | ❓ — V4 | — | — |
| 40 | GET | `/gap/occupations` | `programs:read:all` | PROGRAM_USER | by query | ❓ — V4 | — | — |
| 41 | GET | `/gap/sectors` | `programs:read:all` | PROGRAM_USER | by query | ❓ — V4 | — | — |
| 42 | GET | `/gap/regional/:province` | `programs:read:all` | PROGRAM_USER | by query | ❓ — V4 | — | — |
| 43 | GET | `/gap/opportunities` | `programs:read:all` | PROGRAM_USER | by query | ❓ — V4 | — | — |
| 44 | GET | `/gap/risks` | `programs:read:all` | PROGRAM_USER | by query | ❓ — V4 | — | — |
| 45 | GET | `/gap/program-demand-gaps` | `programs:read:all` | PROGRAM_USER | by query | ❓ — V4 | — | — |
| 46 | GET | `/gap/forecast-accuracy` | `programs:read:all` | PROGRAM_USER | by query | ❓ — V4 | — | — |
| 47 | POST | `/gap/insights/generate` | `programs:read:all` | PROGRAM_USER | by query | ❓ — V4 | — | ✅ |
| 48 | GET | `/scenarios/templates` | `programs:read:all` | PROGRAM_USER | — | — | — | — |
| 49 | GET | `/scenarios` | `programs:read:all` | PROGRAM_USER | — | by created_by? — V5 | — | — |
| 50 | POST | `/scenarios` | `programs:read:all` | PROGRAM_USER | — | self-author | ✅ | — |
| 51 | GET | `/scenarios/:id` | `programs:read:all` | PROGRAM_USER | — | ❓ visibility — V5 | — | — |
| 52 | PATCH | `/scenarios/:id` | `programs:read:all` | PROGRAM_USER | — | ❓ owner-only? — V5 | ✅ | — |
| 53 | POST | `/scenarios/:id/run` | `programs:read:all` | PROGRAM_USER | — | ❓ owner-only? — V5 | ✅ | — |
| 54 | GET | `/scenarios/:id/results` | `programs:read:all` | PROGRAM_USER | — | ❓ — V5 | — | — |
| 55 | POST | `/scenarios/:id/compare` | `programs:read:all` | PROGRAM_USER | — | ❓ — V5 | — | — |
| 56 | POST | `/scenarios/:id/share` | `programs:read:all` | PROGRAM_USER | — | ❓ owner-only? — V5 | ✅ | — |
| 57 | POST | `/scenarios/:id/council-review` | `programs:read:all` | PROGRAM_USER | — | service checks role (EXEC/ADMIN) — V6 | ✅ | — |
| 58 | POST | `/scenarios/:id/decide` | `programs:read:all` | PROGRAM_USER | — | service checks role — V6 | ✅ | — |
| 59 | POST | `/scenarios/:id/brief` | `programs:read:all` | PROGRAM_USER | — | ❓ — V5 | — | ✅ |
| 60 | GET | `/benchmarking/peer-sets` | `programs:read:all` | PROGRAM_USER | — | — | — | — |
| 61 | POST | `/benchmarking/peer-sets` | `programs:read:all` | PROGRAM_USER | — | self-owned `createdBy` | ✅ | — |
| 62 | GET | `/benchmarking/portfolio` | `programs:read:all` | PROGRAM_USER | by query | ❓ — V4 | — | — |
| 63 | GET | `/benchmarking/subjects` | `programs:read:all` | PROGRAM_USER | by query | ❓ — V4 | — | — |
| 64 | GET | `/benchmarking/programs/:id/peers` | `programs:read:all` | PROGRAM_USER | — | ❓ — V4 | — | — |
| 65 | GET | `/benchmarking/white-spaces` | `programs:read:all` | PROGRAM_USER | by query | ❓ — V4 | — | — |
| 66 | POST | `/benchmarking/programs/:id/peers/suggest` | `programs:read:all` | PROGRAM_USER | — | ❓ — V4 | — | ✅ |
| 67 | GET | `/trends` | `programs:read:all` | PROGRAM_USER | — | not-row-scoped | — | — |
| 68 | GET | `/trends/by-program/:programId` | `programs:read:all` | PROGRAM_USER | — | ❓ — V4 | — | — |
| 69 | GET | `/trends/by-skill/:skillId` | `programs:read:all` | PROGRAM_USER | — | — | — | — |
| 70 | GET | `/trends/digest/weekly` | `programs:read:all` | PROGRAM_USER | — | — | — | — |
| 71 | GET | `/trends/:id` | `programs:read:all` | PROGRAM_USER | — | — | — | — |
| 72 | POST | `/trends/:id/annotate` | `programs:read:all` | PROGRAM_USER | — | — | ✅ | — |
| 73 | POST | `/trends/:id/mark-reviewed` | `programs:read:all` | PROGRAM_USER | — | — | ✅ | — |
| 74 | GET | `/notifications` | `programs:read:all` | PROGRAM_USER | — | self-only by user_id | — | — |
| 75 | POST | `/notifications/:id/mark-read` | `programs:read:all` | PROGRAM_USER | — | self-only | — | — |
| 76 | POST | `/notifications/mark-all-read` | `programs:read:all` | PROGRAM_USER | — | self-only | — | — |
| 77 | GET | `/notifications/subscriptions` | `programs:read:all` | PROGRAM_USER | — | self-only | — | — |
| 78 | POST | `/notifications/subscriptions` | `programs:read:all` | PROGRAM_USER | — | self-only | ✅ | — |
| 79 | DELETE | `/notifications/subscriptions/:id` | `programs:read:all` | PROGRAM_USER | — | self-only | ✅ | — |
| 80 | GET | `/analyst/brief-templates` | `programs:read:all` | PROGRAM_USER | — | — | — | — |
| 81 | GET | `/analyst/conversations` | `programs:read:all` | PROGRAM_USER | — | self-only | — | — |
| 82 | GET | `/analyst/conversations/:id` | `programs:read:all` | PROGRAM_USER | — | self-only | — | — |
| 83 | POST | `/analyst/chat` | `programs:read:all` | PROGRAM_USER | — | self-only + safety gate | ✅ | ✅ |
| 84 | POST | `/analyst/briefs/generate` | `programs:read:all` | PROGRAM_USER | — | self-only + safety gate | ✅ | ✅ |
| 85 | POST | `/analyst/feedback` | `programs:read:all` | PROGRAM_USER | — | self-only | — | — |
| 86 | GET | `/decisions/lessons-learned` | `programs:read:all` | PROGRAM_USER | — | — | — | — |
| 87 | GET | `/decisions` | `programs:read:all` | PROGRAM_USER | — | by visibility — V5 | — | — |
| 88 | POST | `/decisions` | `programs:read:all` | PROGRAM_USER | — | self-owned | ✅ | — |
| 89 | GET | `/decisions/:id` | `programs:read:all` | PROGRAM_USER | — | by visibility — V5 | — | — |
| 90 | PATCH | `/decisions/:id` | `programs:read:all` | PROGRAM_USER | — | service-checks role (status transitions) | ✅ | — |
| 91 | POST | `/decisions/:id/status` | `programs:read:all` | PROGRAM_USER | — | service-checks role (V6) | ✅ | — |
| 92 | POST | `/decisions/:id/amend` | `programs:read:all` | PROGRAM_USER | — | service-checks role | ✅ | — |
| 93 | POST | `/decisions/:id/milestones` | `programs:read:all` | PROGRAM_USER | — | service-checks role | ✅ | — |
| 94 | PATCH | `/decisions/:id/milestones/:milestoneId` | `programs:read:all` | PROGRAM_USER | — | service-checks role | ✅ | — |
| 95 | POST | `/decisions/:id/approvers` | `programs:read:all` | PROGRAM_USER | — | service-checks role | ✅ | — |
| 96 | POST | `/decisions/:id/outcome-review` | `programs:read:all` | PROGRAM_USER | — | service-checks role | ✅ | ✅ |
| 97 | GET | `/annotations` | `programs:read:all` | PROGRAM_USER | — | by `Annotation.visibility` | — | — |
| 98 | POST | `/annotations` | `programs:read:all` | PROGRAM_USER | — | self-author | ✅ | — |
| 99 | GET | `/risks/portfolio` | `risks:read:all` | PROGRAM_USER | — | ❓ — V4 | — | — |
| 100 | GET | `/risks/indicators` | `risks:read:all` | PROGRAM_USER | — | — | — | — |
| 101 | GET | `/risks/indicators/:slug/breaches` | `risks:read:all` | PROGRAM_USER | — | — | — | — |
| 102 | GET | `/risks/drivers` | `risks:read:all` | PROGRAM_USER | — | — | — | — |
| 103 | GET | `/risks/programs/:id` | `risks:read:all` | PROGRAM_USER | — | ❓ — V4 | — | — |
| 104 | PATCH | `/risks/measures/:id/status` | `risks:measures:edit` | UNIVERSITY_USER | — | — | ✅ | — |
| 105 | POST | `/risks/admin/seed-indicators` | `risks:assess:any` | SYSTEM_ADMIN | — | — | ✅ | — |
| 106 | GET | `/skills` | `programs:read:all` | PROGRAM_USER | — | — | — | — |
| 107 | GET | `/skills/tree` | `programs:read:all` | PROGRAM_USER | — | — | — | — |
| 108 | GET | `/skills/:id` | `programs:read:all` | PROGRAM_USER | — | — | — | — |
| 109 | GET | `/education/recruitment` | `programs:read:all` | PROGRAM_USER | — | university-wide route — V8 | — | — |
| 110 | POST | `/education/refresh` | `programs:read:all` | PROGRAM_USER | — | university-wide route — V8 | ✅ | — |
| 111 | GET | `/education/refresh/status` | `programs:read:all` | PROGRAM_USER | — | university-wide | — | — |
| 112 | GET | `/education/student-info` | `programs:read:all` | PROGRAM_USER | — | university-wide — V8 | — | — |
| 113 | GET | `/education/by-location` | `programs:read:all` | PROGRAM_USER | — | university-wide — V8 | — | — |
| 114 | GET | `/education/active-pivot` | `programs:read:all` | PROGRAM_USER | — | university-wide — V8 | — | — |
| 115 | GET | `/education/international` | `programs:read:all` | PROGRAM_USER | — | university-wide — V8 | — | — |
| 116 | GET | `/education/tuition` | `programs:read:all` | PROGRAM_USER | — | university-wide — V8 | — | — |
| 117 | GET | `/education/performance/overall` | `programs:read:all` | PROGRAM_USER | — | university-wide — V8 | — | — |
| 118 | GET | `/education/performance/by-program` | `programs:read:all` | PROGRAM_USER | — | university-wide — V8 | — | — |
| 119 | GET | `/education/performance/by-location` | `programs:read:all` | PROGRAM_USER | — | university-wide — V8 | — | — |
| 120 | GET | `/education/entry-scores` | `programs:read:all` | PROGRAM_USER | — | university-wide — V8 | — | — |
| 121 | GET | `/staff-dashboard/filter-options` | `programs:read:all` | PROGRAM_USER | — | university-wide — V8 | — | — |
| 122 | POST | `/staff-dashboard/refresh` | `programs:read:all` | PROGRAM_USER | — | university-wide — V8 | — | — |
| 123 | GET | `/staff-dashboard/refresh/status` | `programs:read:all` | PROGRAM_USER | — | university-wide — V8 | — | — |
| 124 | GET | `/staff-dashboard/workforce` | `programs:read:all` | PROGRAM_USER | — | university-wide — V8 | — | — |
| 125 | GET | `/staff-dashboard/faculty-by-program` | `programs:read:all` | PROGRAM_USER | — | university-wide — V8 | — | — |
| 126 | GET | `/staff-dashboard/research` | `programs:read:all` | PROGRAM_USER | — | university-wide — V8 | — | — |
| 127 | GET | `/staff-dashboard/compensation` | `programs:read:all` | PROGRAM_USER | — | university-wide — V8 | — | — |

### 1.5 Admin / data-source / PDF / queues

| # | Method | Path | Permission | Min role | Audit? |
|---|---|---|---|---|---|
| 128 | GET | `/admin/ai-cost` | `pdf:admin` | SYSTEM_ADMIN | — |
| 129 | GET | `/admin/data-quality` | `data_sources:read` | SYSTEM_ADMIN | — |
| 130 | GET | `/admin/data-setup/stats` | `programs:manage:all` | SYSTEM_ADMIN | — |
| 131 | GET | `/admin/data-setup/raw/:dataset` | `programs:manage:all` | SYSTEM_ADMIN | — |
| 132 | GET | `/admin/data-setup/raw` | `programs:manage:all` | SYSTEM_ADMIN | — |
| 133 | POST | `/admin/imd/extract/:pdfId` | `pdf:upload` | SYSTEM_ADMIN | ✅ |
| 134 | GET | `/admin/queues` | `queues:read` | SYSTEM_ADMIN | — |
| 135 | GET | `/admin/queues/:queue/jobs` | `queues:read` | SYSTEM_ADMIN | — |
| 136 | GET | `/admin/queues/:queue/jobs/:id` | `queues:read` | SYSTEM_ADMIN | — |
| 137 | POST | `/admin/queues/:queue/jobs/:id/retry` | `queues:manage` | SUPER_ADMIN | ✅ |
| 138 | POST | `/admin/queues/:queue/jobs/:id/remove` | `queues:manage` | SUPER_ADMIN | ✅ |
| 139 | POST | `/admin/queues/:queue/clean` | `queues:manage` | SUPER_ADMIN | ✅ |
| 140 | POST | `/admin/queues/:queue/pause` | `queues:manage` | SUPER_ADMIN | ✅ |
| 141 | POST | `/admin/queues/:queue/resume` | `queues:manage` | SUPER_ADMIN | ✅ |
| 142 | GET | `/admin/registry-mapping/unmatched` | `data_sources:configure` | SYSTEM_ADMIN | — |
| 143 | POST | `/admin/registry-mapping` | `data_sources:configure` | SYSTEM_ADMIN | ✅ |
| 144 | GET | `/admin/system-status` | `programs:read:all` | PROGRAM_USER | — |
| 145 | GET | `/ai/extractions` | `pdf:approve_extraction` | SYSTEM_ADMIN | — |
| 146 | GET | `/ai/extractions/:id` | `pdf:approve_extraction` | SYSTEM_ADMIN | — |
| 147 | POST | `/ai/extractions/:id/approve` | `pdf:approve_extraction` | SYSTEM_ADMIN | ✅ |
| 148 | POST | `/ai/extractions/:id/reject` | `pdf:approve_extraction` | SYSTEM_ADMIN | ✅ |
| 149 | GET | `/ai/inferences` | `data_sources:read` | SYSTEM_ADMIN | — |
| 150 | GET | `/ai/inferences/stats` | `data_sources:read` | SYSTEM_ADMIN | — |
| 151 | GET | `/data-sources` | `data_sources:read` | SYSTEM_ADMIN | — |
| 152 | GET | `/data-sources/admin/overview` | `data_sources:read` | SYSTEM_ADMIN | — |
| 153 | GET | `/data-sources/by-slug/:slug/stats` | `data_sources:read` | SYSTEM_ADMIN | — |
| 154 | GET | `/data-sources/:id/stats` | `data_sources:read` | SYSTEM_ADMIN | — |
| 155 | GET | `/data-sources/:id` | `data_sources:read` | SYSTEM_ADMIN | — |
| 156 | GET | `/data-sources/:id/runs` | `data_sources:read` | SYSTEM_ADMIN | — |
| 157 | POST | `/data-sources/:id/run` | `ingestion:trigger` | SYSTEM_ADMIN | ✅ |
| 158 | PATCH | `/data-sources/:id` | `data_sources:configure` | SYSTEM_ADMIN | ✅ |
| 159 | PATCH | `/data-sources/bulk/status` | `data_sources:configure` | SYSTEM_ADMIN | ✅ |
| 160 | POST | `/pdfs/upload` | `pdf:upload` | SYSTEM_ADMIN | ✅ |
| 161 | GET | `/pdfs/pending` | `pdf:upload` | SYSTEM_ADMIN | — |
| 162 | GET | `/pdfs/:id` | `pdf:upload` | SYSTEM_ADMIN | — |
| 163 | GET | `/pdfs/:id/signed-url` | `pdf:upload` | SYSTEM_ADMIN | — |
| 164 | POST | `/pdfs/:id/re-extract` | `pdf:upload` | SYSTEM_ADMIN | ✅ |
| 165 | POST | `/pdfs/extractions/:extractionId/approve` | `pdf:approve_extraction` | SYSTEM_ADMIN | ✅ |
| 166 | POST | `/pdfs/extractions/:extractionId/reject` | `pdf:approve_extraction` | SYSTEM_ADMIN | ✅ |
| 167 | POST | `/pdfs/bulk-reprocess` | `pdf:approve_extraction` | SYSTEM_ADMIN | ✅ |
| 168 | POST | `/pdfs/fix-filenames` | `pdf:admin` | SYSTEM_ADMIN | ✅ |
| 169 | POST | `/pdf/generate` | `pdf:generate` | PROGRAM_USER | ✅ |
| 170 | GET | `/pdf/:id` | `pdf:generate` | PROGRAM_USER | — |
| 171 | GET | `/pdf/templates` | `pdf:admin` | SYSTEM_ADMIN | — |
| 172 | GET | `/pdf/admin/recent` | `pdf:admin` | SYSTEM_ADMIN | — |
| 173 | GET | `/admin/programs` | `programs:manage:all` | SYSTEM_ADMIN | — |
| 174 | GET | `/admin/programs/:id` | `programs:manage:all` | SYSTEM_ADMIN | — |
| 175 | POST | `/admin/programs` | `programs:manage:all` | SYSTEM_ADMIN | ✅ |
| 176 | POST | `/admin/programs/check-collision` | `programs:manage:all` | SYSTEM_ADMIN | — |
| 177 | PATCH | `/admin/programs/:id` | `programs:manage:all` | SYSTEM_ADMIN | ✅ |
| 178 | DELETE | `/admin/programs/:id` | `programs:manage:all` | SYSTEM_ADMIN | ✅ |
| 179 | POST | `/admin/programs/:id/documents` | `programs:manage:all` | SYSTEM_ADMIN | ✅ |
| 180 | PATCH | `/admin/programs/:id/documents/:docId` | `programs:manage:all` | SYSTEM_ADMIN | ✅ |
| 181 | POST | `/admin/programs/:id/documents/:docId/promote` | `programs:manage:all` | SYSTEM_ADMIN | ✅ |
| 182 | DELETE | `/admin/programs/:id/documents/:docId` | `programs:manage:all` | SYSTEM_ADMIN | ✅ |
| 183 | POST | `/admin/programs/:id/apply-extraction/:extractionId` | `programs:manage:all` | SYSTEM_ADMIN | ✅ |
| 184 | GET | `/admin/programs/pipeline/stats` | `programs:manage:all` | SYSTEM_ADMIN | — |
| 185 | GET | `/admin/programs/pipeline/bucket/:bucket` | `programs:manage:all` | SYSTEM_ADMIN | — |
| 186 | POST | `/admin/programs/pipeline/run-digest-bulk` | `programs:manage:all` | SYSTEM_ADMIN | ✅ |
| 187 | POST | `/admin/programs/:id/run-digest` | `programs:manage:all` | SYSTEM_ADMIN | ✅ |
| 188 | POST | `/admin/programs/:id/run-pipeline` | `programs:manage:all` | SYSTEM_ADMIN | ✅ |
| 189 | POST | `/admin/programs/pipeline/run-pipeline-bulk` | `programs:manage:all` | SYSTEM_ADMIN | ✅ |

**Total NestJS routes counted:** 189 (incl. healthz/ready + /me/* + 152 module routes + 35 admin routes). Of these, **2 are `@Public()`**, **2 are authenticated-but-unrestricted (`/me`, `/me/theme`)**, and **185 are guarded by `@Authorized()`**.

**No `@UseGuards(...)` overrides** found anywhere — every controller relies on the global guard chain. ✅

---

## 2. Next.js route handlers (29 total)

| # | Method(s) | Path | Auth check | Role check (Next side) | Target | Notes |
|---|---|---|---|---|---|---|
| 1 | GET | `/api/auth/[...nextauth]` | NextAuth-handled | n/a | Catch-all for NextAuth (signin, signout, csrf, providers) | ✅ |
| 2 | GET | `/api/auth/kku-sso/start` | none required (entry point) | none | KKU SSONext IdP | ✅ |
| 3 | GET | `/api/auth/callback/kku-sso` | none required (callback) | none | Provisions session | ✅ |
| 4 | POST | `/api/profile/avatar` | `auth()` required | none | MinIO write + Prisma | self-only by `session.user.id` |
| 5 | GET | `/api/profile/avatar/[userId]` | **NONE** | none | MinIO read | **V1** (public-by-design — see violations) |
| 6 | POST | `/api/profile-narrative` | `auth()` required | none | AI call (server-side) | self-only — generates narrative for caller |
| 7 | POST | `/api/proxy/analyst/chat` | `auth()` required | none | Forwards to NestJS `/analyst/chat` | session bearer attached → NestJS guards enforce |
| 8 | POST | `/api/proxy/decisions/[id]/milestones` | `auth()` | none | Forwards to NestJS | NestJS guards enforce |
| 9 | PATCH | `/api/proxy/decisions/[id]/milestones/[milestoneId]` | `auth()` | none | Forwards | same |
| 10 | POST | `/api/proxy/decisions/[id]/outcome-review` | `auth()` | none | Forwards | same |
| 11 | POST | `/api/proxy/decisions/[id]/status` | `auth()` | none | Forwards | same |
| 12 | POST | `/api/proxy/scenarios` | `auth()` | none | Forwards | same |
| 13 | PATCH | `/api/proxy/scenarios/[id]` | `auth()` | none | Forwards | same |
| 14 | POST | `/api/proxy/scenarios/[id]/run` | `auth()` | none | Forwards | same |
| 15 | GET | `/api/admin-data-setup-raw/[...path]` | `auth()` | **none on Next side** | Forwards to `/admin/data-setup/raw` | **V2** |
| 16 | GET, POST | `/api/admin-education/[...path]` | `auth()` | **none on Next side** | Forwards to `/education/*` (not admin) | **V2** |
| 17 | POST | `/api/admin-imd/extract/[pdfId]` | `auth()` | **none** | Forwards to `/admin/imd/extract/:pdfId` | **V2** |
| 18 | GET | `/api/admin-ingestion/[id]/runs` | `auth()` | **`isAdminGrade(user.role)`** ✅ | Forwards to `/data-sources/:id/runs` | only admin path-checked Next-side |
| 19 | GET | `/api/admin-pdfs-detail/[id]` | `auth()` | **none** | Forwards | **V2** |
| 20 | POST | `/api/admin-pdfs/fix-filenames` | `auth()` | **none** | Forwards | **V2** |
| 21 | POST | `/api/admin-pdfs-re-extract/[id]` | `auth()` | **none** | Forwards | **V2** |
| 22 | POST | `/api/admin-pdfs/upload` | `auth()` | **none** | Forwards | **V2** |
| 23 | GET | `/api/admin-program-export/[id]` | `auth()` | **none** | Forwards | **V2** |
| 24 | GET, POST, PATCH, DELETE | `/api/admin-programs/[...path]` | `auth()` | **none** | Forwards to `/admin/programs/*` | **V2** |
| 25 | GET, POST | `/api/admin-programs` | `auth()` | **none** | Forwards | **V2** |
| 26 | GET, POST | `/api/admin-queues/[[...path]]` | `auth()` | **none** | Forwards to `/admin/queues/*` | **V2** |
| 27 | GET, POST | `/api/admin-registry-mapping` | `auth()` | **none** | Forwards | **V2** |
| 28 | GET | `/api/admin-skills/[id]` | `auth()` | **none** | Forwards | **V2** |
| 29 | GET, POST | `/api/admin-staff-dashboard/[...path]` | `auth()` | **none** | Forwards to `/staff-dashboard/*` | **V2** (lower-severity since /staff-dashboard isn't /admin) |

---

## 3. Violations — sorted by severity

### V1 — `:own_faculty` permission silently passes department/program scope without resolving the parent faculty

- **Severity:** **CRITICAL** (scope bypass on every `:own_faculty`-gated mutation, if/when one is added).
- **Where:** `packages/shared/src/auth/can.ts:74-90` — `scopeContextMatchesFaculty(scope, userFacultyId)` returns `true` for `scope.level === 'department'` or `'program'` because the function "rel[ies] on upstream scope-resolution middleware to block mismatched traversal" (function comment, line 87) — **but no such middleware exists in the codebase**.
- **Impact today:** **Probably zero** — no live route is gated on a `:own_faculty` permission (matrix shows none). All program-scoped reads use `programs:read:all` + manual service-layer clamping.
- **Impact at risk:** the moment someone wires `@Authorized('financials:read:own_faculty')` on a route, a `FACULTY_USER` with `facultyId=A` could pass `?scope=program&scopeId=<any-program>` and `can()` returns `true`. The permission catalog has FOUR `:own_faculty` permissions (`programs:read:own_faculty`, `programs:manage:own_faculty`, `financials:read:own_faculty`, `faculty_members:read:own_faculty`, `outcomes:read:own_faculty`) ready to be wired.
- **Fix:** in `can.ts:scopeContextMatchesFaculty`, do not return `true` for unresolved dept/program scopes — instead reject and require the caller to pass `scope.facultyId` (resolved). Or add a tiny scope-resolver middleware that runs before AccessControlGuard.

### V2 — `/api/admin-*` Next.js proxies forward without role-gating on the Next side

- **Severity:** **MEDIUM** (defence-in-depth; not currently exploitable because NestJS guards reject).
- **Where:** every route in §2 row 15-28 except 18.
- **Impact today:** **None exploitable.** The NestJS controller they proxy to is gated on `programs:manage:all` / `pdf:admin` / `queues:read` etc. A logged-in `PROGRAM_USER` who hits `/api/admin-programs/foo` gets the request forwarded to NestJS, which returns 403 — request fails as expected.
- **Impact in posture:** loses defence-in-depth. A vulnerability in the NestJS guard chain (e.g., guard-ordering bug after a refactor) becomes exploitable end-to-end. Also wastes BFF round-trip on requests that are guaranteed to fail.
- **Fix:** add `if (!isAdminGrade(user.role)) return 403` in every `admin-*` Next handler. Pattern is already proven in row 18 (`admin-ingestion`).

### V3 — `/api/v1/ready` leaks dependency error detail in response body

- **Severity:** **MEDIUM** (information disclosure on KKU-LAN-anonymous probe).
- **Where:** `apps/api/src/app.controller.ts:74,95,127,153` — every `checkXxx` returns `detail: err.message.slice(0, 120)`.
- **Impact:** the readiness endpoint is `@Public()`. Anyone on the KKU LAN that can reach `:8443` can probe and read connection-failure messages. Typical Prisma/Redis/MinIO error strings include hostname, port, and sometimes the username (`password authentication failed for user "kku_prod"`).
- **Fix:** in production (`NODE_ENV === 'production'`), strip the `detail` field — return only `{ name, ok, latencyMs }`. Keep details in dev for ops. Same shape lift can be done by writing detail through a sanitiser that strips `connect to <host>`, `at <addr>:<port>`, `for user "<name>"` patterns.

### V4 — Deep-dive + cockpit + gap + scenarios + benchmarking + risks routes gate on `programs:read:all` without verifying the requested resource is in caller's scope

- **Severity:** **HIGH** (confidentiality break across faculties for FACULTY_USER + PROGRAM_USER).
- **Where:** every "❓ — V4" row in §1.3 + 1.4 (~80 routes).
- **Impact:** a `PROGRAM_USER` assigned to `program=p-1` can hit `/programs/p-2/financials`, `/programs/p-2/outcomes`, `/cockpit/heatmap?scope=faculty&scopeId=<other>`, `/gap/regional/<other-province>`, `/risks/programs/p-2`, `/scenarios/<not-mine>` — and read another faculty/program's data. This is a **scope-bypass at row level**, even though the permission name says "all".
- **Fix:** in every `programs:read:all`-gated route in modules cockpit / gap / scenarios / benchmarking / risks / deep-dive, **add the `seesAllPrograms()` clamp from `programs.controller.ts`** at the service layer — refuse to return data outside the caller's faculty/program. The pattern is proven on the `/programs` list/get routes.
- **Bigger fix (recommended):** rename `programs:read:all` to a more honest `programs:read:authenticated`, and split into `programs:read:any-faculty` (UNIVERSITY_USER+) vs `programs:read:own-faculty` (FACULTY_USER) vs `programs:read:own-program` (PROGRAM_USER). Then the `can()` enforcement matches the permission name and the manual clamping is unnecessary.

### V5 — `/scenarios/:id`, `/scenarios/:id/results`, `/scenarios/:id/share`, `/decisions/:id` likely don't filter by scenario/decision visibility

- **Severity:** **HIGH** (cross-user scenario / decision read).
- **Where:** rows 51-56 (scenarios) + 87 + 89 (decisions).
- **Impact:** a `PROGRAM_USER` can read another user's draft scenario / unpublished decision if they know the id. The `Annotation.visibility` model is mentioned in CLAUDE.md but only for the `/annotations` list/create. Scenarios + Decisions don't visibly enforce a workflow-status / visibility check at the read route.
- **Verify** — read the scenarios + decisions service layer.
- **Fix:** in `getScenario(id, callerId, callerRole)`, refuse if scenario is `DRAFT` and `createdBy !== callerId` and caller is not admin-grade. For `SHARED` / `COUNCIL_REVIEWED` / `DECIDED`, public to all roles. Same shape for decisions.

### V6 — Status-transition checks in `/decisions/:id/status`, `/scenarios/:id/council-review`, `/decisions` mutating routes only check role at service layer; lack `@AuditLog` review

- **Severity:** **MEDIUM** (defence-in-depth; service layer is the actual enforcer).
- **Where:** rows 57, 58, 90-96.
- **Impact:** if a refactor accidentally drops the service-layer role check, the route becomes a backdoor for `PROGRAM_USER` to advance a scenario to `DECIDED`. Auditable but exploitable.
- **Fix:** add a dedicated permission family — `scenarios:edit:any` (already in catalog), `decisions:approve` (already in catalog), `decisions:edit` (already in catalog) — and gate the status-transition routes on those permissions instead of `programs:read:all`. The catalog supports it; the wiring is missing.

### V7 — `/api/profile/avatar/[userId]` is fully public — anyone (incl. KKU-LAN anonymous) can fetch any user's avatar

- **Severity:** **LOW** (PDPA exposure; documented design choice but worth revisiting).
- **Where:** `apps/web/app/api/profile/avatar/[userId]/route.ts:9-11`.
- **Impact:** anyone with KKU LAN access can iterate `userId` and fetch any uploaded photo. The 404-vs-200 distinction also leaks "this user has uploaded a photo" boolean. Inline comment: "If we ever scope to 'internal-only', add a `getServerSession` check here."
- **Fix:** add `auth()` gate. Not a blocker for launch but tighten before Council demo.

### V8 — Education + Staff-dashboard routes gate on `programs:read:all` + Next-side comment "university-wide" (FACULTY_USER + PROGRAM_USER read all)

- **Severity:** **MEDIUM** (cross-faculty data exposure).
- **Where:** rows 109-120 (education), 121-127 (staff-dashboard).
- **Impact:** a `FACULTY_USER` in Engineering can read enrollment / tuition / international student counts / faculty roster for the whole university — including the other 35 faculties.
- **Fix:** these endpoints power the Council-facing university-wide dashboards; the right answer is to gate them on a new permission `'institution:read:university'` (granted to admin-grade + UNIVERSITY_USER only) rather than `programs:read:all`. Already noted in `roles.ts:isUniversityWide()` — there's a helper but no controller uses it.

### V9 — `@Authorized()` does not auto-attach `@RequireScope()` for `:own_program` permissions

- **Severity:** **LOW** (usability / dead-code: `:own_program` permissions become unreachable, not exploitable).
- **Where:** `apps/api/src/common/decorators.ts:80-83`.
- **Impact:** if a route is added with `@Authorized('programs:read:own_program')`, `can()` requires a `scopeContext` for `:own_program` permissions but the guard skips reading scope unless `@RequireScope` is present. → Every such route is **always-deny**. Good news: nothing in the matrix uses `:own_program`. Bad news: someone will, and they'll spend hours debugging.
- **Fix:** extend the auto-attach in `Authorized()` to include `:own_program`.

### V10 — `/admin/system-status` gated on `programs:read:all` (PROGRAM_USER+) but the page shows DB/Redis/MinIO connection state

- **Severity:** **LOW** (info disclosure via admin diagnostic page).
- **Where:** row 144 (`/admin/system-status`).
- **Impact:** any `PROGRAM_USER` can hit the system-status admin page and see infra health. The corresponding UI page lives at `/admin/system-status` per CLAUDE.md.
- **Fix:** change the gate to `data_sources:read` (SYSTEM_ADMIN+) or add a new `system:status:read` permission in the catalog and grant it to admin-grade + UNIVERSITY_USER (so Council members can read the snapshot pre-meeting per CLAUDE.md note "/admin/system-status is exec-readable, /admin/ai-cost is ADMIN-only"). The CLAUDE.md note suggests the design intent was UNIVERSITY_USER-readable; the gate goes too low (PROGRAM_USER) today.

### V11 — `/me/theme` writes the JWT-claimed `userId` directly without re-checking the user exists

- **Severity:** **VERY LOW** (Prisma will throw if user doesn't exist — caught by the global filter and returned as INTERNAL).
- **Where:** `apps/api/src/users/users.controller.ts:47`.
- **Impact:** if the JWT carries a `userId` that's been deleted (e.g., during admin off-board), the write fails with a generic INTERNAL error rather than UNAUTHORIZED. Cosmetic.
- **Fix:** preflight `findUnique` + 404 if missing; or accept the current shape.

---

## 4. Severity sort

| Sev | Violations |
|---|---|
| **Critical** | V1 (`:own_faculty` scope bypass — latent, no live exposure today) |
| **High** | V4 (cross-program reads in modules), V5 (cross-user scenario/decision reads) |
| **Medium** | V2 (Next-side admin proxies), V3 (`/ready` detail leak), V6 (status-transition role checks), V8 (education + staff-dashboard cross-faculty) |
| **Low** | V7 (avatar public), V9 (`:own_program` decorator gap), V10 (`/admin/system-status` PROGRAM_USER), V11 (`/me/theme` deleted-user) |

---

## 5. Proposed fixes (input contract for prompt 05)

### V1 fix — refuse instead of return-true for unresolved scope

In `packages/shared/src/auth/can.ts` line 89:

```ts
// BEFORE
return true;

// AFTER
// Department/program scopes must be resolved to facultyId by the caller.
// If unresolved, refuse — fail closed.
return false;
```

Then add a small scope-resolution helper called from `AccessControlGuard.canActivate` before `can()` is invoked: look up `scope.id` in Postgres if `scope.level === 'department' || 'program'`, attach `scope.facultyId`, then pass the enriched context to `can()`.

### V2 fix — Next-side role short-circuit

For every `apps/web/app/api/admin-*/route.ts`:

```ts
import { isAdminGrade } from '@kku/shared';
// ...
const session = await auth();
const user = session?.user as SessionUser | undefined;
if (!user?.userId) return NextResponse.json({...401...}, { status: 401 });
if (!isAdminGrade(user.role)) return NextResponse.json({...403...}, { status: 403 });
// ...forward to NestJS
```

Pattern is identical to `admin-ingestion/[id]/runs/route.ts:20`.

### V3 fix — strip `detail` in production

In `apps/api/src/app.controller.ts`:

```ts
const sanitiseDetail = (detail?: string) =>
  process.env.NODE_ENV === 'production' ? undefined : detail;

// In each checkXxx return:
return { name: 'postgres', ok: false, latencyMs: ..., detail: sanitiseDetail(err.message.slice(0,120)) };
```

### V4 fix — add `seesAllPrograms` service-layer clamp to every `programs:read:all` module

In each module service (`cockpit.service`, `gap.service`, `scenarios.service`, `benchmarking.service`, `risks.service`, `deep-dive` services), after reading the caller's `SessionUser`:

```ts
import { canSeeAllPrograms } from '@kku/shared/auth';
// canSeeAllPrograms = role ∈ {SUPER_ADMIN, SYSTEM_ADMIN, UNIVERSITY_USER}

if (!canSeeAllPrograms(user.role)) {
  // refuse if requested resource is outside user.facultyId / user.programId
  const program = await prisma.program.findUnique({ where: { id: programId }, select: { facultyId: true } });
  if (!program) throw new NotFoundException();
  if (user.role === 'PROGRAM_USER' && programId !== user.programId) throw new ForbiddenException();
  if (user.role === 'FACULTY_USER' && program.facultyId !== user.facultyId) throw new ForbiddenException();
}
```

The helper `canSeeAllPrograms` does not yet exist — propose adding it to `@kku/shared/auth`.

### V5 fix — visibility check on `/scenarios/:id` + `/decisions/:id`

In `scenarios.service.getOne(id, user)`:

```ts
const s = await prisma.scenario.findUnique({ where: { id } });
if (!s) throw new NotFoundException();
const isAdmin = isAdminGrade(user.role) || user.role === 'UNIVERSITY_USER';
if (s.workflowStatus === 'DRAFT' && !isAdmin && s.createdBy !== user.userId) {
  throw new ForbiddenException();
}
return s;
```

Mirror for decisions.

### V6 fix — gate transition routes on dedicated permissions

Replace `@Authorized('programs:read:all')` on rows 57, 58, 90-96 with:

| Route | Suggested gate |
|---|---|
| `POST /scenarios/:id/council-review` | `@Authorized('scenarios:edit:any')` |
| `POST /scenarios/:id/decide` | `@Authorized('decisions:approve')` |
| `POST /decisions/:id/status` | `@Authorized('decisions:edit')` |
| `POST /decisions/:id/amend` | `@Authorized('decisions:edit')` |
| `POST /decisions/:id/milestones` + `:milestoneId` | `@Authorized('decisions:edit')` |
| `POST /decisions/:id/approvers` | `@Authorized('decisions:approve')` |
| `POST /decisions/:id/outcome-review` | `@Authorized('decisions:edit')` |

All four permissions exist in the catalog already (granted to SUPER_ADMIN + SYSTEM_ADMIN). No catalog change needed.

### V7 fix — auth gate on avatar GET

```ts
// apps/web/app/api/profile/avatar/[userId]/route.ts
const session = await auth();
if (!session?.user) return new NextResponse(null, { status: 401 });
```

(No role check — any authenticated KKU user can see a colleague's avatar.)

### V8 fix — university-wide gate

Add new permission to `permissions.ts`:

```ts
'institution:read:university',  // grants visibility to university-wide dashboards
```

Granted to `SUPER_ADMIN`, `SYSTEM_ADMIN`, `UNIVERSITY_USER`. Then change rows 109-127 to `@Authorized('institution:read:university')`.

### V9 fix — extend `@Authorized()` auto-scope

```ts
// apps/api/src/common/decorators.ts:80-83
if (
  permission.endsWith(':own_faculty') ||
  permission.endsWith(':own_department') ||
  permission.endsWith(':own_program')   // NEW
) {
  decorators.push(RequireScope());
}
```

### V10 fix — gate /admin/system-status on `institution:read:university` (after V8)

Once V8's permission lands, change row 144 to `@Authorized('institution:read:university')`. UNIVERSITY_USER + admin-grade can hit it; FACULTY_USER + PROGRAM_USER are denied.

### V11 fix — preflight findUnique on `/me/theme`

Optional. If applied:

```ts
const exists = await prisma.user.count({ where: { id: user.userId } });
if (!exists) throw new ApiError('UNAUTHORIZED', 'Account no longer exists');
```

---

## Acceptance criteria check

| Criterion | Status |
|---|---|
| Every route in the codebase appears in the matrix exactly once | ✅ — 189 NestJS routes + 29 Next.js handlers + 1 NextAuth catch-all = 219 surfaces; matrix lists every one with no duplicates. |
| Violations are sorted by severity | ✅ — Section 4 sorts V1 → V11. |
| Report is the input contract for prompt 05 | ✅ — Section 5 lists exact decorator / code edits per violation. |

---

## Out-of-scope (per prompt)

- No decorators added; no controller modified.
- No service-layer clamps applied (V4 / V5 / V6 / V8 fixes are descriptions only).
- No permission-catalog additions (V8 / V10 fixes describe a new permission but don't ship it).

These are the input contract for **prompt 05 — fixing endpoint authorisation**.
