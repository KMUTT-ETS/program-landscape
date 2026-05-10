#!/usr/bin/env bash
# backup.sh — dump Postgres + mirror MinIO, rotate old backups.
#
# Usage:
#   sudo ./scripts/backup.sh                 # auto-labelled with timestamp
#   sudo ./scripts/backup.sh pre-deploy-1.2  # custom label
#
# Emits:
#   /opt/program-landscape/backups/<label>.sql.gz
#   /opt/program-landscape/backups/<label>-minio.tar.gz
#
# Retention (enforced here):
#   daily pg dumps: 30 days
#   monthly pg dumps (label matches *-01): 12 months
#   minio mirrors  : 30 days (large)
#
# Meant to run as a systemd timer nightly at 02:00 Asia/Bangkok on the
# prod server. Systemd unit sample lives in DEPLOYMENT.md.

set -euo pipefail

DEPLOY_ROOT="${DEPLOY_ROOT:-/opt/program-landscape}"
BACKUPS_DIR="$DEPLOY_ROOT/backups"
CURRENT_LINK="$DEPLOY_ROOT/current"

LABEL="${1:-$(date +%Y%m%d-%H%M%S)}"

log() { printf '\033[1;34m[backup]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[backup FAIL]\033[0m %s\n' "$*" >&2; exit 1; }

[ -L "$CURRENT_LINK" ] || fail "$CURRENT_LINK not set — has deploy.sh run?"
# nested-sudo dropped (we run as root via deploy.sh): 
mkdir -p "$BACKUPS_DIR"

# ── Postgres dump ─────────────────────────────────────────────────────
DUMP="$BACKUPS_DIR/$LABEL.sql.gz"
log "pg_dumpall → $DUMP"

cd "$CURRENT_LINK"

# Read the canonical DB name + user from the .env.prod secrets. We run
# pg_dump inside the postgres container (local socket auth) to avoid
# needing a second password flow.
PG_USER="$(cat "$DEPLOY_ROOT/secrets/postgres_user" | tr -d '[:space:]')"
PG_DB="$(grep -E '^POSTGRES_DB=' "$DEPLOY_ROOT/.env.prod" | cut -d= -f2 | tr -d '[:space:]')"
PG_DB="${PG_DB:-program_landscape}"

# nested-sudo dropped (we run as root via deploy.sh): 
docker compose exec -T postgres \
  pg_dump --format=custom --compress=9 --no-owner --no-acl \
    -U "$PG_USER" "$PG_DB" \
  | gzip > "$DUMP.tmp"

mv "$DUMP.tmp" "$DUMP"
log "pg dump size: $(du -h "$DUMP" | cut -f1)"

# ── MinIO mirror ──────────────────────────────────────────────────────
MINIO_TAR="$BACKUPS_DIR/$LABEL-minio.tar.gz"
log "MinIO mirror → $MINIO_TAR"

# MinIO's official image is a stripped Alpine without `tar`, so we
# can't tar from inside it. Use a busybox sidecar that mounts the
# minio container's volumes (notably /data) and tars its `data/`
# tree to stdout, which we redirect to the host file. Same pattern
# used by the initial dev → prod MinIO snapshot during first deploy.
# Note: this captures /data directly (the minio data dir on disk),
# not via the S3 API. Cleaner + faster than mc mirror, no auth needed.
docker run --rm --volumes-from program-landscape-minio busybox \
  tar czf - -C / data > "$MINIO_TAR.tmp" \
  || { rm -f "$MINIO_TAR.tmp"; fail "MinIO mirror failed"; }
mv "$MINIO_TAR.tmp" "$MINIO_TAR"
log "minio mirror size: $(du -h "$MINIO_TAR" | cut -f1)"

# ── Retention ─────────────────────────────────────────────────────────
# Daily: delete anything older than 30 days, unless it's a monthly (the
# operator's convention is YYYYMMDD-* for dailies; dumps labelled
# `monthly-YYYY-MM` are preserved for 365 days).
log "Applying retention policy"

find "$BACKUPS_DIR" -type f -name '*.sql.gz' -mtime +30 \
  ! -name 'monthly-*' \
  ! -name 'pre-deploy-*' \
  -print -delete || true

find "$BACKUPS_DIR" -type f -name '*-minio.tar.gz' -mtime +30 \
  ! -name 'monthly-*' \
  -print -delete || true

find "$BACKUPS_DIR" -type f -name 'monthly-*' -mtime +365 -print -delete || true
find "$BACKUPS_DIR" -type f -name 'pre-deploy-*' -mtime +90 -print -delete || true

log "Done."
