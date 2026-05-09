#!/usr/bin/env bash
# check-mirror.sh — confirm the off-server (KKU IT central archive)
# mirror ran recently.
#
# The KKU IT-managed rclone wrapper is expected to write a stamp file
# to MinIO at `db-backups/_mirror_status.json` upon completion. Its
# format:
#
#   {
#     "lastMirrorAt": "2026-05-09T03:30:42Z",
#     "sourceCount":  1234,
#     "destCount":    1234,
#     "byteSize":     12345678
#   }
#
# We pull that stamp via `mc cat`, parse the timestamp, assert age < 26 h,
# and write our own state file for /admin/system-status.
#
# Usage: sudo ./scripts/dr/check-mirror.sh
#
# Exit codes:
#   0 — mirror is fresh
#   1 — operational failure (mc unavailable, stamp missing)
#   2 — mirror is stale (> 26 h)

set -euo pipefail

DEPLOY_ROOT="${DEPLOY_ROOT:-/opt/program-landscape}"
STATE_DIR="${BACKUP_VERIFY_STATE_DIR:-/var/lib/program-landscape}"
STATE_FILE="$STATE_DIR/mirror-verification.json"
STAMP_KEY="db-backups/_mirror_status.json"
STALE_HOURS="${STALE_HOURS:-26}"

log() { printf '\033[1;34m[check-mirror]\033[0m %s\n' "$*"; }
fail_op() { printf '\033[1;31m[check-mirror OP-FAIL]\033[0m %s\n' "$*" >&2; emit "OP_FAILURE" "$*"; exit 1; }
fail_verify() { printf '\033[1;33m[check-mirror VERIFY-FAIL]\033[0m %s\n' "$*" >&2; emit "FAILED" "$*"; exit 2; }

emit() {
  local status="$1"
  local detail="${2:-}"
  sudo mkdir -p "$STATE_DIR"
  sudo tee "$STATE_FILE" >/dev/null <<EOF
{
  "checkedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "status": "$status",
  "lastMirrorAt": "${LAST_MIRROR_AT:-null}",
  "mirrorAgeHours": ${MIRROR_AGE_HOURS:-null},
  "sourceCount": ${SOURCE_COUNT:-null},
  "destCount": ${DEST_COUNT:-null},
  "detail": "$(echo "$detail" | head -c 500)"
}
EOF
}

# Pull the stamp from MinIO.
STAMP_JSON="$(sudo docker compose -f "$DEPLOY_ROOT/current/docker-compose.prod.yml" \
  exec -T minio sh -lc "
    mc alias set local http://localhost:9000 \
      \"\$(cat /run/secrets/minio_user)\" \
      \"\$(cat /run/secrets/minio_password)\" >/dev/null
    mc cat local/$STAMP_KEY 2>/dev/null
  " 2>/dev/null || true)"

[ -n "$STAMP_JSON" ] || fail_op "Mirror stamp missing at minio://$STAMP_KEY — has KKU IT's rclone wrapper run yet?"

# Extract the last-mirror timestamp. We use a tiny python one-liner
# rather than jq to keep the system dependency surface lean (jq is
# nice-to-have, python3 ships with Ubuntu by default).
LAST_MIRROR_AT="$(echo "$STAMP_JSON" | python3 -c 'import sys, json; d=json.load(sys.stdin); print(d.get("lastMirrorAt", ""))' 2>/dev/null || true)"
SOURCE_COUNT="$(echo "$STAMP_JSON" | python3 -c 'import sys, json; d=json.load(sys.stdin); print(d.get("sourceCount", 0))' 2>/dev/null || echo "null")"
DEST_COUNT="$(echo "$STAMP_JSON" | python3 -c 'import sys, json; d=json.load(sys.stdin); print(d.get("destCount", 0))' 2>/dev/null || echo "null")"

[ -n "$LAST_MIRROR_AT" ] || fail_op "Mirror stamp present but lastMirrorAt missing/empty"

LAST_TS="$(date -u -d "$LAST_MIRROR_AT" +%s 2>/dev/null || true)"
[ -n "$LAST_TS" ] || fail_op "Could not parse lastMirrorAt: $LAST_MIRROR_AT"

NOW_TS="$(date -u +%s)"
MIRROR_AGE_HOURS=$(( (NOW_TS - LAST_TS) / 3600 ))

log "Mirror last ran $LAST_MIRROR_AT (${MIRROR_AGE_HOURS} h ago)"
log "Source/dest counts: $SOURCE_COUNT / $DEST_COUNT"

if [ "$MIRROR_AGE_HOURS" -gt "$STALE_HOURS" ]; then
  fail_verify "Mirror is ${MIRROR_AGE_HOURS} h old (threshold ${STALE_HOURS} h)"
fi

# Source/dest count mismatch is concerning — likely an in-progress
# sync, or partial failure on KKU's side. Warn but don't fail; KKU IT
# would need to investigate via their rclone log.
if [ "$SOURCE_COUNT" != "$DEST_COUNT" ] && [ "$SOURCE_COUNT" != "null" ]; then
  log "WARN: source ($SOURCE_COUNT) != dest ($DEST_COUNT)"
fi

emit "OK" ""
log "Verdict written to $STATE_FILE"
