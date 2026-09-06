#!/usr/bin/env bash
# restore-drill.sh — full disaster-recovery rehearsal.
#
# Spins up an isolated docker-compose stack from the latest backup
# (different project name + ports so prod stays untouched), restores
# the dump into its postgres, then runs the Playwright smoke from
# prompt 18 against it. Tears down on success.
#
# Acceptance criterion (per docs/hardening/19-backup-dr.report.md):
#   end-to-end (image load → restore → smoke pass) in <30 minutes.
#
# Usage:
#   sudo ./scripts/dr/restore-drill.sh [--backup <path>] [--keep]
#
# Flags:
#   --backup <path>   Use a specific backup file. Default: latest.
#   --keep            Don't tear down on success — leave the stack
#                     running for manual inspection. (Always tears
#                     down on failure unless --keep-on-failure is set.)
#
# Exit codes:
#   0 — drill green for the phases that are implemented
#   1 — operational failure (docker, missing artefacts)
#   2 — restore or assertions failed
#
# SCOPE (2026-09-06): phases 1-4 (pick backup, isolated pg, pg_restore,
# structural assertions) are implemented. Phases 5-6 (app stack against the
# restored DB + smoke) are NOT. Runs record DB-ONLY in the drill index;
# preflight gate 7 renders that as a WARN, never a PASS.

set -euo pipefail

DEPLOY_ROOT="${DEPLOY_ROOT:-/opt/program-landscape}"
# Deployed boxes have docker-compose.yml (build-release.ts renames
# docker-compose.prod.yml on the way into the bundle); a dev checkout has the
# prod name. Prefer the deployed one. See the fuller note in check-mirror.sh.
COMPOSE_FILE="$DEPLOY_ROOT/current/docker-compose.yml"
[ -f "$COMPOSE_FILE" ] || COMPOSE_FILE="$DEPLOY_ROOT/current/docker-compose.prod.yml"
BACKUPS_DIR="${BACKUPS_DIR:-$DEPLOY_ROOT/backups}"
DRILL_PROJECT="${DRILL_PROJECT:-program-landscape-drill}"
DRILL_HTTP_PORT="${DRILL_HTTP_PORT:-8543}"
DRILL_API_PORT="${DRILL_API_PORT:-4543}"
DRILL_PG_PORT="${DRILL_PG_PORT:-55433}"
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
LOG_DIR="${DRILL_LOG_DIR:-$DEPLOY_ROOT/dr-drills}"
TS="$(date +%Y-%m-%dT%H-%M-%S)"
LOG="$LOG_DIR/$TS.log"

BACKUP_FILE=""
KEEP=0

while [ $# -gt 0 ]; do
  case "$1" in
    --backup) BACKUP_FILE="$2"; shift 2 ;;
    --keep) KEEP=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

sudo mkdir -p "$LOG_DIR"

# Phase timer — captures duration of each step for the report.
declare -A PHASE_SEC
PHASE_START=$(date +%s)

mark() {
  local name="$1"
  PHASE_SEC[$name]=$(( $(date +%s) - PHASE_START ))
  PHASE_START=$(date +%s)
}

log() { printf '\033[1;34m[restore-drill]\033[0m %s\n' "$*" | sudo tee -a "$LOG" ; }
fail_op() { printf '\033[1;31m[restore-drill OP-FAIL]\033[0m %s\n' "$*" | sudo tee -a "$LOG" >&2; teardown; exit 1; }
fail_drill() { printf '\033[1;33m[restore-drill DRILL-FAIL]\033[0m %s\n' "$*" | sudo tee -a "$LOG" >&2; teardown; exit 2; }

teardown() {
  if [ "$KEEP" = "1" ]; then
    log "--keep set; leaving drill stack up. Tear down manually with:"
    log "  sudo docker compose -p $DRILL_PROJECT down -v"
    return
  fi
  log "Tearing down drill stack"
  sudo docker compose -p "$DRILL_PROJECT" down -v >>"$LOG" 2>&1 || true
  sudo docker rm -f "${DRILL_PROJECT}-pg" >>"$LOG" 2>&1 || true
}

log "═══════════════════════════════════════════════════════════════"
log "Restore drill — $TS"
log "Log file: $LOG"
log "═══════════════════════════════════════════════════════════════"

# ── 1. Pick backup ────────────────────────────────────────────────
if [ -z "$BACKUP_FILE" ]; then
  BACKUP_FILE="$(sudo ls -1t "$BACKUPS_DIR"/*.sql.gz 2>/dev/null | head -n1 || true)"
fi
[ -n "$BACKUP_FILE" ] || fail_op "No backup found"
[ -f "$BACKUP_FILE" ] || fail_op "Backup not found: $BACKUP_FILE"

BACKUP_AGE_HOURS=$(( ( $(date +%s) - $(sudo stat -c %Y "$BACKUP_FILE") ) / 3600 ))
BACKUP_SIZE="$(du -h "$BACKUP_FILE" | cut -f1)"
log "Backup: $BACKUP_FILE (${BACKUP_SIZE}, ${BACKUP_AGE_HOURS} h old)"
mark pick_backup

# ── 2. Spin up isolated postgres for restore ──────────────────────
log "Phase 2 — provisioning isolated postgres"
sudo docker rm -f "${DRILL_PROJECT}-pg" >/dev/null 2>&1 || true

sudo docker run -d \
  --name "${DRILL_PROJECT}-pg" \
  --shm-size=1g \
  -e POSTGRES_USER=drill \
  -e POSTGRES_PASSWORD=drill \
  -e POSTGRES_DB=drill_db \
  -p "$DRILL_PG_PORT:5432" \
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
  sudo docker exec "${DRILL_PROJECT}-pg" \
    pg_isready -h 127.0.0.1 -U drill -d drill_db >/dev/null 2>&1 && break
  sleep 1
done
sudo docker exec "${DRILL_PROJECT}-pg" \
  pg_isready -h 127.0.0.1 -U drill -d drill_db >/dev/null 2>&1 \
  || fail_op "Drill postgres did not start"
mark provision_pg

# ── 3. Restore dump ───────────────────────────────────────────────
log "Phase 3 — restoring dump (this is the long pole)"
# See the matching note in verify-backup.sh: --clean makes pg_restore exit 1
# on the postgis image's pre-installed extensions, failing a good restore.
sudo zcat "$BACKUP_FILE" \
  | sudo docker exec -i \
      -e PGPASSWORD=drill \
      "${DRILL_PROJECT}-pg" \
      pg_restore --no-owner --no-acl \
        -U drill -d drill_db \
  >>"$LOG" 2>&1 \
  || fail_drill "pg_restore failed — see $LOG"
mark pg_restore

# ── 4. Quick assertions on restored DB (cheap pre-flight) ────────
log "Phase 4 — pre-flight assertions"
# These four assertions mirror verify-backup.sh. While phases 5-6 are
# unimplemented they are the ONLY thing standing between "pg_restore
# exited 0" and "the backup is actually usable", so they are not optional.
run_q() {
  sudo docker exec -e PGPASSWORD=drill "${DRILL_PROJECT}-pg" \
    psql -U drill -d drill_db -At -c "$1" 2>/dev/null
}

TABLE_COUNT="$(run_q "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public'")"
[ "$TABLE_COUNT" -ge 60 ] 2>/dev/null \
  || fail_drill "Only $TABLE_COUNT tables in restored DB"

PROGRAM_COUNT="$(run_q "SELECT COUNT(*) FROM programs WHERE code LIKE 'KKU-SEQ-%'")"
[ "$PROGRAM_COUNT" -ge 200 ] 2>/dev/null \
  || fail_drill "Only $PROGRAM_COUNT KKU-SEQ programs in restored DB (expected >= 200)"

ORPHAN_COUNT="$(run_q "SELECT COUNT(*) FROM departments d WHERE NOT EXISTS (SELECT 1 FROM faculties f WHERE f.id = d.faculty_id)")"
[ "$ORPHAN_COUNT" = "0" ] \
  || fail_drill "$ORPHAN_COUNT departments missing parent faculty"

AUDIT_LAG_H="$(run_q "SELECT EXTRACT(EPOCH FROM (NOW() - MAX(created_at)))::INT / 3600 FROM audit_logs")"
[ -n "$AUDIT_LAG_H" ] || fail_drill "audit_logs empty in restored dump"

log "Restored DB: ${TABLE_COUNT} tables, ${PROGRAM_COUNT} programs, ${ORPHAN_COUNT} orphans, audit lag ${AUDIT_LAG_H} h"
mark assertions

# ── 5. Bring up the drill stack pointed at the restored DB ────────
log "Phase 5 — booting drill compose stack"

# Use the existing prod compose, but with overrides:
#   - different project name (-p) → isolated networks/volumes
#   - different host ports for nginx + api
#   - DATABASE_URL pointed at the restored postgres on the host

if [ ! -f "$COMPOSE_FILE" ]; then
  fail_op "no compose file under $DEPLOY_ROOT/current (looked for docker-compose.yml, then docker-compose.prod.yml)"
fi

# Capture image versions to show "from cold" load happened.
log "Loading required images (already-loaded layers fast-path)"
# (Production deploy has the images present from the bundle; on a real
# from-cold drill the operator would run `docker load < images.tar`
# before invoking this script.)

# Bring up only the runtime services. The drill DB lives outside the
# compose project (we restored into the standalone container above),
# so api connects to it via host network.
DRILL_DATABASE_URL="postgresql://drill:drill@host.docker.internal:$DRILL_PG_PORT/drill_db?schema=public"

# Note: the actual smoke test against the drill stack runs from this
# script's host. Nginx upstream URLs + service deps are whatever the
# prod compose configures; we accept that the drill stack is ALMOST
# the same as prod and is gated by the smoke pass/fail.

# Skipped here for non-destructive demo; production runbook (in
# 19-backup-dr.report.md §"Drill log") spells out the env-overlay file
# the operator drops into the project to pin DATABASE_URL + ports.
# NOT IMPLEMENTED. Phases 5 and 6 — bring the app stack up against the
# restored database, then smoke it — have never been written. This drill
# therefore proves the DATABASE half only, and the index row below records
# DB-ONLY rather than OK.
#
# Do NOT "simplify" that back to OK. preflight.sh gate 7 reads this column,
# and an OK here reports a full disaster-recovery rehearsal that did not
# happen — the exact false-pass this script shipped with until 2026-09-06.
DRILL_SCOPE="DB-ONLY"
log "Phases 5-6 NOT IMPLEMENTED — recording scope=$DRILL_SCOPE (database restore only)"
mark compose_up

# ── 6. Run the Playwright smoke against the drill stack ───────────
# Documented separately — this script's invocation surface stops at
# stack-up; the operator runs:
#   PLAYWRIGHT_BASE_URL=http://localhost:$DRILL_HTTP_PORT \
#     pnpm --filter web test:e2e
# and reports pass/fail back to this log.

# ── 7. Total + report ─────────────────────────────────────────────
TOTAL_SEC=0
for k in pick_backup provision_pg pg_restore assertions compose_up; do
  TOTAL_SEC=$((TOTAL_SEC + ${PHASE_SEC[$k]:-0}))
done

log "═══════════════════════════════════════════════════════════════"
log "Drill complete — scope=$DRILL_SCOPE. Phase timing:"
for k in pick_backup provision_pg pg_restore assertions compose_up; do
  log "  $k: ${PHASE_SEC[$k]:-0} s"
done
log "Total (excluding smoke): ${TOTAL_SEC} s"
log "═══════════════════════════════════════════════════════════════"

# Append to drill log index for easy operator navigation.
sudo tee -a "$LOG_DIR/index.tsv" >/dev/null <<EOF
$TS	$BACKUP_FILE	${BACKUP_SIZE}	${TOTAL_SEC}s	${DRILL_SCOPE}
EOF

teardown
