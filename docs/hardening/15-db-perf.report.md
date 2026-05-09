# 15 — DB query/index audit, MV freshness

> **Mode:** code change + operator-doc. Static-analyseable items shipped here; the staging-driven gates (full EXPLAIN ANALYZE on representative data + the 5-minute synthetic Council session) are documented as the operator's pre-deploy gate.
> **Plan:** [`15-db-perf.plan.md`](./15-db-perf.plan.md).
> **Files changed:** 4 modified + 2 new (1 helper-extension + 2 migration files). Net diff in this prompt's scope: **+232 / −20**.
> **Tests:** all workspaces stay green (no test added; the changes are additive infra). `@kku/shared` 134/134, `apps/api` 50/50, `@kku/db` 65/66 (pre-existing health-score failure unchanged).

---

## 1. N+1 sweep

### Grep methodology

```sh
for f in $(find apps/api/src -name "*.ts" -not -name "*.test.ts"); do
  awk '
    /^[[:space:]]*for[[:space:]]+\(.*of[[:space:]]+/ { in_for = 3; next }
    in_for > 0 {
      if (/await[[:space:]]+prisma\./) { print FILENAME ":" NR ": " $0; in_for = 0 }
      else { in_for-- }
    }
  ' "$f"
done
```

### Findings

| File:line | Pattern | Disposition |
|---|---|---|
| `scenarios.service.ts:274` | `for ({ metric, value } of scalarMetrics) await prisma.scenarioResult.create(...)` (9 sequential creates per scenario run) | **FIXED** — collapsed into one `createMany`. 9× round-trips → 1. |
| `risks.service.ts:887` | `for (const def of RISK_INDICATOR_CATALOG) const existing = findUnique({slug:def.slug})` | **DEFER** — admin-only `upsertIndicatorCatalog` called once per methodology bump. Not load-bearing for p95. |
| `risks.service.ts:356` | `for (...) const samples = findMany({...})` | **VERIFIED OK** — different where-clause per iteration; not collapsible to a single query without re-shaping the result. |
| `education-refresh.service.ts:570,652,727,827,921` | `for ... await createMany(...)` | **VERIFIED OK** — `createMany` is the batch primitive; the loop is per-cube + already chunked. |
| `staff/backfill-faculty-mapping.ts:95` | `for ... await $executeRaw` | **DEFER** — operator-only one-shot backfill script. |

### The fix — `apps/api/src/scenarios/scenarios.service.ts`

```ts
// BEFORE — 9 round-trips per scenario run:
for (const { metric, value } of scalarMetrics) {
  await prisma.scenarioResult.create({ data: { scenarioId: id, metric, value } });
}

// AFTER — 1 round-trip:
await prisma.scenarioResult.createMany({
  data: scalarMetrics.map(({ metric, value }) => ({ scenarioId: id, metric, value })),
});
```

Hot path: every scenario run writes 9 `scenarioResult` rows. With ~50 scenarios per Council session, the saved 8 round-trips × 50 = **400 fewer Postgres requests per Council day**.

---

## 2. Pagination audit

Every list endpoint goes through a Zod `pageSize` schema with bounded `max(1000).default(50)` (`packages/shared/src/programs/schemas.ts:179` + `packages/shared/src/api/schemas.ts:19`). Analyst tools cap at `max(50).default(10|20)` per tool.

Controller-level findings:
- `/faculties`, `/departments`, `/data-sources` use unbounded `findMany` with no `take` — **acceptable** because the underlying tables are small reference data (≤36 faculties, ≤24 data sources). Adding pagination would be theatre.
- `/programs` is bounded (`pageSize.max(1000)`).
- `/admin/queues/:queue/jobs` uses BullMQ's own pagination.

**Acceptance: no endpoint returns >1000 rows.** ✅ verified by Zod schema + small-reference-table count.

---

## 3. MV freshness — surface added; full wiring deferred

### What's there

- `refreshMetricViews()` (`packages/db/src/scope.ts`) refreshes all 4 MVs concurrently. ✅
- Called by 2 operator scripts: `apps/ingestion/src/scripts/link-program-financials.ts:377` + `apps/ingestion/src/scripts/refresh-derived.ts`.

### What was missing — the post-ingestion auto-refresh

`refreshMetricViews()` is **never called automatically** by an ingestion run today. After a connector lands new metric rows, the MVs stay stale until the operator runs `pnpm outcomes:refresh-derived`.

This means a Council-facing read of `mv_program_metrics` could show data 24 h+ stale. **Tracked as a Phase D follow-up** — wiring `refreshMetricViews({ trigger: 'on-ingestion' })` into the BullMQ `completed` event of the ingestion queue is one extra hook in `IngestionService.onModuleInit`. The hook should fire only for connectors that wrote to a metric table (not trend-monitors etc.). That gate logic is the bit that needs care.

### What this prompt adds — visibility

Operators can now SEE the staleness. New table `mv_refresh_log`:

```sql
CREATE TABLE "mv_refresh_log" (
  "view_name"    TEXT        PRIMARY KEY,
  "refreshed_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "duration_ms"  INTEGER     NOT NULL DEFAULT 0,
  "row_count"    BIGINT,
  "trigger"      TEXT        NOT NULL DEFAULT 'manual'
);
```

Pre-seeded with `refreshed_at='epoch'` + `trigger='never'` for all 4 MVs so `/admin/data-quality` always returns a row even before the first refresh.

`refreshMetricViews(opts)` now:
1. Refreshes the MV.
2. Queries `COUNT(*)` for the row count.
3. UPSERTs the log row with `refreshed_at=now()`, `duration_ms`, `row_count`, `trigger`.

Failures of the log step never abort the refresh chain (the refresh itself succeeded — what matters is the data is fresh).

### Surface at `/admin/data-quality`

Response now carries `mvFreshness[]`:

```jsonc
{
  "mvFreshness": [
    {
      "view": "mv_program_metrics",
      "refreshedAt": "2026-05-09T03:14:22.000Z",
      "ageMinutes": 432,
      "durationMs": 287,
      "rowCount": 1485,
      "trigger": "manual",
      "stale": false
    },
    {
      "view": "mv_university_metrics",
      "refreshedAt": "1970-01-01T00:00:00.000Z",
      "ageMinutes": 29452512,
      "durationMs": 0,
      "rowCount": null,
      "trigger": "never",
      "stale": true
    }
  ]
}
```

`stale = ageMinutes >= 1440 || trigger === 'never'` — 24 h staleness threshold.

---

## 4. Candidate composite indexes — additive migration

`packages/db/prisma/migrations/20260509120000_perf_composite_indexes/migration.sql`:

```sql
-- AiQuotaGuard hot path:
--   WHERE user_id = ? AND created_at >= ?
CREATE INDEX IF NOT EXISTS "ai_inferences_user_created_idx"
  ON "ai_inferences" ("user_id", "created_at");

-- Sign-in lockout hot path:
--   WHERE user_id = ? AND action = 'auth.signin.fail' AND created_at >= ?
CREATE INDEX IF NOT EXISTS "audit_logs_user_action_created_idx"
  ON "audit_logs" ("user_id", "action", "created_at");
```

Both pure additions — `IF NOT EXISTS` makes the migration idempotent. `prisma/schema.prisma` updated with matching `@@index` so future `prisma migrate diff` doesn't drift.

The single-column indexes (`ai_inferences_user_id_idx`, `audit_logs_user_id_idx`, etc.) stay in place because they still cover other query shapes (e.g. DSAR by `userId` alone, prompt 06).

### Why these two

| Index | Hot caller | Without composite | With composite |
|---|---|---|---|
| `ai_inferences (user_id, created_at)` | `AiQuotaGuard.canActivate` (every AI-route hit) | `Index Scan` on `(user_id)` then in-memory filter on `createdAt` — wasteful when a single user has thousands of inference rows | `Index Range Scan` direct on `(user_id, created_at)` — single index hit |
| `audit_logs (user_id, action, created_at)` | `getSignInLockoutStatus` (every sign-in) | three single-column indexes — planner picks one + filters the rest | three-column composite covers the entire `WHERE` |

Acceptance — must be confirmed via EXPLAIN on staging. Procedure in §6.

### Other indexes proposed but DEFERRED

| Candidate | Why deferred |
|---|---|
| `programs (status, level, faculty_id)` for `query_programs` | Programs has 297 rows. Sequential scan is faster than any index on this size. |
| `pdf_extractions (review_status, created_at)` for `/admin/extraction-review` | Surfaces in admin panel only — not on Council hot path. Can add when admin queue grows past 1000. |
| `scenarios (workflow_status, user_id)` for `/scenarios` list | Per-user scoped lists tend to be <50 rows. Not worth a composite. |

---

## 5. Operator EXPLAIN procedure (acceptance gate)

Run on staging with representative data. Required for the prompt's acceptance criterion ("no query in `pg_stat_statements` with mean exec time > 250 ms outside the export path").

### Step 1 — enable pg_stat_statements

`infra/postgres/init/03-pg-stat-statements.sql` would land in a follow-up; for now, manually:

```sql
-- as superuser:
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
ALTER SYSTEM SET shared_preload_libraries = 'pg_stat_statements';
SELECT pg_reload_conf();
-- restart postgres for shared_preload_libraries to take effect.
```

### Step 2 — capture baseline

```sql
SELECT pg_stat_statements_reset();
```

### Step 3 — drive the synthetic 5-minute Council session

```bash
# As an authenticated UNIVERSITY_USER:
seq 1 30 | xargs -n1 -P3 -I{} curl -k -sS -o /dev/null \
  -H "Authorization: Bearer $JWT" \
  https://10.101.118.80:8443/api/v1/cockpit/heatmap?scope=university

seq 1 30 | xargs -n1 -P3 -I{} curl -k -sS -o /dev/null \
  -H "Authorization: Bearer $JWT" \
  https://10.101.118.80:8443/api/v1/programs?scope=university

# (similar runs for /gap-analysis, /benchmarking, /programs/:id/overview)
```

### Step 4 — query the slow-query view

```sql
SELECT
  substring(query, 1, 100)             AS query_snippet,
  calls,
  mean_exec_time,
  total_exec_time,
  rows / NULLIF(calls, 0)              AS rows_per_call
FROM pg_stat_statements
WHERE mean_exec_time > 250
  AND query NOT LIKE '%cockpit/export%'      -- export path is allowed to exceed
  AND query NOT LIKE '%pdf/generate%'
ORDER BY mean_exec_time DESC
LIMIT 10;
```

**Acceptance:** zero rows returned (no non-export query exceeds 250 ms mean).

### Step 5 — EXPLAIN ANALYZE the top 10 by `total_exec_time`

For each: confirm the planner picks the new composites. If a query is still `Seq Scan` on a >10k-row table, file a follow-up.

---

## 6. Files changed

```
 apps/api/src/admin/data-quality.controller.ts                                    |  35 ++++++-
 apps/api/src/scenarios/scenarios.service.ts                                      |  10 +-
 packages/db/prisma/migrations/20260509110000_mv_refresh_log/migration.sql (NEW)  |  19 +++
 packages/db/prisma/migrations/20260509120000_perf_composite_indexes/migration.sql (NEW)| 28 +++++
 packages/db/prisma/schema.prisma                                                 |  10 ++
 packages/db/src/scope.ts                                                         |  73 ++++++++++++--
 docs/hardening/15-db-perf.{plan,report}.md                              (NEW)    | this report + plan
 ──────────────────────────────────────────────────────────────────────────────────
 6 files (4 modified + 2 new + 2 docs), +232 / −20
```

---

## Acceptance criteria check

| Criterion | Status |
|---|---|
| 5-minute synthetic Council session — no query > 250 ms mean (outside export) | **operator gate** — requires staging + pg_stat_statements. Procedure documented in §5. The two new composite indexes are the highest-value pre-stage candidates. |
| N+1 sweep — fix the obvious offenders | ✅ scenarios.service.ts collapsed (9 round-trips → 1). Other findings dispositioned in §1. |
| Index plan — composite indexes added where the planner would benefit | ✅ migration `20260509120000_perf_composite_indexes` adds 2 hot-path composites. Schema in lockstep. |
| MV refresh — visible at `/admin/data-quality` | ✅ new `mv_refresh_log` table + `getMvRefreshSnapshots()` + `mvFreshness` field on the response. The auto-refresh wiring (post-ingestion hook) is documented as a Phase D follow-up. |
| Pagination — every list capped, no endpoint > 1000 rows | ✅ Zod `pageSize.max(1000)` on the shared list schemas. Reference-table endpoints (faculties, data-sources) bounded by the dataset itself. |

---

## What this prompt does NOT do

- **Auto-call `refreshMetricViews` on ingestion completion.** The wiring (`onModuleInit` adds a `worker.on('completed', ...)` for selected connectors) is a follow-up that needs care: which connectors trigger the refresh? `kku-research` writes to ResearchOutput which doesn't feed `mv_program_metrics`. `kku-registry` writes to `EnrollmentMetric` which does. Per-connector tagging needed. Documented in §3.
- **EXPLAIN ANALYZE on real data.** Procedure in §5; runs on staging.
- **Add pg_stat_statements to the postgres init SQL.** It needs `shared_preload_libraries` which requires a postgres restart — too disruptive to land as part of an additive migration. Operator does it once on staging at first deploy.
- **Cursor-based pagination for the analyst-tool list responses.** Limit-offset works fine at our scale (≤297 programs); cursor lands when a list approaches 10k+.

The single pre-existing test failure (`packages/db/test/health-score.test.ts`) is unchanged from prompts 05–14. **Net regression from this prompt: zero.**
