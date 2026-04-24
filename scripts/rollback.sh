#!/usr/bin/env bash
# rollback.sh — roll back to the previous release.
#
# Usage:
#   sudo ./scripts/rollback.sh                 # previous release
#   sudo ./scripts/rollback.sh 1.1.0           # specific version
#
# Flow:
#   1. Identify the target version (arg or second-newest release).
#   2. Optionally restore the latest pre-deploy DB snapshot.
#   3. Flip the `current` symlink.
#   4. docker compose up -d to start the old images.
#   5. Smoke test.
#
# NOTE: database rollback is ONLY safe when the destination version's
# schema is a prefix of the current schema. Our migration policy is
# forward-only (docs/migration-policy.md); rolling back a schema
# change requires a compensating migration, NOT a DB restore. The
# DB-restore prompt below is an escape-hatch for the
# "deploy was bad + migration applied data destruction" scenario.

set -euo pipefail

DEPLOY_ROOT="${DEPLOY_ROOT:-/opt/program-landscape}"
RELEASES_DIR="$DEPLOY_ROOT/releases"
CURRENT_LINK="$DEPLOY_ROOT/current"
BACKUPS_DIR="$DEPLOY_ROOT/backups"

TARGET="${1:-}"
log() { printf '\033[1;34m[rollback]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[rollback FAIL]\033[0m %s\n' "$*" >&2; exit 1; }

[ -d "$RELEASES_DIR" ] || fail "$RELEASES_DIR does not exist"

if [ -z "$TARGET" ]; then
  # Second-newest release by mtime.
  TARGET="$(ls -1t "$RELEASES_DIR" 2>/dev/null | sed -n '2p' || true)"
  [ -n "$TARGET" ] || fail "no previous release found in $RELEASES_DIR"
fi

[ -d "$RELEASES_DIR/$TARGET" ] || fail "release not found: $TARGET"

CURRENT_VERSION="?"
if [ -L "$CURRENT_LINK" ]; then
  CURRENT_VERSION="$(basename "$(readlink -f "$CURRENT_LINK")")"
fi

log "Current : $CURRENT_VERSION"
log "Target  : $TARGET"

# ── DB restore (optional) ─────────────────────────────────────────────
# Look for a snapshot taken just before the current version was
# deployed. If it's present, offer to restore.
LATEST_SNAPSHOT="$(ls -1t "$BACKUPS_DIR"/pre-deploy-*.sql.gz 2>/dev/null | head -1 || true)"
if [ -n "$LATEST_SNAPSHOT" ]; then
  log "Latest pre-deploy snapshot: $LATEST_SNAPSHOT"
  read -r -p "Restore DB from this snapshot? (y/N) " confirm
  if [ "$confirm" = "y" ] || [ "$confirm" = "Y" ]; then
    if [ -x "$CURRENT_LINK/scripts/restore.sh" ]; then
      sudo DEPLOY_ROOT="$DEPLOY_ROOT" "$CURRENT_LINK/scripts/restore.sh" "$LATEST_SNAPSHOT"
    else
      fail "restore.sh not executable"
    fi
  else
    log "Skipping DB restore"
  fi
else
  log "No pre-deploy snapshot present — skipping DB restore"
fi

# ── Flip symlink ──────────────────────────────────────────────────────
log "Flipping current → $TARGET"
sudo ln -sfn "$RELEASES_DIR/$TARGET" "$CURRENT_LINK.new"
sudo mv -Tf "$CURRENT_LINK.new" "$CURRENT_LINK"

# ── Restart stack ─────────────────────────────────────────────────────
cd "$CURRENT_LINK"
export RELEASE_VERSION="$TARGET"
log "Starting services at v${TARGET}"
sudo -E docker compose up -d --remove-orphans

# ── Wait + smoke ──────────────────────────────────────────────────────
log "Waiting up to 120s for health"
for _ in $(seq 1 60); do
  CURRENT_HEALTHY="$(sudo docker compose ps --format '{{.Status}}' | grep -c 'healthy' || true)"
  if [ "$CURRENT_HEALTHY" -ge 6 ]; then break; fi
  sleep 2
done

if [ -x "$CURRENT_LINK/scripts/smoke-test.sh" ]; then
  sudo "$CURRENT_LINK/scripts/smoke-test.sh" || fail "smoke test failed after rollback"
fi

log "Rolled back to v${TARGET}"
