# Migration `20260511120000_data_quality_provenance`

Closes the two Tier-1 gaps identified in `docs/evaluation-pipeline.md` §13:

| Gap | What this migration does |
|---|---|
| **#1 Mock-data contamination** | Adds `mocked` BOOLEAN to `data_sources`. Promotes the free-text `status='mocked'` convention to an explicit, indexable column. Backfills from the existing convention. |
| **#2 Provenance chain holes** | Adds nullable `ingestion_run_id` FK to 15 metric/fact tables. Every row written after this migration traces back to the originating connector run. |

The migration is **additive only**. No data destruction. Historical metric rows keep `ingestion_run_id = NULL`; the `data-quality.v1` helper treats NULL as "legacy real" until a separate provenance-backfill migration lands.

## Files in this directory

| File | Purpose |
|---|---|
| `migration.sql` | The raw SQL applied by `prisma migrate deploy`. |
| `SCHEMA-PATCH.md` | The matching changes to `packages/db/prisma/schema.prisma` — applied by hand in the same commit. |
| `README.md` | This file. |

## Application sequence

This migration is a **3-step landing**, not a one-shot drop. Each step is independently reversible.

### Step 1 — schema + migration (this PR)

```bash
# 1. Apply the SCHEMA-PATCH.md edits to schema.prisma
$EDITOR packages/db/prisma/schema.prisma

# 2. Regenerate the Prisma client
pnpm prisma generate

# 3. Apply the migration to the dev DB
pnpm prisma migrate deploy

# 4. Verify
psql $DATABASE_URL -c "\\d enrollment_metrics" | grep ingestion_run_id
psql $DATABASE_URL -c "\\d data_sources" | grep mocked

# 5. Confirm typecheck
pnpm typecheck
```

At this point, the database has the new columns + the Prisma client knows about them, but **no scorer has been updated yet**. Existing scores are unchanged. The `realDataWhere()` helper at `packages/db/src/data-quality.ts` is exported but unused.

### Step 2 — wire up the connector runner (follow-up PR)

Update `apps/ingestion/src/connectors/runner.ts` (and the connector base class) so every metric row written by a connector now sets `ingestionRunId` to the active run's id. Existing UPSERT paths (e.g., `program-digest-materialize.ts`) need the same treatment.

This is where mock-data tagging starts working for **new** ingestions. Historical rows still read as NULL → legacy-real.

### Step 3 — wire up the scorers (follow-up PR)

Import `realDataWhere()` from `@kku/db` in each scorer's metric reads. Example diff for `health-score.ts`:

```diff
+ import { realDataWhere } from './data-quality';

  const enrollment = await prisma.enrollmentMetric.findMany({
-   where: { programId },
+   where: { programId, ...realDataWhere() },
    orderBy: { academicYear: 'asc' },
    select: { academicYear: true, enrolled: true },
  });
```

For `$queryRaw` paths (e.g., `scoreAttractivenessScope`), use `realDataSql('t')` and AND it into the WHERE clause.

**Test plan for Step 3:**
- Unit: seed a mocked `DataSource` + `IngestionRun` + 1 `EnrollmentMetric` row tied to it. Assert `findMany({ where: realDataWhere() })` excludes it.
- Integration: pick one program whose only data source is mocked. Assert `computeHealthScores('program', programId)` returns `overall.score = null` + `dataCompletenessPct = 0`.
- Regression: pick a program whose data sources are all real. Assert its health score is byte-identical to the pre-step-3 baseline.

### Step 4 — provenance backfill (follow-up PR, time-of-flight)

One-shot script attributes historical metric rows to their last successful ingestion run. Heuristic: for each row, find the most recent `IngestionRun.completedAt < row.createdAt` on the same `DataSource` (resolved via mapping table or row metadata). Best-effort — rows with no plausible run stay NULL.

After backfill is verified, flip the helper to STRICT (NULL → mock) in `data-quality.v2`. From that point forward, any row without provenance is treated as suspect.

## Tracking

Update `docs/evaluation-pipeline.md` §13 row for gap #1 + #2 when each step lands:
- Step 1 landed → status = "schema applied"
- Step 2 landed → "connector tagging live"
- Step 3 landed → "scorers filter mock data"
- Step 4 landed → "backfill complete + strict mode live"

## Rollback

If Step 1 needs to be reverted before Step 2:

```sql
-- Drop the columns. No code references them yet so this is safe.
ALTER TABLE "enrollment_metrics" DROP COLUMN "ingestion_run_id";
-- ... repeat for the other 14 tables ...
ALTER TABLE "data_sources" DROP COLUMN "mocked";
```

Plus revert `schema.prisma` to its pre-migration state and re-run `prisma generate`. Standard reverse-of-the-PR rollback.

After Step 2 or 3, rollback is more involved — connectors will be writing to a column that no longer exists. Don't rollback past Step 2; instead, ship a forward fix.
