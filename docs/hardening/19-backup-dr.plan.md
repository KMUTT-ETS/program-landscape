# Plan — Prompt 19: Backup & restore drill automation

**Mode:** code change + operator-doc. Scripts ship from this dev box; the actual end-to-end
restore-drill timing is the operator gate (requires the prod compose + a real recent backup).

## Recon

| Asset | State |
|---|---|
| `docs/backup-dr.md` | Documented; covers pg_dump custom format + MinIO mirror tar; retention class table; manual restore-drill checklist (last drill due 2026-07-15). |
| `scripts/backup.sh` | Nightly job: pg_dump (custom-format, gzipped) + MinIO `mc mirror` tarball; retention `find -mtime` deletes. |
| `scripts/restore.sh` | Operator-confirmed `pg_restore --clean --if-exists` into the **live** DB; no isolated path. |
| `scripts/pre-deploy-snapshot.mjs` | Pre-migration MinIO upload. |
| `infra/systemd/program-landscape-backup.{service,timer}` | Fires 02:00 Asia/Bangkok daily. |
| Off-server mirror | Documented (KKU central archive 03:30 nightly), but **no script in repo** — done by KKU IT-managed rclone job. We have to surface a state file from THEIR side. |
| `/admin/system-status` | Composite ops dashboard exists; no backup-verification tile yet. |

## What this prompt actually delivers from the dev machine

| Scope item | Action |
|---|---|
| 1. Backup verification (nightly) | NEW `scripts/dr/verify-backup.sh` — picks latest dump, restores into a throwaway `postgres:16` container (port-isolated, named `program-landscape-verify`), runs structural assertions (table count ≥ N, sentinel rows present, audit-log freshness within 26 h), tears down, writes verdict JSON to `/var/lib/program-landscape/backup-verification.json`. |
| 2. MinIO backup integrity | NEW `scripts/dr/verify-minio.sh` — counts objects in the live MinIO vs the latest minio tarball; samples 20 random objects and SHA-256s each side. Verdict JSON to `/var/lib/program-landscape/minio-verification.json`. |
| 3. Off-server mirror check | We can't reach KKU's archive box directly. The KKU mirror script writes a stamp file to a known MinIO key (`db-backups/_mirror_status.json`) on completion. NEW `scripts/dr/check-mirror.sh` reads that stamp + asserts age < 26 h. State to `/var/lib/program-landscape/mirror-verification.json`. |
| 4. Restore-drill script | NEW `scripts/dr/restore-drill.sh` — spins up an isolated docker-compose stack (different project name + ports) with the latest backup restored, then runs the Playwright smoke from prompt 18 against it. |
| 5. Retention enforcement check | NEW `scripts/dr/retention-check.sh` — `find -mtime` assertions verify no backups outside their retention window are still present. |
| `/admin/system-status` tile | NEW `BackupVerificationService` reads the 3 JSON state files; `system-status.controller.ts` adds `backup` block (last verify timestamp + verdict + retention status + mirror age). |
| Systemd unit | NEW `program-landscape-verify-backup.{service,timer}` firing at 03:00 Asia/Bangkok (1 h after backup completes). |

## What requires staging / prod (operator gate, documented)

- **First-run timing measurement.** The acceptance criterion ("from-cold restore drill <30 min")
  needs a real backup against the real database size (~5 GB target per `docs/backup-dr.md`).
  The script ships the timing harness; the operator captures the first measurement in the
  report's "Drill log" section.
- **KKU IT mirror stamp file format.** We define the expected schema (`{lastMirrorAt, sourceCount,
  destCount}`); KKU IT's rclone wrapper script needs to be updated to write this. Documented
  as the prod-deploy gate.

## Out of scope

- WAL shipping setup. Documented as a class in `docs/backup-dr.md` but not yet wired (Postgres
  config + archive script + replay during restore are a multi-day deliverable).
- Alerting (PagerDuty / SMS). The verdict surfaces at `/admin/system-status` as red text; real
  paging is the operator's tooling choice (currently log-loud + status-page red per
  CLAUDE.md "alerting deferred").
- Backup encryption-at-rest. MinIO bucket-level KMS is documented as a follow-up in
  `docs/backup-dr.md`.
- Auto-promotion of monthly archives to KKU's IT-managed cold storage. Today the operator
  uploads manually; a `mc cp` script + cron would close this.
