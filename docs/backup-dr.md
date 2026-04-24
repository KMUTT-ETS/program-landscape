# Backup + Disaster Recovery

**Scope:** program-landscape.kku.ac.th running on the on-prem Ubuntu server at `/opt/program-landscape/`. Covers Postgres 16, MinIO, Redis (BullMQ queue state only — transient), and uploaded PDF artefacts.

---

## Backup classes

| Class | Source | Frequency | Retention | Storage |
|---|---|---|---|---|
| **Hot pre-deploy snapshot** | Postgres via `pg_dump --format=custom` | Every `db:migrate:safe` run (before schema migration) | 30 days | MinIO bucket `db-backups/pre-deploy/` |
| **Daily logical** | `pg_dumpall` + MinIO bucket mirror of `pdf-raw` + `pdf-output` | Nightly at 02:00 Asia/Bangkok | 30 days | MinIO bucket `db-backups/daily/` (off-server mirror nightly) |
| **Monthly archive** | Promoted first daily of each month | Monthly | 12 months | Cold storage — KKU IT archive server |
| **Point-in-time (WAL)** | Postgres WAL shipping | Continuous | 7 days of WAL | MinIO bucket `db-backups/wal/` |

The daily + WAL buckets are mirrored to the KKU central archive server nightly at 03:30.

---

## Scripts

All scripts live under `scripts/` and are invoked via `pnpm` so the command shape works the same on dev (WSL) and prod (Ubuntu):

- **`scripts/pre-deploy-snapshot.mjs`** — `pg_dump` + upload to MinIO `db-backups/pre-deploy/<ts>-<sha>.dump`. Idempotent. Runs as part of `pnpm db:migrate:safe` (the recommended deploy script — never run `prisma migrate deploy` raw in prod).
- **`scripts/backup-daily.sh`** — runs `pg_dumpall`, compresses, uploads to `db-backups/daily/YYYY-MM-DD.dump.gz`, prunes entries older than 30 days, promotes the 1st-of-month entry to `db-backups/monthly/`. Invoked by `systemd-timer` on the prod box (unit file in prompt 13b).
- **`scripts/restore.sh <snapshot-key>`** — pulls a snapshot from MinIO, restores into a new Postgres database (**never into the live DB**), then the operator manually swaps.

---

## Restore drill (documented — ran quarterly on a staging box)

Goal: a full restore to a fresh Postgres completes in **≤ 30 minutes** for a 5 GB database.

1. Provision a clean Postgres 16 container with the same extensions (`pnpm db:up` on staging).
2. Pull the desired snapshot:
   ```bash
   aws --endpoint-url $MINIO_PUBLIC_ENDPOINT s3 cp \
     s3://db-backups/pre-deploy/2026-04-24T02-00-00-abc123.dump \
     /tmp/snap.dump
   ```
3. Restore:
   ```bash
   pg_restore --clean --if-exists --no-owner --no-acl \
     --dbname "$STAGING_DATABASE_URL" /tmp/snap.dump
   ```
4. Run `pnpm db:migrate` to catch up any migrations newer than the snapshot.
5. Sanity-check:
   - `select count(*) from programs` → expect ~297.
   - `select max(created_at) from audit_logs` → within 24h of snapshot time.
   - `/api/v1/ready` on the staging api → 200.
6. If swapping into prod: stop web + api + ingestion containers, rename the staging DB into place, restart. Total downtime budget: 5 minutes.

**Last drill:** due `2026-07-15` (first quarterly after launch).

---

## Disaster recovery matrix

| Scenario | Detection | Response | RPO | RTO |
|---|---|---|---|---|
| Bad migration | Smoke test fails after `db:migrate:safe` | Restore latest pre-deploy snapshot → replay manual data diff | 0 | 15 min |
| Postgres volume corruption | `pg_ctl` refuses to start | Provision new volume, restore latest daily, replay WAL | ≤ 24h | 45 min |
| MinIO bucket deleted | Missing PDFs in UI | Restore from KKU archive mirror | ≤ 24h | 60 min |
| Full server loss | Ping fails + KKU IT alert | Provision from pack-and-ship bundle (prompt 13b), restore latest daily, replay WAL | ≤ 24h | 90 min |
| Security breach | Audit-log anomaly / KKU IT alert | Isolate server, swap all secrets (see `docs/runbook-secret-rotation.md`), forensic copy MinIO, restore from clean snapshot | ≤ 1h | Variable |

---

## Operator checklist (prod on-call)

- [ ] Daily backup completion alert received by 03:00 Asia/Bangkok (grafana alert or emailed report).
- [ ] Pre-deploy snapshot listed after every migration (check `db-backups/pre-deploy/` bucket contents or `pnpm db:migrate:safe` console output).
- [ ] Quarterly restore drill green (document outcome in `docs/dr-drills/YYYY-QN.md`).
- [ ] Monthly: verify KKU archive mirror is up to date.
- [ ] Annually: rotate the MinIO `db-backups` bucket credentials.
