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
PG_IMAGE="${PG_IMAGE:-postgres:16-alpine}"

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
  -e POSTGRES_USER="$VERIFY_USER" \
  -e POSTGRES_PASSWORD="$VERIFY_PASS" \
  -e POSTGRES_DB="$VERIFY_DB" \
  -p "$VERIFY_PORT:5432" \
  "$PG_IMAGE" >/dev/null

# Wait for ready (max 60 s)
for i in $(seq 1 60); do
  if sudo docker exec "$VERIFY_CONTAINER" pg_isready -U "$VERIFY_USER" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

sudo docker exec "$VERIFY_CONTAINER" pg_isready -U "$VERIFY_USER" \
  >/dev/null 2>&1 \
  || fail_op "Throwaway postgres did not become ready in 60 s"

# ── 3. Restore the dump ──────────────────────────────────────────────
log "Restoring dump (this will take a few minutes for ~5 GB)"

# Both the dump-format detection and pg_restore live inside the
# verify container — keeps the host clean.
sudo zcat "$BACKUP_FILE" \
  | sudo docker exec -i \
      -e PGPASSWORD="$VERIFY_PASS" \
      "$VERIFY_CONTAINER" \
      pg_restore --clean --if-exists --no-owner --no-acl \
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

# Assertion 3: audit-log freshness — at least one row in the last 26 h.
# Catches a backup that landed but is from a stalled DB write path.
AUDIT_LOG_MAX_AGE_HOURS=$(run_q "
  SELECT EXTRACT(EPOCH FROM (NOW() - MAX(created_at)))::INT / 3600
  FROM audit_logs
")
[ -n "$AUDIT_LOG_MAX_AGE_HOURS" ] || fail_verify "audit_logs table empty in restored dump"
if [ "$AUDIT_LOG_MAX_AGE_HOURS" -gt 26 ]; then
  fail_verify "Newest audit_logs row is ${AUDIT_LOG_MAX_AGE_HOURS} h old (>26 h)"
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
log "  audit-log lag: ${AUDIT_LOG_MAX_AGE_HOURS} h"

emit_verdict "OK" ""
log "Verdict written to $STATE_FILE"
