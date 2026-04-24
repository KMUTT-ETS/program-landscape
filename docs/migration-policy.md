# Database Migration Policy

**Rule:** forward-only migrations. Every migration that's been applied to prod stays applied. Rollback = roll forward with a compensating migration, never `prisma migrate resolve --rolled-back`.

---

## Workflow (dev → prod)

1. **On dev:** edit `packages/db/prisma/schema.prisma`.
2. Generate migration SQL via `prisma migrate diff`:
   ```bash
   pnpm --filter @kku/db exec prisma migrate diff \
     --from-migrations ./prisma/migrations \
     --to-schema-datamodel ./prisma/schema.prisma \
     --shadow-database-url "$SHADOW_DATABASE_URL" \
     --script
   ```
   (Claude Code sessions: we use `--from-empty` + hand-curated migration folders when the shadow DB isn't available — see any of the existing migrations under `packages/db/prisma/migrations/` for the convention.)
3. Name the migration folder `YYYYMMDDHHMMSS_<descriptor>`. Commit both the `migration.sql` and any schema changes in the same PR.
4. Dev smoke: `pnpm db:reset` + `pnpm db:seed` + `pnpm dev` + manual click-through.
5. PR review — at least one other engineer confirms the migration is forward-only (no `DROP TABLE`, no `DROP COLUMN` without a deprecation path).
6. **Prod apply:** SSH to the server, `cd /opt/program-landscape`, run `pnpm db:migrate:safe`. This takes a pre-deploy Postgres snapshot (to MinIO `db-backups/pre-deploy/`) **before** running `prisma migrate deploy`.

---

## What counts as "safe" (mergeable without extra review)

- `ADD COLUMN ... NULL` / with a non-blocking default.
- `CREATE TABLE`, `CREATE INDEX CONCURRENTLY`.
- `ALTER TYPE ... ADD VALUE` (Postgres enum expansion).
- New foreign keys where both sides exist.
- New triggers that only mirror existing behaviour.

## What requires an RFC

- `DROP COLUMN` or column rename.
- `DROP TABLE`.
- Any `ALTER COLUMN` that narrows a type (e.g. `VARCHAR(500)` → `VARCHAR(200)`).
- Bulk data migrations > 10M rows (lock risk).
- Any `ALTER TABLE ... ADD COLUMN NOT NULL` without `DEFAULT` (rewrites the table).

**RFC template:** `docs/rfcs/NNNN-migration-<name>.md` — identify blast radius, rollback plan (forward-compensating migration SQL drafted up-front), and staging drill evidence.

## Column rename / drop procedure (three-release minimum)

1. Release N: add the new column, dual-write from app code.
2. Release N+1 (≥ 2 weeks later): flip reads to the new column; leave dual-write.
3. Release N+2: drop the old column in a new migration.

This is how we avoid "dropped column X that prod was still reading" outages.

---

## Prisma enum expansion

Enum values are append-only by convention — `ALTER TYPE X ADD VALUE IF NOT EXISTS 'NEW_VALUE'`. Never `DROP TYPE` + `CREATE TYPE`. See the `20260423110000_decision_workspace` migration for the canonical pattern.

## Shadow database

For local diffs, set `SHADOW_DATABASE_URL=postgresql://kku:kku@localhost:5433/shadow` and spin a throwaway Postgres (`docker run -d --name shadow-pg -e POSTGRES_PASSWORD=kku -p 5433:5432 postgis/postgis:16-3.4`). Required for `prisma migrate diff --from-migrations`.

## Deploy command reference

| Command | When | What it does |
|---|---|---|
| `pnpm db:migrate` | local dev only | `prisma migrate deploy` — no snapshot |
| `pnpm db:migrate:safe` | **prod apply** | pre-deploy snapshot → `prisma migrate deploy` |
| `pnpm db:reset` | local dev only | drop everything + migrate + seed |
| `pnpm db:backup` | ad-hoc | Just takes a snapshot (no migration) |

Forbidden in prod (all will be rejected by a `NODE_ENV=production` guard in `db:reset`):
- `pnpm db:reset`
- Raw `prisma migrate dev`
- Raw `prisma db push`
