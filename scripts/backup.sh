#!/usr/bin/env bash
# backup.sh — dump Postgres + mirror MinIO, rotate old backups.
#
# Usage:
#   sudo ./scripts/backup.sh                        # auto-labelled, full
#   sudo ./scripts/backup.sh pre-deploy-1.2         # custom label
#   sudo ./scripts/backup.sh --no-minio             # pg dump only
#   sudo ./scripts/backup.sh --no-minio nightly-x   # both
#
# Emits:
#   /opt/program-landscape/backups/<label>.sql.gz
#   /opt/program-landscape/backups/<label>-minio.tar.gz   (unless --no-minio)
#
# CADENCE (see infra/systemd/): the pg dump runs nightly, the MinIO mirror
# only weekly. The mirror is a FULL tar of an append-only blob store —
# measured at 2.5 GB on 2026-09-06 and growing — so nightly copies reach
# ~75 GB under the 30-day rule versus ~8.6 GB for the dumps. Weekly keeps
# roughly four mirrors alive inside that same 30-day window, which is why
# the retention policy below did not need to change.
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

# Flags may appear before or after the positional label. deploy.sh calls
# this as `backup.sh pre-deploy-<version>`, so the positional form must keep
# working exactly as before.
LABEL=""
BACKUP_MINIO="${BACKUP_MINIO:-1}"

while [ $# -gt 0 ]; do
  case "$1" in
    --no-minio) BACKUP_MINIO=0; shift ;;
    -*) echo "unknown flag: $1" >&2; exit 1 ;;
    *) LABEL="$1"; shift ;;
  esac
done

LABEL="${LABEL:-$(date +%Y%m%d-%H%M%S)}"

log() { printf '\033[1;34m[backup]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[backup FAIL]\033[0m %s\n' "$*" >&2; exit 1; }

[ -L "$CURRENT_LINK" ] || fail "$CURRENT_LINK not set — has deploy.sh run?"
# nested-sudo dropped (we run as root via deploy.sh): 
mkdir -p "$BACKUPS_DIR"

# ── Postgres dump ─────────────────────────────────────────────────────
DUMP="$BACKUPS_DIR/$LABEL.sql.gz"
log "pg_dumpall → $DUMP"

cd "$CURRENT_LINK"

# docker-compose.yml pins every image to ${RELEASE_VERSION}. With it unset,
# compose resolves them all to a blank tag and prints
#   WARN[0000] The "RELEASE_VERSION" variable is not set.
# once per invocation. Harmless for `exec` into an already-running container
# — all this script does — but wrong the moment compose has to create one,
# and during a deploy the noise buries warnings that do matter.
#
# Resolved from the release we are operating IN, not the one being deployed:
# at pre-deploy-snapshot time `current` is still the OLD release, and its
# containers are the ones we exec into. deploy.sh exports the new version
# later for its own compose calls, and an already-set value always wins here
# (`sudo` does not forward it, which is why this cannot rely on the caller).
#
# The same block is in restore.sh — keep the two in step. smoke-test.sh
# needs none: its only compose call sends stderr to /dev/null already.
if [ -z "${RELEASE_VERSION:-}" ] && [ -r "$CURRENT_LINK/VERSION" ]; then
  RELEASE_VERSION="$(tr -d '[:space:]' < "$CURRENT_LINK/VERSION")"
  export RELEASE_VERSION
fi

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
if [ "$BACKUP_MINIO" != "1" ]; then
  log "MinIO mirror SKIPPED (--no-minio) — the weekly backup-full timer takes it"
else
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
fi

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
