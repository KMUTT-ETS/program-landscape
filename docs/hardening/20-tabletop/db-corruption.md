# Tabletop B — Database corruption discovered post-deploy

> **Premise.** A deploy ran cleanly two hours ago. An analyst opens
> `/cockpit` and notices the Faculty of Engineering tile shows
> `programCount=0`, but the AI brief still reads "12 programs at
> risk." Cross-check via SQL: `SELECT COUNT(*) FROM programs WHERE
> faculty_id = '...'` returns 0 — but yesterday it returned 27.
>
> **Suspected cause:** the just-deployed migration backfilled a
> `WHERE faculty_id IS NOT NULL` clause backwards and orphaned rows.

---

## Discovery

- **First signal:** analyst-reported anomaly via Slack/email. NO automated detection
  beyond `/admin/data-quality`'s anomaly scan (which would catch this only if
  enrolment/financial counts dropped, not program counts).
- **Second signal:** `/admin/data-quality` shows a **freshness regression** on `Program` table
  (last update was the migration's UPDATE statement) but no row-count delta tracking on
  programs themselves.

## Runbook

| # | Step | Tool / artefact |
|---|---|---|
| 1 | **Stop writes.** Pause ingestion + scheduled jobs to prevent further damage. | `sudo docker compose stop ingestion` (web/api stay up — read-only). |
| 2 | **Confirm corruption is real, not a session/cache issue.** | `psql … 'SELECT COUNT(*) FROM programs WHERE faculty_id = ...'` against the live DB. |
| 3 | **Capture forensic snapshot of the live (corrupted) DB** before doing anything destructive. | `sudo /opt/program-landscape/current/scripts/backup.sh forensic-$(date +%s)` — labelled as forensic so retention rules don't auto-prune. |
| 4 | **Identify the offending migration.** | `git log --oneline -- packages/db/prisma/migrations/ | head -5` + the `mv_refresh_log` table from prompt 15 (last refreshes) + ingestion-queue logs. |
| 5 | **Look up the pre-deploy snapshot.** | MinIO `db-backups/pre-deploy/` bucket OR the `BACKUPS_DIR/pre-deploy-*` files. The pre-deploy snapshot was taken automatically by `pnpm db:migrate:safe` at deploy phase 5. |
| 6 | **Restore the pre-deploy snapshot into a verify container** to confirm it's clean. | `sudo /opt/program-landscape/current/scripts/dr/verify-backup.sh --backup <pre-deploy-path>` — uses prompt 19's verifier. |
| 7 | **If the verifier reports OK, run `restore.sh` against live.** This is destructive — it overwrites the live DB. | `sudo /opt/program-landscape/current/scripts/restore.sh <pre-deploy-path>`. Stops api/web/ingestion automatically. ~5–15 min wall-clock for ~5 GB DB. |
| 8 | **Roll the code back to the pre-bug release.** | `sudo /opt/program-landscape/current/scripts/rollback.sh` — atomic symlink swap to `releases/<previous-version>`. |
| 9 | **Replay any legitimate writes that landed BETWEEN the pre-deploy snapshot and the corruption discovery.** | This is the hard step. **No automated WAL-replay yet** — operator manually re-runs the affected ingestion connectors via `/admin/data-sources/<slug>/runs`. |
| 10 | **Post-mortem.** File a `CouncilDecision` note with the migration SHA, the affected rows count, and the recovery RTO. | `/decisions` workspace. |

## Acceptance — does the existing tooling cover this?

- ✅ Pre-deploy snapshot exists (auto, per prompt 12 `db:migrate:safe`).
- ✅ Snapshot verifier runs nightly (prompt 19 `verify-backup.sh`); we know the snapshot is restorable.
- ✅ `restore.sh` is operator-confirmed + drains services first (prompt 12 + 14).
- ✅ Rollback script swaps code atomically (prompt 13b `rollback.sh`).
- ✅ Migration linter (prompt 12) would have CAUGHT a destructive UPDATE without `migration-linter:
  allow-destructive` annotation **if** the bug pattern matches an existing rule. But this hypothetical
  `UPDATE programs SET faculty_id = NULL WHERE faculty_id IS NOT NULL` (logic-bug, not destructive-DDL)
  would PASS the linter — see G1.

## Gaps surfaced

| # | Gap | Owner | ETA |
|---|---|---|---|
| G1 | Migration linter (prompt 12) catches destructive **DDL** but not destructive **DML** (`UPDATE … SET col = NULL`). A logic-bug migration that nulls an FK column would pass the linter green. | denpong | follow-up: extend linter with a "row-count-changing UPDATE without WHERE clause" rule. **Pre-launch acceptable risk** — `db:migrate:safe`'s pre-deploy snapshot makes the recovery RTO ≤ 30 min, which matches our DR matrix budget for "bad migration" (prompt 19 §5). |
| G2 | No automated WAL-replay. Step 9 is manual. The DR matrix (prompt 19 §5) admits this: RPO is "≤ 24h" because we run logical backups, not WAL shipping. | denpong | post-launch infra work; acceptable for v1. |
| G3 | No row-count anomaly detection on the Program table specifically (only on enrolment/financial/outcome series per prompt 14 scaffold). | denpong | post-launch — extend `/admin/data-quality` drift detection to per-table row counts of all Council-facing tables. |
| G4 | Discovery relies on a human noticing the anomaly. There is no proactive "X% drop in program count" alert. | denpong | tied to G3 + alerting work (CLAUDE.md "alerting deferred"). |

**Verdict:** **GO with named follow-ups.** The recovery RTO for this scenario
(≤ 30 min from discovery to live-restore-complete) matches the DR matrix budget.
G1 is the most important pre-launch hardening to consider; G2-G4 are
post-launch.
