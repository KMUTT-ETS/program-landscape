# Plan — Prompt 15: DB query/index audit, MV freshness

**Mode:** code change + operator-doc. Static analysis covers items 1, 3, 4. The full EXPLAIN-driven items 2 + 5 require a representative dataset on staging — documented as the operator gate.

## What this prompt actually delivers from the dev machine

| Item | What I can do here | What needs staging |
|---|---|---|
| 1. N+1 sweep | grep + fix the obvious patterns | profile to confirm wins |
| 2. Index plan | propose candidate indexes from route-level filters | EXPLAIN ANALYZE on real data to confirm planner picks them |
| 3. MV refresh | verify wiring + surface freshness in `/admin/data-quality` | watch in prod |
| 4. Pagination | grep findMany without `take` + add caps | n/a |
| 5. Hot-path profiling | document the procedure | run on staging |
| Acceptance test (5-min synthetic Council session, `pg_stat_statements` < 250ms) | document the queries to enable + the observability surface | run on staging |

## Order of work

1. **N+1 grep** — find `for (const x of items) await prisma.*` patterns. Fix the worst.
2. **Pagination grep** — find `prisma.*.findMany` without `take`. Add caps to list endpoints. The Zod query schemas already enforce caps for the cockpit / programs list — verify per route.
3. **MV refresh wiring** — confirm `refreshMetricViews()` is invoked on ingestion completion. Surface `last_refresh_at` + `row_count` per MV at `/admin/data-quality`.
4. **Candidate indexes** — additive migration. Pick by:
   - explicit filters in route handlers (`where: { facultyId, year }` patterns).
   - JOIN keys not already covered by the schema's `@@index`.
   - Composite (filter + orderBy) where ordering matters.
5. **Operator EXPLAIN procedure** — document `enable pg_stat_statements`, the 10 queries to capture, and the staging acceptance gate.

## Out of scope

- Adding pg_stat_statements to the postgres image init (it's a contrib module that ships with the postgis image but needs `shared_preload_libraries` config — staging-only first to avoid prod-init churn).
- Materialising new MVs (current MVs are sufficient per scope helpers).
- Switching to cursor pagination (limit-offset is fine for the row-counts we have; cursor lands when a list approaches 10k+).
