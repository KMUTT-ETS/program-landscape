#!/usr/bin/env bash
# verify-minio.sh — compare live MinIO vs the latest minio-mirror tarball.
#
# Two-pass check:
#   1. Object count: extract the file list from the tar; compare to a live
#      `mc find` count. Tolerate a small delta from in-flight uploads.
#   2. Content: pick 20 random objects, hash both sides, compare.
#
# Usage:
#   sudo ./scripts/dr/verify-minio.sh [--tar <path>] [--sample-size N]
#
# Exit codes:
#   0 — verified OK
#   1 — operational failure (mc unavailable, tar missing, etc.)
#   2 — verification failure (counts diverge or hashes mismatch)

set -euo pipefail

DEPLOY_ROOT="${DEPLOY_ROOT:-/opt/program-landscape}"
BACKUPS_DIR="${BACKUPS_DIR:-$DEPLOY_ROOT/backups}"
STATE_DIR="${BACKUP_VERIFY_STATE_DIR:-/var/lib/program-landscape}"
STATE_FILE="$STATE_DIR/minio-verification.json"

# Tolerable count delta — between the time the tar was written and now,
# legitimate writes happen. 50 objects is a generous bound for an
# overnight gap.
COUNT_DELTA_TOLERANCE="${COUNT_DELTA_TOLERANCE:-50}"

TAR_FILE=""
SAMPLE_SIZE=20

while [ $# -gt 0 ]; do
  case "$1" in
    --tar) TAR_FILE="$2"; shift 2 ;;
    --sample-size) SAMPLE_SIZE="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

log() { printf '\033[1;34m[verify-minio]\033[0m %s\n' "$*"; }
fail_op() { printf '\033[1;31m[verify-minio OP-FAIL]\033[0m %s\n' "$*" >&2; emit "OP_FAILURE" "$*"; exit 1; }
fail_verify() { printf '\033[1;33m[verify-minio VERIFY-FAIL]\033[0m %s\n' "$*" >&2; emit "FAILED" "$*"; exit 2; }

emit() {
  local status="$1"
  local detail="${2:-}"
  sudo mkdir -p "$STATE_DIR"
  sudo tee "$STATE_FILE" >/dev/null <<EOF
{
  "verifiedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "status": "$status",
  "tarFile": "$TAR_FILE",
  "tarAgeHours": $TAR_AGE_HOURS,
  "liveObjectCount": ${LIVE_COUNT:-null},
  "tarObjectCount": ${TAR_COUNT:-null},
  "objectCountDelta": ${COUNT_DELTA:-null},
  "sampleSize": $SAMPLE_SIZE,
  "samplesChecked": ${SAMPLES_CHECKED:-0},
  "samplesMatching": ${SAMPLES_MATCHING:-0},
  "detail": "$(echo "$detail" | head -c 500)"
}
EOF
}

# ── 1. Find latest tar ──────────────────────────────────────────────
if [ -z "$TAR_FILE" ]; then
  TAR_FILE="$(sudo ls -1t "$BACKUPS_DIR"/*-minio.tar.gz 2>/dev/null | head -n1 || true)"
fi
[ -n "$TAR_FILE" ] || fail_op "No MinIO mirror tarball under $BACKUPS_DIR"
[ -f "$TAR_FILE" ] || fail_op "Tar file not found: $TAR_FILE"

TAR_AGE_HOURS=$(( ( $(date +%s) - $(sudo stat -c %Y "$TAR_FILE") ) / 3600 ))
[ "$TAR_AGE_HOURS" -le 26 ] \
  || fail_verify "Mirror tar is ${TAR_AGE_HOURS} h old (>26 h)"

log "Verifying $TAR_FILE (${TAR_AGE_HOURS} h old)"

# ── 2. Object-count comparison ──────────────────────────────────────
log "Counting tar contents"
TAR_COUNT="$(sudo tar -tzf "$TAR_FILE" | grep -v '/$' | wc -l | tr -d ' ')"

log "Counting live MinIO objects"
# `mc` lives in the running minio container.
LIVE_COUNT="$(sudo docker compose -f "$DEPLOY_ROOT/current/docker-compose.prod.yml" \
  exec -T minio sh -lc '
    mc alias set local http://localhost:9000 \
      "$(cat /run/secrets/minio_user)" \
      "$(cat /run/secrets/minio_password)" >/dev/null
    mc find local --type f 2>/dev/null | wc -l
  ' | tr -d ' ')"

[ -n "$LIVE_COUNT" ] || fail_op "Could not count live MinIO objects"

# Live count CAN exceed tar count (writes happened since the snapshot).
# It should NOT be dramatically smaller — that means objects were deleted
# or the live cluster lost data.
COUNT_DELTA=$((LIVE_COUNT - TAR_COUNT))

log "Live: $LIVE_COUNT objects · Tar: $TAR_COUNT objects · Delta: $COUNT_DELTA"

if [ "$COUNT_DELTA" -lt "-$COUNT_DELTA_TOLERANCE" ]; then
  fail_verify "Live count is $((-COUNT_DELTA)) BELOW tar — possible data loss"
fi

# ── 3. Sampled hash comparison ──────────────────────────────────────
log "Sampling $SAMPLE_SIZE random objects from the tar"

# Extract the file list (excluding directory entries), pick N random
# entries. `shuf -n` is the cheap random-sample primitive.
TAR_LIST="$(mktemp)"
SAMPLE_LIST="$(mktemp)"
TAR_HASHES="$(mktemp)"
trap 'rm -f "$TAR_LIST" "$SAMPLE_LIST" "$TAR_HASHES"' EXIT

sudo tar -tzf "$TAR_FILE" | grep -v '/$' > "$TAR_LIST"
shuf -n "$SAMPLE_SIZE" "$TAR_LIST" > "$SAMPLE_LIST"

SAMPLES_CHECKED=0
SAMPLES_MATCHING=0
MISMATCH_DETAIL=""

while IFS= read -r tar_path; do
  SAMPLES_CHECKED=$((SAMPLES_CHECKED + 1))

  # Hash inside the tar.
  tar_hash="$(sudo tar -xzOf "$TAR_FILE" "$tar_path" 2>/dev/null | sha256sum | cut -d' ' -f1)"
  if [ -z "$tar_hash" ]; then
    MISMATCH_DETAIL="$MISMATCH_DETAIL · could not extract $tar_path from tar"
    continue
  fi

  # Hash live. The tar paths look like `./bucket/key`; strip leading `./`
  # and translate to `bucket/key` for `mc cat`.
  obj_path="${tar_path#./}"

  live_hash="$(sudo docker compose -f "$DEPLOY_ROOT/current/docker-compose.prod.yml" \
    exec -T minio sh -lc "
      mc alias set local http://localhost:9000 \
        \"\$(cat /run/secrets/minio_user)\" \
        \"\$(cat /run/secrets/minio_password)\" >/dev/null
      mc cat local/'$obj_path' 2>/dev/null | sha256sum | cut -d' ' -f1
    " 2>/dev/null | tr -d '\r\n ')"

  if [ -z "$live_hash" ]; then
    # Object was likely deleted between snapshot and now — informational.
    MISMATCH_DETAIL="$MISMATCH_DETAIL · live missing: $obj_path"
    continue
  fi

  if [ "$tar_hash" = "$live_hash" ]; then
    SAMPLES_MATCHING=$((SAMPLES_MATCHING + 1))
  else
    MISMATCH_DETAIL="$MISMATCH_DETAIL · hash differs: $obj_path"
  fi
done < "$SAMPLE_LIST"

log "$SAMPLES_MATCHING/$SAMPLES_CHECKED sampled objects match between live + tar"

# Acceptance: at least 90 % of objects we could check on both sides
# matched. (Some live-side missing entries are expected — files DO get
# deleted/replaced legitimately; that's not a verification failure.)
if [ "$SAMPLES_CHECKED" -gt 0 ]; then
  PCT=$(( (SAMPLES_MATCHING * 100) / SAMPLES_CHECKED ))
  if [ "$PCT" -lt 90 ]; then
    fail_verify "Only $PCT% of $SAMPLES_CHECKED sampled objects matched ($MISMATCH_DETAIL)"
  fi
fi

emit "OK" ""
log "Verdict written to $STATE_FILE"
