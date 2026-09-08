#!/usr/bin/env bash
# dev-backup.sh — nightly snapshot of the DEV Postgres database.
#
# Usage:
#   ./scripts/dev-guard/dev-backup.sh              # take a snapshot now
#   ./scripts/dev-guard/dev-backup.sh --if-stale   # only if the newest is >20 h old
#   ./scripts/dev-guard/dev-backup.sh --install    # install the nightly systemd --user timer
#   ./scripts/dev-guard/dev-backup.sh --status     # list what is on disk
#
# WHY THIS EXISTS
#   Prod has backup.sh + a systemd timer + verify-backup.sh. Dev had NOTHING —
#   so when an agent destroyed the dev database on 2026-09-06 the only way back
#   was a prod dump, and the dev-only delta was simply lost. The dev database
#   holds real production-derived data and is shared with another operator; it
#   deserves the same floor.
#
#   Prevention (scripts/dev-guard/db-destructive-guard.py) is layer 1. This is
#   layer 2: when prevention fails, lose hours instead of weeks.
#
# WHERE
#   Snapshots land OUTSIDE the repo (~/program-landscape-dev-backups) so that
#   no git operation, no `pnpm clean`, and no container teardown can take them
#   with it. ~1.7 GB database → ~150-250 MB per compressed custom-format dump;
#   7 dailies fit comfortably.
#
# RESTORE
#   docker exec -i program-landscape-postgres \
#     pg_restore --no-owner --no-acl -U kku -d program_landscape_restore \
#     < ~/program-landscape-dev-backups/<file>
#   (restore into a FRESH database, then swap — never restore over a live one.)

set -euo pipefail

BACKUP_DIR="${DEV_BACKUP_DIR:-$HOME/program-landscape-dev-backups}"
RETENTION_DAYS="${DEV_BACKUP_RETENTION_DAYS:-7}"
STALE_HOURS="${DEV_BACKUP_STALE_HOURS:-20}"
CONTAINER="${DEV_PG_CONTAINER:-program-landscape-postgres}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

log() { printf '\033[1;34m[dev-backup]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[dev-backup FAIL]\033[0m %s\n' "$*" >&2; exit 1; }

# Credentials come from the repo .env — the same file the app uses, so there is
# no second place to keep in sync.
read_env() { grep -m1 "^$1=" "$REPO_ROOT/.env" 2>/dev/null | cut -d= -f2- | tr -d '[:space:]'; }

newest_backup() { ls -1t "$BACKUP_DIR"/dev-*.dump 2>/dev/null | head -n1; }

# ── --status ──────────────────────────────────────────────────────────
if [ "${1:-}" = "--status" ]; then
  if [ -d "$BACKUP_DIR" ]; then
    ls -lht "$BACKUP_DIR"/dev-*.dump 2>/dev/null || log "no snapshots yet"
    du -sh "$BACKUP_DIR" 2>/dev/null || true
  else
    log "no backup directory yet ($BACKUP_DIR)"
  fi
  systemctl --user status program-landscape-dev-backup.timer --no-pager 2>/dev/null | head -5 || true
  exit 0
fi

# ── --install ─────────────────────────────────────────────────────────
# systemd --user, not cron: this machine runs systemd (WSL2 with systemd
# enabled) and a user timer survives reboots without touching root.
if [ "${1:-}" = "--install" ]; then
  UNIT_DIR="$HOME/.config/systemd/user"
  mkdir -p "$UNIT_DIR"

  cat > "$UNIT_DIR/program-landscape-dev-backup.service" <<UNIT
[Unit]
Description=Program Landscape — nightly dev database snapshot
Documentation=file://$REPO_ROOT/scripts/dev-guard/dev-backup.sh

[Service]
Type=oneshot
ExecStart=$REPO_ROOT/scripts/dev-guard/dev-backup.sh
UNIT

  cat > "$UNIT_DIR/program-landscape-dev-backup.timer" <<UNIT
[Unit]
Description=Program Landscape — nightly dev database snapshot

[Timer]
OnCalendar=*-*-* 02:30:00
# The dev box is a laptop/workstation, not a server: Persistent catches up on a
# run missed while it was asleep or shut down.
Persistent=true
RandomizedDelaySec=10m

[Install]
WantedBy=timers.target
UNIT

  systemctl --user daemon-reload
  systemctl --user enable --now program-landscape-dev-backup.timer
  log "Installed. Next run:"
  systemctl --user list-timers program-landscape-dev-backup.timer --no-pager | head -3
  exit 0
fi

# ── --if-stale ────────────────────────────────────────────────────────
# Used by the SessionStart hook: an agent session is about to start, so take a
# snapshot unless there is already a recent one. Silent no-op otherwise.
if [ "${1:-}" = "--if-stale" ]; then
  # Nothing to snapshot if the stack is down. That is not a backup failure, so
  # exit quietly rather than making every session-start without the DB noisy.
  docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep -q true || exit 0

  latest="$(newest_backup || true)"
  if [ -n "$latest" ]; then
    age_h=$(( ( $(date +%s) - $(stat -c %Y "$latest") ) / 3600 ))
    if [ "$age_h" -lt "$STALE_HOURS" ]; then
      exit 0
    fi
  fi
fi

# ── Take the snapshot ─────────────────────────────────────────────────
docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep -q true \
  || fail "container $CONTAINER is not running — start it with 'pnpm db:up'"

PG_USER="$(read_env POSTGRES_USER)"
PG_DB="$(read_env POSTGRES_DB)"
[ -n "$PG_USER" ] || fail "POSTGRES_USER not found in $REPO_ROOT/.env"
PG_DB="${PG_DB:-program_landscape}"

mkdir -p "$BACKUP_DIR"
OUT="$BACKUP_DIR/dev-$(date +%Y%m%d-%H%M%S).dump"

log "pg_dump $PG_DB → $OUT"
# Custom format so pg_restore can be selective; --no-owner/--no-acl so the dump
# restores into any local role. Written to .tmp and moved, so an interrupted run
# never leaves a half-file that looks like a valid snapshot.
docker exec "$CONTAINER" \
  pg_dump --format=custom --compress=9 --no-owner --no-acl -U "$PG_USER" "$PG_DB" \
  > "$OUT.tmp" || { rm -f "$OUT.tmp"; fail "pg_dump failed"; }

# A dump that restores nothing is worse than no dump: it hides the failure.
# pg_restore --list reads the archive's table of contents without touching a
# database, so this is a cheap structural check.
TOC_LINES=$(pg_restore --list "$OUT.tmp" 2>/dev/null | grep -c 'TABLE DATA' || true)
[ "${TOC_LINES:-0}" -ge 50 ] \
  || { rm -f "$OUT.tmp"; fail "dump has only ${TOC_LINES:-0} TABLE DATA entries (expected >= 50) — refusing to keep it"; }

mv "$OUT.tmp" "$OUT"
log "ok — $(du -h "$OUT" | cut -f1), $TOC_LINES tables"

# ── Retention ─────────────────────────────────────────────────────────
# Delete by age, but never below one snapshot: if the machine sits idle past the
# retention window, age-only pruning would leave nothing at all.
KEPT=$(ls -1 "$BACKUP_DIR"/dev-*.dump 2>/dev/null | wc -l)
if [ "$KEPT" -gt 1 ]; then
  find "$BACKUP_DIR" -maxdepth 1 -type f -name 'dev-*.dump' -mtime "+$RETENTION_DAYS" \
    -print -delete || true
fi
log "snapshots on disk: $(ls -1 "$BACKUP_DIR"/dev-*.dump 2>/dev/null | wc -l) ($(du -sh "$BACKUP_DIR" | cut -f1))"
