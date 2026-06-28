#!/usr/bin/env bash
# deploy.sh — idempotent deploy of a release bundle on the prod server.
#
# Run from inside the extracted bundle directory:
#   cd /tmp/program-landscape-1.2.3
#   ./scripts/deploy.sh
#
# Flow:
#   1. preflight           (docker, compose v2, secrets, certs)
#   2. docker load         (loads images from images.tar)
#   3. stage release       (copy into /opt/program-landscape/releases/<ver>)
#   4. wire secrets + env  (symlink into the release dir)
#   5. pre-deploy backup   (if a previous `current` exists)
#   6. db:migrate:safe     (pg_dump → prisma migrate deploy)
#   7. atomic symlink swap (releases/<ver> → current)
#   8. compose up -d       (start containers)
#   9. wait for health     (all services healthy, up to 3 minutes)
#  10. smoke test          (hit /healthz + /api/v1/ready)
#  11. prune old builds   (release dirs + images, keep last 3)

set -euo pipefail

# ── Paths ─────────────────────────────────────────────────────────────
RELEASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"   # the unpacked bundle
DEPLOY_ROOT="${DEPLOY_ROOT:-/opt/program-landscape}"
RELEASES_DIR="$DEPLOY_ROOT/releases"
CURRENT_LINK="$DEPLOY_ROOT/current"
SECRETS_DIR="$DEPLOY_ROOT/secrets"
CERTS_DIR="$DEPLOY_ROOT/certs"
ENV_FILE="$DEPLOY_ROOT/.env.prod"
BACKUPS_DIR="$DEPLOY_ROOT/backups"

# ── Version ───────────────────────────────────────────────────────────
if [ ! -f "$RELEASE_DIR/VERSION" ]; then
  echo "ERROR: $RELEASE_DIR/VERSION missing — run this from an unpacked release bundle." >&2
  exit 1
fi
VERSION="$(tr -d '[:space:]' < "$RELEASE_DIR/VERSION")"

STAGED_RELEASE="$RELEASES_DIR/$VERSION"

log() { printf '\033[1;34m[deploy]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[deploy FAIL]\033[0m %s\n' "$*" >&2; exit 1; }

log "=== Deploying Program Landscape v${VERSION} ==="
log "Bundle dir : $RELEASE_DIR"
log "Deploy root: $DEPLOY_ROOT"

# ── 0. Release-readiness gate (prompt 20) ─────────────────────────────
#
# Refuse to proceed unless preflight.sh runs green. Override is allowed
# but audited: --skip-preflight requires OVERRIDE_REASON=... and writes
# a row to /var/log/program-landscape/preflight-overrides.log.
SKIP_PREFLIGHT=0
for arg in "${@:-}"; do
  case "${arg:-}" in --skip-preflight) SKIP_PREFLIGHT=1 ;; esac
done

PREFLIGHT_LOG="/var/log/program-landscape"
sudo mkdir -p "$PREFLIGHT_LOG" 2>/dev/null || true

if [ "$SKIP_PREFLIGHT" = "1" ]; then
  if [ -z "${OVERRIDE_REASON:-}" ]; then
    fail "--skip-preflight requires OVERRIDE_REASON=... env var (audited)"
  fi
  log "WARNING: --skip-preflight set; reason: $OVERRIDE_REASON"
  sudo tee -a "$PREFLIGHT_LOG/preflight-overrides.log" >/dev/null <<EOF
$(date -u +%Y-%m-%dT%H:%M:%SZ)	v${VERSION}	$(hostname)	$(whoami)	$OVERRIDE_REASON
EOF
else
  if [ -x "$RELEASE_DIR/scripts/preflight.sh" ]; then
    log "Running preflight gate"
    "$RELEASE_DIR/scripts/preflight.sh" \
      || fail "preflight.sh failed — re-run for details. To override (audited): OVERRIDE_REASON='...' ./scripts/deploy.sh --skip-preflight"
  else
    log "WARNING: scripts/preflight.sh missing from bundle — skipping release-readiness gate"
  fi
fi

# ── 1. Preflight (host-side: docker, secrets, certs) ─────────────────
command -v docker >/dev/null 2>&1 || fail "docker not installed"
docker compose version >/dev/null 2>&1 || fail "docker compose v2 not installed (use 'docker compose', not 'docker-compose')"
command -v sudo >/dev/null 2>&1 || fail "sudo required"

sudo mkdir -p "$RELEASES_DIR" "$SECRETS_DIR" "$CERTS_DIR" "$BACKUPS_DIR"

# Host bind-mount target for the ingestion service's pipeline child-process
# logs. The container's runtime UID is 1010 (apps/ingestion/Dockerfile.prod's
# `app` user); the host dir must be writable by that UID. Idempotent — chown
# is a no-op when ownership already matches.
LOGS_DIR="$DEPLOY_ROOT/logs"
sudo mkdir -p "$LOGS_DIR"
sudo chown 1010:1010 "$LOGS_DIR"
sudo chmod 755 "$LOGS_DIR"

[ -f "$ENV_FILE" ] || fail "$ENV_FILE missing — copy .env.prod.example there first, fill in values, chmod 600"
[ -f "$CERTS_DIR/fullchain.pem" ] || fail "self-signed cert missing — run scripts/generate-self-signed-cert.sh"
[ -f "$CERTS_DIR/privkey.pem" ] || fail "self-signed key missing"

for name in postgres_user postgres_password minio_user minio_password; do
  [ -s "$SECRETS_DIR/$name" ] || fail "missing or empty secret: $SECRETS_DIR/$name"
done

# ── 2. Load images ────────────────────────────────────────────────────
if [ -f "$RELEASE_DIR/images.tar" ]; then
  log "docker load < images.tar"
  docker load -i "$RELEASE_DIR/images.tar"
else
  log "WARNING: images.tar not found in bundle — assuming images are already on-host"
fi

# ── 3. Stage release ──────────────────────────────────────────────────
if [ -e "$STAGED_RELEASE" ]; then
  log "Release $VERSION already staged at $STAGED_RELEASE — idempotent, refreshing"
  sudo rm -rf "$STAGED_RELEASE"
fi
log "Staging release into $STAGED_RELEASE"
sudo cp -a "$RELEASE_DIR/." "$STAGED_RELEASE/"
sudo chown -R root:root "$STAGED_RELEASE"

# ── 4. Symlink secrets, env, certs into the staged release ───────────
sudo rm -rf "$STAGED_RELEASE/secrets"
sudo ln -sfn "$SECRETS_DIR"            "$STAGED_RELEASE/secrets"
sudo ln -sfn "$ENV_FILE"               "$STAGED_RELEASE/.env.prod"
sudo rm -rf "$STAGED_RELEASE/infra/nginx/certs"
sudo ln -sfn "$CERTS_DIR"              "$STAGED_RELEASE/infra/nginx/certs"

# ── 5. Pre-deploy DB snapshot ─────────────────────────────────────────
# The snapshot is the only restore-point if a forward-only migration
# turns out to be destructive. Refusing-to-deploy-on-failed-snapshot
# is the policy from docs/migration-policy.md and prompt 12 (db
# safety). Operator override: `SKIP_PRE_DEPLOY_SNAPSHOT=1 ./deploy.sh`
# (use ONLY for the very first deploy when there's no DB yet).
if [ -L "$CURRENT_LINK" ] || [ -e "$CURRENT_LINK" ]; then
  if [ "${SKIP_PRE_DEPLOY_SNAPSHOT:-0}" = "1" ]; then
    log "WARNING: SKIP_PRE_DEPLOY_SNAPSHOT=1 — skipping snapshot. NO RESTORE POINT IF MIGRATION FAILS."
  else
    log "Taking pre-deploy DB snapshot (refuses to deploy on failure)"
    if [ ! -x "$RELEASE_DIR/scripts/backup.sh" ]; then
      fail "snapshot script $RELEASE_DIR/scripts/backup.sh not executable — cannot deploy without a restore point"
    fi
    sudo DEPLOY_ROOT="$DEPLOY_ROOT" "$RELEASE_DIR/scripts/backup.sh" "pre-deploy-$VERSION" || \
      fail "pre-deploy snapshot FAILED — refusing to deploy. Re-run after the DB is reachable, or set SKIP_PRE_DEPLOY_SNAPSHOT=1 (NOT RECOMMENDED)."
  fi
fi

# ── 6. Run migrations ─────────────────────────────────────────────────
# Bring up postgres + redis + minio (deps the api needs) first so the
# migration container can reach them.
cd "$STAGED_RELEASE"
export RELEASE_VERSION="$VERSION"

# MinIO migration: the Chainguard image runs as non-root UID 65532, but a
# volume created by the old root-running minio/minio image holds root-owned
# data, which makes the new server fail to init the backend. Chown the
# minio-data volume to 65532 once, BEFORE starting minio. Uses the bundled
# minio image itself (as root) so no extra image is needed on the air-gapped
# host. Idempotent + cheap: a no-op on a fresh/already-65532 volume.
log "Ensuring MinIO data volume is owned by nonroot (UID 65532)"
docker compose run --rm --no-deps --user 0 --entrypoint /usr/bin/chown \
  minio -R 65532:65532 /data \
  || fail "MinIO volume chown failed — check the minio-data volume permissions"

log "Starting infrastructure services (postgres/redis/minio/gotenberg)"
docker compose up -d postgres redis minio gotenberg

log "Waiting for postgres to be healthy"
timeout 120 bash -c '
  until sudo docker inspect program-landscape-postgres --format "{{.State.Health.Status}}" 2>/dev/null | grep -q healthy; do
    sleep 2
  done
' || fail "postgres failed to become healthy within 120s"

if [ "${SKIP_MIGRATE:-0}" = "1" ]; then
  log "SKIP_MIGRATE=1 — skipping prisma migrate deploy (schema arrives via pg_restore in Phase 9 / first-deploy migration)"
else
  log "Applying database migrations"
  docker compose run --rm --entrypoint "" api \
    sh -c "node node_modules/.bin/prisma migrate deploy --schema=packages/db/prisma/schema.prisma" \
    || fail "prisma migrate deploy failed — rollback recommended"
fi

# ── 6.5. Drain the old release ───────────────────────────────────────
# Before swapping the `current` symlink, ask the running containers to
# drain. SIGTERM → flips the api/ingestion drain flag → `/api/v1/ready`
# returns 503 → KKU upstream proxy stops forwarding NEW traffic within
# its 30s polling window. In-flight requests get up to STOP_TIMEOUT
# seconds to finish via Nest's `app.close()` deadline.
#
# Skipped on first deploy (no `current` symlink yet → no live stack).
STOP_TIMEOUT="${DEPLOY_STOP_TIMEOUT:-30}"
if [ -L "$CURRENT_LINK" ] || [ -e "$CURRENT_LINK" ]; then
  log "Draining current release (SIGTERM, ${STOP_TIMEOUT}s deadline)"
  cd "$CURRENT_LINK"
  docker compose stop --timeout "$STOP_TIMEOUT" || \
    log "WARNING: drain stop returned non-zero — proceeding with swap"
fi

# ── 7. Atomic symlink swap ────────────────────────────────────────────
log "Swapping current → $VERSION"
sudo ln -sfn "$STAGED_RELEASE" "$CURRENT_LINK.new"
sudo mv -Tf "$CURRENT_LINK.new" "$CURRENT_LINK"

# Operator-convenience: write `.env` next to the staged compose so every
# subsequent `docker compose ...` from /opt/program-landscape/current/
# inherits RELEASE_VERSION and stops emitting the
# "WARN[0000] The "RELEASE_VERSION" variable is not set." spam.
echo "RELEASE_VERSION=${VERSION}" | sudo tee "$STAGED_RELEASE/.env" >/dev/null

# ── 8. Start the full stack ───────────────────────────────────────────
cd "$CURRENT_LINK"
log "Starting all services with release v${VERSION}"
docker compose up -d --remove-orphans

# ── 9. Wait for health ────────────────────────────────────────────────
log "Waiting up to 180s for services to become healthy"
HEALTHY=0
for _ in $(seq 1 90); do
  # Count healthy containers out of 8 (nginx, web, api, ingestion,
  # postgres, redis, minio, gotenberg).
  CURRENT_HEALTHY="$(
    sudo docker compose ps --format '{{.Name}} {{.Status}}' \
      | grep -c 'healthy' || true
  )"
  if [ "$CURRENT_HEALTHY" -ge 6 ]; then
    HEALTHY=1
    break
  fi
  sleep 2
done
[ "$HEALTHY" -eq 1 ] || fail "services failed to reach healthy state — check \`docker compose ps\` + \`docker compose logs\`"

# ── 10. Smoke test ────────────────────────────────────────────────────
log "Running smoke test"
if [ -x "$CURRENT_LINK/scripts/smoke-test.sh" ]; then
  sudo "$CURRENT_LINK/scripts/smoke-test.sh" || fail "smoke test failed — consider ./scripts/rollback.sh"
fi

# ── 11. Prune old builds — release dirs + images (keep last N) ───────
# Override the retention count with KEEP_BUILDS=<n>. Dev applies the
# same N in scripts/build-release.ts.
KEEP_BUILDS="${KEEP_BUILDS:-3}"

log "Pruning old release dirs (keeping last $KEEP_BUILDS)"
# ls -1t sorts by mtime descending. Keep the newest $KEEP_BUILDS; never
# delete the version we just deployed (it is the new `current`).
(
  cd "$RELEASES_DIR"
  ls -1t | tail -n +"$((KEEP_BUILDS + 1))" | while read -r old; do
    [ "$old" = "$VERSION" ] && continue
    sudo rm -rf -- "$RELEASES_DIR/$old"
    log "  removed release dir $old"
  done
) || true

# Old build images: keep the newest $KEEP_BUILDS versions. `docker load`
# preserves each image's original build time, so CreatedAt order = build
# order; the just-deployed $VERSION is newest and always kept. `rmi` of
# an image still backing a container fails harmlessly (|| true).
IMG_REF="ghcr.io/khon-kaen-university/program-landscape-*"
log "Pruning old build images (keeping last $KEEP_BUILDS versions)"
sudo docker images --filter=reference="$IMG_REF" --format '{{.CreatedAt}}|{{.Tag}}' \
  | sort -r | awk -F'|' '!seen[$2]++ {print $2}' | tail -n +"$((KEEP_BUILDS + 1))" \
  | while read -r ver; do
      { [ -n "$ver" ] && [ "$ver" != "$VERSION" ]; } || continue
      sudo docker images --filter=reference="ghcr.io/khon-kaen-university/program-landscape-*:$ver" \
        --format '{{.Repository}}:{{.Tag}}' \
        | while read -r img; do sudo docker rmi "$img" >/dev/null 2>&1 || true; done
      log "  removed images for v$ver"
    done || true

# Dangling (untagged) layers left behind by the image prune + docker load.
sudo docker image prune -f >/dev/null || true

log "=== Deployment complete: v${VERSION} ==="
log "Tail logs: sudo docker compose logs -f --tail=100"
log "Rollback : $CURRENT_LINK/scripts/rollback.sh"
