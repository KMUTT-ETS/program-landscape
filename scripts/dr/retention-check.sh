#!/usr/bin/env bash
# retention-check.sh — confirm the retention policy from backup.sh
# is actually applied (deletes happen, not just policy on paper).
#
# Walks $BACKUPS_DIR with the same `find` predicates backup.sh uses
# but inverted — anything that SHOULD have been deleted but is still
# present is a violation.
#
# Retention policy (from scripts/backup.sh):
#   *.sql.gz (daily)        — 30 days
#   *-minio.tar.gz          — 30 days
#   monthly-*               — 365 days
#   pre-deploy-*            — 90 days
#
# Usage: sudo ./scripts/dr/retention-check.sh
#
# Exit codes:
#   0 — retention policy is enforced
#   2 — retention violation found

set -euo pipefail

DEPLOY_ROOT="${DEPLOY_ROOT:-/opt/program-landscape}"
BACKUPS_DIR="${BACKUPS_DIR:-$DEPLOY_ROOT/backups}"
STATE_DIR="${BACKUP_VERIFY_STATE_DIR:-/var/lib/program-landscape}"
STATE_FILE="$STATE_DIR/retention-verification.json"

log() { printf '\033[1;34m[retention]\033[0m %s\n' "$*"; }
fail_op() { printf '\033[1;31m[retention OP-FAIL]\033[0m %s\n' "$*" >&2; emit "OP_FAILURE" "$*"; exit 1; }

emit() {
  local status="$1"
  local violations="$2"
  sudo mkdir -p "$STATE_DIR"
  sudo tee "$STATE_FILE" >/dev/null <<EOF
{
  "checkedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "status": "$status",
  "totalBackups": ${TOTAL:-0},
  "stalDailies": ${STALE_DAILIES:-0},
  "staleMinioMirrors": ${STALE_MINIO:-0},
  "staleMonthlies": ${STALE_MONTHLIES:-0},
  "stalePreDeploy": ${STALE_PRE_DEPLOY:-0},
  "violations": $(echo "$violations" | head -c 1000 | python3 -c 'import sys, json; print(json.dumps(sys.stdin.read().splitlines()))')
}
EOF
}

[ -d "$BACKUPS_DIR" ] || fail_op "Backups dir missing: $BACKUPS_DIR"

TOTAL="$(sudo find "$BACKUPS_DIR" -maxdepth 1 -type f | wc -l | tr -d ' ')"

STALE_DAILIES_LIST="$(sudo find "$BACKUPS_DIR" -maxdepth 1 -type f -name '*.sql.gz' -mtime +30 \
  ! -name 'monthly-*' \
  ! -name 'pre-deploy-*' 2>/dev/null || true)"
STALE_DAILIES="$(echo -n "$STALE_DAILIES_LIST" | grep -c '.' || true)"

STALE_MINIO_LIST="$(sudo find "$BACKUPS_DIR" -maxdepth 1 -type f -name '*-minio.tar.gz' -mtime +30 \
  ! -name 'monthly-*' 2>/dev/null || true)"
STALE_MINIO="$(echo -n "$STALE_MINIO_LIST" | grep -c '.' || true)"

STALE_MONTHLIES_LIST="$(sudo find "$BACKUPS_DIR" -maxdepth 1 -type f -name 'monthly-*' -mtime +365 2>/dev/null || true)"
STALE_MONTHLIES="$(echo -n "$STALE_MONTHLIES_LIST" | grep -c '.' || true)"

STALE_PRE_DEPLOY_LIST="$(sudo find "$BACKUPS_DIR" -maxdepth 1 -type f -name 'pre-deploy-*' -mtime +90 2>/dev/null || true)"
STALE_PRE_DEPLOY="$(echo -n "$STALE_PRE_DEPLOY_LIST" | grep -c '.' || true)"

VIOLATIONS=""
[ "$STALE_DAILIES" -gt 0 ] && VIOLATIONS="$VIOLATIONS"$'\n'"$STALE_DAILIES_LIST"
[ "$STALE_MINIO" -gt 0 ] && VIOLATIONS="$VIOLATIONS"$'\n'"$STALE_MINIO_LIST"
[ "$STALE_MONTHLIES" -gt 0 ] && VIOLATIONS="$VIOLATIONS"$'\n'"$STALE_MONTHLIES_LIST"
[ "$STALE_PRE_DEPLOY" -gt 0 ] && VIOLATIONS="$VIOLATIONS"$'\n'"$STALE_PRE_DEPLOY_LIST"

TOTAL_STALE=$((STALE_DAILIES + STALE_MINIO + STALE_MONTHLIES + STALE_PRE_DEPLOY))

log "Total backup files: $TOTAL"
log "Past-retention dailies (>30d): $STALE_DAILIES"
log "Past-retention minio mirrors (>30d): $STALE_MINIO"
log "Past-retention monthlies (>365d): $STALE_MONTHLIES"
log "Past-retention pre-deploys (>90d): $STALE_PRE_DEPLOY"

if [ "$TOTAL_STALE" -gt 0 ]; then
  log "Retention VIOLATION — backup.sh's prune isn't running, or its predicates are wrong"
  emit "FAILED" "$VIOLATIONS"
  exit 2
fi

emit "OK" ""
log "Retention policy enforced."
