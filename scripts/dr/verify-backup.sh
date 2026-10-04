#!/usr/bin/env bash
# verify-backup.sh — restore the latest pg dump into a throwaway
# Postgres container and run structural assertions.
#
# Idempotent: tears down the verify container at start and end. Writes
# a verdict JSON the api can read for /admin/system-status.
#
# Usage:
#   sudo ./scripts/dr/verify-backup.sh [--backup <path>]
#
# Exit codes:
#   0 — verified OK
#   1 — operational failure (script bug, docker unavailable)
#   2 — verification failure (assertions did not pass)
#
# Run by the program-landscape-verify-backup.timer at 03:00 Asia/Bangkok
# nightly (1 h after backup.sh completes — gives the dump time to flush).

set -euo pipefail

DEPLOY_ROOT="${DEPLOY_ROOT:-/opt/program-landscape}"
BACKUPS_DIR="${BACKUPS_DIR:-$DEPLOY_ROOT/backups}"
STATE_DIR="${BACKUP_VERIFY_STATE_DIR:-/var/lib/program-landscape}"
STATE_FILE="$STATE_DIR/backup-verification.json"

VERIFY_CONTAINER="program-landscape-verify-pg"
VERIFY_PORT="${VERIFY_PORT:-55432}"
VERIFY_DB="verify_db"
VERIFY_USER="verify_user"
VERIFY_PASS="verify_pass"
# The dump carries postgis + pgvector types, so the throwaway server MUST
# have both. `postgres:16-alpine` has neither, and prod has no registry
# access to pull it either — verification into it cannot work. Default to
# the same postgis+pgvector image the prod stack runs, resolved from the
# deployed release. Override PG_IMAGE to pin a different one.
if [ -z "${PG_IMAGE:-}" ]; then
  if [ -r "$DEPLOY_ROOT/current/VERSION" ]; then
    PG_IMAGE="ghcr.io/khon-kaen-university/program-landscape-postgres:$(tr -d '[:space:]' < "$DEPLOY_ROOT/current/VERSION")"
  else
    echo "PG_IMAGE unset and $DEPLOY_ROOT/current/VERSION unreadable — set PG_IMAGE explicitly" >&2
    exit 1
  fi
fi

# Override via flag — useful for ad-hoc verification of a specific backup.
BACKUP_FILE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --backup) BACKUP_FILE="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

log() { printf '\033[1;34m[verify-backup]\033[0m %s\n' "$*"; }
fail_op() { printf '\033[1;31m[verify-backup OP-FAIL]\033[0m %s\n' "$*" >&2; emit_verdict "OP_FAILURE" "$*"; exit 1; }
fail_verify() { printf '\033[1;33m[verify-backup VERIFY-FAIL]\033[0m %s\n' "$*" >&2; emit_verdict "FAILED" "$*"; exit 2; }

emit_verdict() {
  local status="$1"
  local detail="${2:-}"
  sudo mkdir -p "$STATE_DIR"
  sudo tee "$STATE_FILE" >/dev/null <<EOF
{
  "verifiedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "status": "$status",
  "backupFile": "$BACKUP_FILE",
  "backupAgeHours": $BACKUP_AGE_HOURS,
  "tableCount": ${TABLE_COUNT:-null},
  "programCount": ${PROGRAM_COUNT:-null},
  "auditLogMaxAgeHours": ${AUDIT_LOG_MAX_AGE_HOURS:-null},
  "auditLogCheck": "${AUDIT_CHECK:-not run}",
  "durationSec": $((SECONDS)),
  "detail": "$(echo "$detail" | head -c 500)"
}
EOF
}

cleanup() {
  log "Cleaning up verify container"
  sudo docker rm -f "$VERIFY_CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# ── 1. Pick the latest backup ────────────────────────────────────────
if [ -z "$BACKUP_FILE" ]; then
  BACKUP_FILE="$(sudo ls -1t "$BACKUPS_DIR"/*.sql.gz 2>/dev/null | head -n1 || true)"
fi
[ -n "$BACKUP_FILE" ] || fail_op "No backups found under $BACKUPS_DIR"
[ -f "$BACKUP_FILE" ] || fail_op "Backup file not found: $BACKUP_FILE"

BACKUP_AGE_HOURS=$(( ( $(date +%s) - $(sudo stat -c %Y "$BACKUP_FILE") ) / 3600 ))
log "Verifying $BACKUP_FILE (${BACKUP_AGE_HOURS} h old)"

# Refuse to "verify" a backup that's older than 26 h — that'd hide
# a stuck backup.sh under a green status. Threshold is 26 h (not 24)
# to absorb timer drift + RandomizedDelaySec.
if [ "$BACKUP_AGE_HOURS" -gt 26 ]; then
  fail_verify "Backup is ${BACKUP_AGE_HOURS} h old (>26 h threshold)"
fi

# ── 2. Spin up throwaway Postgres ────────────────────────────────────
cleanup  # in case a previous run left it
log "Starting throwaway $PG_IMAGE on :$VERIFY_PORT"

sudo docker run -d --rm \
  --name "$VERIFY_CONTAINER" \
  --shm-size=1g \
  -e POSTGRES_USER="$VERIFY_USER" \
  -e POSTGRES_PASSWORD="$VERIFY_PASS" \
  -e POSTGRES_DB="$VERIFY_DB" \
  -p "$VERIFY_PORT:5432" \
  "$PG_IMAGE" >/dev/null

# Readiness MUST be probed over TCP, not the Unix socket. The postgres
# entrypoint runs its init scripts against a temporary server started with
# listen_addresses='' — the socket answers, TCP does not. A socket probe
# therefore returns "ready" while init is still running, and the entrypoint
# then fast-stops that server underneath the restore:
#   pg_restore: error: PQputCopyData: server closed the connection
# Measured on the postgis image 2026-09-06: socket ready t=2s, TCP t=5s.
# `-d` is passed so the probe does not try to open a db named after the
# user (harmless, but it logs a FATAL on every poll).
for i in $(seq 1 120); do
  if sudo docker exec "$VERIFY_CONTAINER" \
       pg_isready -h 127.0.0.1 -U "$VERIFY_USER" -d "$VERIFY_DB" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

sudo docker exec "$VERIFY_CONTAINER" \
  pg_isready -h 127.0.0.1 -U "$VERIFY_USER" -d "$VERIFY_DB" \
  >/dev/null 2>&1 \
  || fail_op "Throwaway postgres did not become ready in 120 s"

# ── 3. Restore the dump ──────────────────────────────────────────────
log "Restoring dump (this will take a few minutes for ~5 GB)"

# Both the dump-format detection and pg_restore live inside the
# verify container — keeps the host clean.
# NO --clean/--if-exists. The target db is thrown away after every run, so
# there is nothing of ours to clean; and on the postgis image the entrypoint
# has already installed postgis + postgis_topology + postgis_tiger_geocoder,
# so `DROP EXTENSION IF EXISTS postgis` fails on its dependents. pg_restore
# ignores that error but then exits 1 — which made this check report FAILED
# on a restore that was in fact complete and correct. Verified prod
# 2026-09-06: with --clean, errors=1 exit=1; the data was intact either way.
sudo zcat "$BACKUP_FILE" \
  | sudo docker exec -i \
      -e PGPASSWORD="$VERIFY_PASS" \
      "$VERIFY_CONTAINER" \
      pg_restore --no-owner --no-acl \
        -U "$VERIFY_USER" -d "$VERIFY_DB" \
  || fail_verify "pg_restore failed — dump corrupted or version mismatch"

# ── 4. Structural assertions ─────────────────────────────────────────
log "Running structural assertions"

# Wraps psql to take a SQL snippet and return a single scalar (or "").
run_q() {
  sudo docker exec -e PGPASSWORD="$VERIFY_PASS" "$VERIFY_CONTAINER" \
    psql -U "$VERIFY_USER" -d "$VERIFY_DB" -At -c "$1" 2>/dev/null
}

# Assertion 1: schema has a sane number of tables (the seed has > 60).
TABLE_COUNT=$(run_q "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public'")
[ -n "$TABLE_COUNT" ] || fail_verify "Could not read table count"
[ "$TABLE_COUNT" -ge 60 ] || fail_verify "Only $TABLE_COUNT public tables (expected ≥ 60)"

# Assertion 2: programs exist + at least one canonical KKU-SEQ-NNNN row.
PROGRAM_COUNT=$(run_q "SELECT COUNT(*) FROM programs WHERE code LIKE 'KKU-SEQ-%'")
[ -n "$PROGRAM_COUNT" ] || fail_verify "Could not read program count"
[ "$PROGRAM_COUNT" -ge 200 ] || fail_verify "Only $PROGRAM_COUNT KKU-SEQ programs (expected ≥ 200)"

# Assertion 3: the dump holds every audit row the LIVE database already had
# when the dump was taken. Catches a backup file that landed on time but came
# from a stalled or partial write path.
#
# This used to be "newest audit_logs row < 26 h old" — wall clock, not the
# live DB. A quiet weekend with no audited activity then read as a broken
# backup: prod 2026-10-03, a dump restored cleanly (151 tables, 301 programs,
# backup age 0 h) and was reported FAILED because nobody had made an audited
# change for 30 h, which blocked a deploy. The file's own freshness is already
# guarded by the 26 h backup-age check above; this check is about CONTENT.
#
# Compare against live rows created at least DUMP_MARGIN_SEC before the dump
# file's mtime (= when pg_dump finished). pg_dump reads one snapshot taken at
# its START, so a row written while it ran may legitimately be missing; the
# margin covers the dump's own runtime (minutes) with room to spare.
AUDIT_LOG_MAX_AGE_HOURS=$(run_q "
  SELECT EXTRACT(EPOCH FROM (NOW() - MAX(created_at)))::INT / 3600
  FROM audit_logs
")
[ -n "$AUDIT_LOG_MAX_AGE_HOURS" ] || fail_verify "audit_logs table empty in restored dump"

DUMP_MARGIN_SEC="${DUMP_MARGIN_SEC:-3600}"
BACKUP_EPOCH=$(sudo stat -c %Y "$BACKUP_FILE")
DUMP_AUDIT_MAX=$(run_q "SELECT COALESCE(EXTRACT(EPOCH FROM MAX(created_at))::BIGINT, 0) FROM audit_logs")

# Live DB, read the same way backup.sh reaches it: exec into the running
# postgres container of the current release (local socket auth).
live_q() {
  local current="$DEPLOY_ROOT/current" pg_user pg_db
  [ -d "$current" ] || return 1
  pg_user="$(sudo cat "$DEPLOY_ROOT/secrets/postgres_user" 2>/dev/null | tr -d '[:space:]')" || return 1
  pg_db="$(sudo grep -E '^POSTGRES_DB=' "$DEPLOY_ROOT/.env.prod" 2>/dev/null | cut -d= -f2 | tr -d '[:space:]')"
  pg_db="${pg_db:-program_landscape}"
  [ -n "$pg_user" ] || return 1
  # </dev/null is load-bearing: `docker compose exec -T` does not exit until
  # its stdin closes, even after psql has. Under the systemd timer stdin is
  # already /dev/null; run by hand from a terminal it is the tty, which never
  # closes — prod 2026-10-04 hung here for 40 min after a 2-min restore.
  # timeout is the backstop; a timed-out query reads as "unreachable" below.
  (cd "$current" && RELEASE_VERSION="$(tr -d '[:space:]' < VERSION)" \
    sudo -E timeout 60 docker compose exec -T postgres \
      psql -U "$pg_user" -d "$pg_db" -At -c "$1" 2>/dev/null </dev/null)
}

LIVE_AUDIT_MAX="$(live_q "
  SELECT COALESCE(EXTRACT(EPOCH FROM MAX(created_at))::BIGINT, 0)
  FROM audit_logs
  WHERE created_at <= to_timestamp($BACKUP_EPOCH - $DUMP_MARGIN_SEC)
" || true)"

if ! [[ "$LIVE_AUDIT_MAX" =~ ^[0-9]+$ ]]; then
  # The restore itself is proven; only the content-vs-live comparison could
  # not run. Do not fail the verdict on that (it would block deploys on a
  # live-DB hiccup), but say so in the verdict so it is visible.
  AUDIT_CHECK="skipped: live database not reachable"
  log "  audit-log check SKIPPED — live database not reachable"
elif [ "$DUMP_AUDIT_MAX" -lt "$LIVE_AUDIT_MAX" ]; then
  fail_verify "Dump is missing audit rows the live database had before it was taken (newest in dump $(date -u -d "@$DUMP_AUDIT_MAX" +%Y-%m-%dT%H:%MZ), live $(date -u -d "@$LIVE_AUDIT_MAX" +%Y-%m-%dT%H:%MZ))"
else
  AUDIT_CHECK="ok: dump matches live"
fi

# Assertion 4: no orphaned data — pick a couple of FK chains the seed
# relies on. If the dump landed mid-transaction, FK references may
# have inconsistencies.
ORPHAN_COUNT=$(run_q "
  SELECT COUNT(*) FROM departments d
  WHERE NOT EXISTS (SELECT 1 FROM faculties f WHERE f.id = d.faculty_id)
")
[ "$ORPHAN_COUNT" = "0" ] || fail_verify "$ORPHAN_COUNT departments missing parent faculty"

log "All assertions passed:"
log "  tables: $TABLE_COUNT"
log "  programs: $PROGRAM_COUNT"
log "  audit-log lag: ${AUDIT_LOG_MAX_AGE_HOURS} h (informational — ${AUDIT_CHECK})"

emit_verdict "OK" ""
log "Verdict written to $STATE_FILE"
