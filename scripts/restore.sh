#!/usr/bin/env bash
# restore.sh — pg_restore a backup into the live Postgres.
#
# Usage:
#   sudo ./scripts/restore.sh /opt/program-landscape/backups/<label>.sql.gz
#
# What it does:
#   1. Requires interactive confirmation (typing "restore").
#   2. Stops api + ingestion + web (no writes during restore).
#   3. `pg_restore --clean --if-exists` inside the postgres container.
#   4. Restarts the stack.
#
# Does NOT restore MinIO by default — that's a much larger payload and
# usually not the bottleneck. For a full recovery, use restore-minio.sh
# (lands post-launch when a real incident calls for it).

set -euo pipefail

BACKUP_FILE="${1:-}"
DEPLOY_ROOT="${DEPLOY_ROOT:-/opt/program-landscape}"
CURRENT_LINK="$DEPLOY_ROOT/current"

log() { printf '\033[1;34m[restore]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[restore FAIL]\033[0m %s\n' "$*" >&2; exit 1; }

[ -n "$BACKUP_FILE" ] || fail "usage: restore.sh <backup.sql.gz>"
[ -f "$BACKUP_FILE" ] || fail "backup not found: $BACKUP_FILE"
[ -L "$CURRENT_LINK" ] || fail "$CURRENT_LINK not set"

cd "$CURRENT_LINK"

# Keep compose from resolving every ${RELEASE_VERSION} image to a blank tag.
# See the fuller note in backup.sh — same block, keep them in step.
if [ -z "${RELEASE_VERSION:-}" ] && [ -r "$CURRENT_LINK/VERSION" ]; then
  RELEASE_VERSION="$(tr -d '[:space:]' < "$CURRENT_LINK/VERSION")"
  export RELEASE_VERSION
fi

PG_USER="$(sudo cat "$DEPLOY_ROOT/secrets/postgres_user" | tr -d '[:space:]')"
PG_DB="$(grep -E '^POSTGRES_DB=' "$DEPLOY_ROOT/.env.prod" | cut -d= -f2 | tr -d '[:space:]')"
PG_DB="${PG_DB:-program_landscape}"

log "About to RESTORE $BACKUP_FILE into $PG_DB"
log "This will destroy current data. Type 'restore' to confirm."
read -r confirm
[ "$confirm" = "restore" ] || fail "aborted"

log "Stopping api + ingestion + web"
sudo docker compose stop api ingestion web

log "Restoring via pg_restore"
# pg_dump --format=custom output works with pg_restore; gzipped input
# streamed through zcat.
sudo zcat "$BACKUP_FILE" \
  | sudo docker compose exec -T postgres \
      pg_restore --clean --if-exists --no-owner --no-acl \
        --username "$PG_USER" --dbname "$PG_DB"

log "Restarting services"
sudo docker compose start api ingestion web

log "Waiting 30s for services"
sleep 30

if [ -x "$CURRENT_LINK/scripts/smoke-test.sh" ]; then
  sudo "$CURRENT_LINK/scripts/smoke-test.sh" || log "WARNING: smoke test failed — inspect the restored DB manually"
fi

log "Restore complete."
