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
#  11. prune old releases  (keep last 5)

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

# ── 1. Preflight ──────────────────────────────────────────────────────
command -v docker >/dev/null 2>&1 || fail "docker not installed"
docker compose version >/dev/null 2>&1 || fail "docker compose v2 not installed (use 'docker compose', not 'docker-compose')"
command -v sudo >/dev/null 2>&1 || fail "sudo required"

sudo mkdir -p "$RELEASES_DIR" "$SECRETS_DIR" "$CERTS_DIR" "$BACKUPS_DIR"

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
if [ -L "$CURRENT_LINK" ] || [ -e "$CURRENT_LINK" ]; then
  log "Taking pre-deploy DB snapshot"
  if [ -x "$RELEASE_DIR/scripts/backup.sh" ]; then
    sudo DEPLOY_ROOT="$DEPLOY_ROOT" "$RELEASE_DIR/scripts/backup.sh" "pre-deploy-$VERSION" || \
      log "WARNING: pre-deploy snapshot failed — continuing"
  fi
fi

# ── 6. Run migrations ─────────────────────────────────────────────────
# Bring up postgres + redis + minio (deps the api needs) first so the
# migration container can reach them.
cd "$STAGED_RELEASE"
export RELEASE_VERSION="$VERSION"

log "Starting infrastructure services (postgres/redis/minio/gotenberg)"
sudo -E docker compose up -d postgres redis minio gotenberg

log "Waiting for postgres to be healthy"
timeout 120 bash -c '
  until sudo docker inspect program-landscape-postgres --format "{{.State.Health.Status}}" 2>/dev/null | grep -q healthy; do
    sleep 2
  done
' || fail "postgres failed to become healthy within 120s"

log "Applying database migrations"
sudo -E docker compose run --rm --entrypoint "" api \
  sh -c "node node_modules/.bin/prisma migrate deploy --schema=packages/db/prisma/schema.prisma" \
  || fail "prisma migrate deploy failed — rollback recommended"

# ── 7. Atomic symlink swap ────────────────────────────────────────────
log "Swapping current → $VERSION"
sudo ln -sfn "$STAGED_RELEASE" "$CURRENT_LINK.new"
sudo mv -Tf "$CURRENT_LINK.new" "$CURRENT_LINK"

# ── 8. Start the full stack ───────────────────────────────────────────
cd "$CURRENT_LINK"
log "Starting all services with release v${VERSION}"
sudo -E docker compose up -d --remove-orphans

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

# ── 11. Prune old releases ────────────────────────────────────────────
log "Pruning old releases (keeping last 5)"
# ls -1t sorts by mtime descending. Keep top 5, delete the rest.
(
  cd "$RELEASES_DIR"
  ls -1t | tail -n +6 | while read -r old; do
    if [ "$old" != "$(basename "$CURRENT_LINK" 2>/dev/null || true)" ]; then
      sudo rm -rf -- "$RELEASES_DIR/$old"
    fi
  done
) || true

# ── Dangling image cleanup ───────────────────────────────────────────
sudo docker image prune -f >/dev/null || true

log "=== Deployment complete: v${VERSION} ==="
log "Tail logs: sudo docker compose logs -f --tail=100"
log "Rollback : $CURRENT_LINK/scripts/rollback.sh"
