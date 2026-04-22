# Prompt 13b — Deployment: Single-Node Ubuntu Server, Pack-and-Ship

> **When to use:** After hardening (prompt 13). Operationalizes deployment to a single Ubuntu server using Docker Compose, with a "build once, ship in one package" workflow.
>
> **Skills to invoke:** none specific

---

Read `CLAUDE.md`, `GLOBAL-UPDATES.md`, `docs/architecture.md`, and the existing `docker-compose.yml`.

Build the production deployment for KKU Curriculum Landscape.

**Environment facts:**
- **Dev machine:** Windows with Docker Desktop (via WSL2 Ubuntu)
- **Prod machine:** on-prem Ubuntu server running on the **KKU internal network**
- **Deployment model:** single-node, Docker Compose (not Kubernetes — overkill for this scale, and harder to operate in a university IT context)
- **Delivery:** "pack and ship" — build a single bundle on dev machine, transfer to prod server, deploy with one command
- **Network:** KKU internal network. Production server may have restricted outbound access — deployment must work **without requiring the prod server to pull from Docker Hub at deploy time**
- **Public domain:** `program-landscape.kku.ac.th`
- **SSL/TLS model:** end-to-end TLS. **KKU's university reverse proxy terminates the public HTTPS** (using a publicly-trusted cert for `program-landscape.kku.ac.th`), then **re-encrypts** and forwards to our server over HTTPS using a **self-signed cert** that our stack provides. KKU proxy is configured with `proxy_ssl_verify off` to accept our self-signed cert.
- **Our role in networking:** listen on a single HTTPS port (`:8443` by convention) with a self-signed cert. Handle routing `/api/*` → api service vs `/*` → web service internally. We trust `X-Forwarded-*` headers from the KKU proxy.
- **GitHub organization:** `khon-kaen-university` — repo will be hosted at `https://github.com/khon-kaen-university/program-landscape`. Container images tagged as `ghcr.io/khon-kaen-university/program-landscape-<service>:<version>` for convention, though images travel in the deployment bundle rather than being pulled from GHCR at deploy time.

## 1. Multi-stage, multi-arch Dockerfiles

Every app service (`web`, `api`, `ingestion`) gets a production Dockerfile.

**Constraints:**
- Build on Windows/WSL2 (AMD64 host), ship to Ubuntu AMD64 server — no ARM cross-compile needed initially, but leave the door open for it
- Multi-stage builds to keep images small
- Run as non-root user
- Proper signal handling (`tini` or `dumb-init`)
- `.dockerignore` configured aggressively (exclude `node_modules`, `.env`, `.git`, tests, docs)

Example pattern for `apps/web/Dockerfile.prod`:

```dockerfile
# Stage 1: build
FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable
# Copy workspace root files first (better layer caching)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/
COPY packages/ ./packages/
RUN pnpm install --frozen-lockfile
COPY apps/web ./apps/web
RUN pnpm --filter web build

# Stage 2: runtime
FROM node:20-alpine AS runner
RUN apk add --no-cache tini
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder --chown=app:app /app/apps/web/.next/standalone ./
COPY --from=builder --chown=app:app /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=app:app /app/apps/web/public ./apps/web/public
USER app
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/web/server.js"]
```

Similar patterns for `api/Dockerfile.prod` (NestJS) and `ingestion/Dockerfile.prod`. Document in `docs/deployment.md`.

For Gotenberg (from prompt 02c): the custom image is already production-ready. Pin to a specific digest in production, not a floating tag.

## 2. Production docker-compose

Create `docker-compose.prod.yml` at the repo root. Key differences from dev compose:

- **No bind mounts of source code** — images contain everything
- **Named volumes** for persistent data (postgres, redis, minio)
- **Restart policies** (`unless-stopped`) on every service
- **Resource limits** (`mem_limit`, `cpus`) on every service
- **Healthchecks** on every service (web, api, ingestion, gotenberg, postgres, redis, minio)
- **Logging driver** configured (json-file with rotation; 10 MB × 5 files max)
- **Environment from `.env.prod`** (secrets loaded via Docker secrets in a later iteration if KKU requires)
- **Internal network** with postgres/redis/minio/gotenberg only reachable inside
- **No exposed ports** except web (via nginx reverse proxy) — database and services are internal
- **Internal nginx** for path-based routing (`/api/*` → api, `/*` → web) on HTTPS port `:8443` with a **self-signed cert**. KKU's university reverse proxy terminates the public cert and re-encrypts to us using this self-signed cert.

Structure:

```yaml
# docker-compose.prod.yml
services:
  nginx:
    image: nginx:1.27-alpine
    restart: unless-stopped
    ports:
      # HTTPS on 8443 — bound to localhost if KKU proxy is on same host,
      # or "8443:8443" if KKU proxy reaches us over the network.
      - "127.0.0.1:8443:8443"
    volumes:
      - ./infra/nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./infra/nginx/conf.d:/etc/nginx/conf.d:ro
      - ./infra/nginx/certs:/etc/nginx/certs:ro  # self-signed cert lives here
      - nginx-logs:/var/log/nginx
    depends_on:
      - web
      - api
    networks:
      - kku-internal

  web:
    image: ghcr.io/khon-kaen-university/program-landscape-web:${RELEASE_VERSION}
    restart: unless-stopped
    env_file: .env.prod
    depends_on:
      api:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
    deploy:
      resources:
        limits:
          memory: 1G
          cpus: "1.0"
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "5"
    networks:
      - kku-internal

  api:
    image: ghcr.io/khon-kaen-university/program-landscape-api:${RELEASE_VERSION}
    restart: unless-stopped
    env_file: .env.prod
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:3001/health"]
      interval: 30s
      timeout: 10s
      retries: 3
    deploy:
      resources:
        limits:
          memory: 2G
          cpus: "2.0"
    logging:
      driver: json-file
      options: { max-size: "10m", max-file: "5" }
    networks: [kku-internal]

  ingestion:
    image: ghcr.io/khon-kaen-university/program-landscape-ingestion:${RELEASE_VERSION}
    restart: unless-stopped
    env_file: .env.prod
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }
      gotenberg: { condition: service_healthy }
    deploy:
      resources:
        limits:
          memory: 3G
          cpus: "2.0"
    logging:
      driver: json-file
      options: { max-size: "10m", max-file: "5" }
    networks: [kku-internal]

  postgres:
    image: postgis/postgis:16-3.4
    restart: unless-stopped
    environment:
      POSTGRES_USER_FILE: /run/secrets/postgres_user
      POSTGRES_PASSWORD_FILE: /run/secrets/postgres_password
      POSTGRES_DB: kku_curriculum
    volumes:
      - postgres-data:/var/lib/postgresql/data
      - ./infra/postgres/init:/docker-entrypoint-initdb.d:ro
    secrets:
      - postgres_user
      - postgres_password
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $$(cat /run/secrets/postgres_user)"]
      interval: 10s
      timeout: 5s
      retries: 5
    deploy:
      resources:
        limits:
          memory: 4G
          cpus: "2.0"
    logging:
      driver: json-file
      options: { max-size: "50m", max-file: "5" }
    networks: [kku-internal]

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: redis-server --appendonly yes --maxmemory 1gb --maxmemory-policy allkeys-lru
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
    deploy:
      resources:
        limits:
          memory: 1.5G
    networks: [kku-internal]

  minio:
    image: minio/minio:latest
    restart: unless-stopped
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER_FILE: /run/secrets/minio_user
      MINIO_ROOT_PASSWORD_FILE: /run/secrets/minio_password
    volumes:
      - minio-data:/data
    secrets:
      - minio_user
      - minio_password
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 30s
    networks: [kku-internal]

  gotenberg:
    image: ghcr.io/khon-kaen-university/program-landscape-gotenberg:${RELEASE_VERSION}  # custom image with TH Sarabun New
    restart: unless-stopped
    environment:
      API_TIMEOUT: "60s"
      LOG_LEVEL: "info"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
    deploy:
      resources:
        limits:
          memory: 2G
          cpus: "1.5"
    networks: [kku-internal]

networks:
  kku-internal:
    driver: bridge
    # internal: false — connectors still need outbound access to fetch external data

volumes:
  postgres-data:
  redis-data:
  minio-data:
  nginx-logs:

secrets:
  postgres_user:
    file: ./secrets/postgres_user
  postgres_password:
    file: ./secrets/postgres_password
  minio_user:
    file: ./secrets/minio_user
  minio_password:
    file: ./secrets/minio_password
```

## 3. Internal routing nginx with self-signed TLS

**Important:** KKU's university reverse proxy terminates the public cert (for `program-landscape.kku.ac.th`) and re-encrypts to our server over HTTPS using a **self-signed cert**. The KKU proxy is configured with `proxy_ssl_verify off`. Our internal nginx serves HTTPS on `:8443`, presents the self-signed cert, and handles path-based routing between `web` and `api`.

**How requests flow:**
```
User browser
  → https://program-landscape.kku.ac.th          (KKU proxy — public TLS here)
  → https://<our-ubuntu-server>:8443             (re-encrypted, self-signed cert)
  → our internal nginx container (TLS terminated again)
  → web:3000  OR  api:3001 depending on path     (HTTP inside docker network)
```

### Generating the self-signed cert

Create a script `scripts/generate-self-signed-cert.sh` that runs on the prod server during one-time setup:

```bash
#!/usr/bin/env bash
set -euo pipefail

CERT_DIR="/opt/program-landscape/certs"
sudo mkdir -p "$CERT_DIR"

# 10-year self-signed cert (renewals are manual but rare)
sudo openssl req -x509 -newkey rsa:4096 -sha256 -days 3650 -nodes \
  -keyout "$CERT_DIR/privkey.pem" \
  -out "$CERT_DIR/fullchain.pem" \
  -subj "/C=TH/ST=Khon Kaen/L=Khon Kaen/O=Khon Kaen University/OU=Office of Vice President for Education and Digital/CN=program-landscape.kku.ac.th" \
  -addext "subjectAltName=DNS:program-landscape.kku.ac.th,DNS:localhost,IP:127.0.0.1"

sudo chmod 600 "$CERT_DIR/privkey.pem"
sudo chmod 644 "$CERT_DIR/fullchain.pem"

echo "Self-signed cert generated at $CERT_DIR"
echo "Fingerprint:"
sudo openssl x509 -in "$CERT_DIR/fullchain.pem" -noout -fingerprint -sha256
```

The fingerprint is useful to share with KKU network team so their proxy can optionally pin it (stronger than `proxy_ssl_verify off`).

The certs are mounted into the nginx container via `/opt/program-landscape/certs` → `/etc/nginx/certs`. The deploy script symlinks this into each release's directory.

### nginx config

`infra/nginx/nginx.conf`:

```nginx
worker_processes auto;
events { worker_connections 1024; }

http {
  include       /etc/nginx/mime.types;
  default_type  application/octet-stream;
  sendfile      on;
  keepalive_timeout  65;

  # Log format that respects the forwarded IP from KKU proxy
  log_format main '$http_x_forwarded_for - $remote_user [$time_local] '
                  '"$request" $status $body_bytes_sent '
                  '"$http_referer" "$http_user_agent"';

  access_log /var/log/nginx/access.log main;
  error_log  /var/log/nginx/error.log warn;

  # Trust X-Forwarded-* headers ONLY from KKU reverse proxy IP(s).
  # Replace the CIDRs below with the actual KKU proxy IPs (ask KKU network team).
  set_real_ip_from 10.0.0.0/8;        # KKU internal (placeholder — confirm)
  set_real_ip_from 172.16.0.0/12;     # KKU internal (placeholder — confirm)
  set_real_ip_from 192.168.0.0/16;    # KKU internal (placeholder — confirm)
  real_ip_header X-Forwarded-For;
  real_ip_recursive on;

  include /etc/nginx/conf.d/*.conf;
}
```

`infra/nginx/conf.d/program-landscape.conf`:

```nginx
upstream web_upstream { server web:3000; }
upstream api_upstream { server api:3001; }

server {
  listen 8443 ssl http2 default_server;
  server_name program-landscape.kku.ac.th _;

  # Self-signed cert for KKU-internal TLS (KKU proxy sets proxy_ssl_verify off)
  ssl_certificate     /etc/nginx/certs/fullchain.pem;
  ssl_certificate_key /etc/nginx/certs/privkey.pem;
  ssl_protocols TLSv1.2 TLSv1.3;
  ssl_ciphers HIGH:!aNULL:!MD5;
  ssl_session_cache shared:SSL:10m;
  ssl_session_timeout 10m;

  client_max_body_size 100M;  # allow large PDF uploads

  # Health check for KKU proxy monitoring (no TLS verification needed from KKU side)
  location = /healthz {
    access_log off;
    return 200 "ok\n";
    add_header Content-Type text/plain;
  }

  # API routes
  location /api/ {
    proxy_pass http://api_upstream;  # HTTP inside the docker network
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";

    # Preserve original host + scheme from KKU proxy
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;  # from KKU proxy (https)
    proxy_set_header X-Forwarded-Host $http_x_forwarded_host;

    proxy_read_timeout 300s;  # long AI/PDF operations
  }

  # Everything else → web
  location / {
    proxy_pass http://web_upstream;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
    proxy_set_header X-Forwarded-Host $http_x_forwarded_host;
  }
}

# Optional HTTP → HTTPS redirect on :8080 in case something probes that port
server {
  listen 8080 default_server;
  server_name _;
  return 301 https://$host$request_uri;
}
```

### App-level trust proxy configuration

Both web (Next.js) and api (NestJS) must trust the forwarded headers coming from our internal nginx.

- **Next.js:** Set `NEXTAUTH_URL=https://program-landscape.kku.ac.th` in `.env.prod` — NextAuth uses this to generate correct callback URLs despite terminating TLS at the KKU proxy upstream. Also set `AUTH_TRUST_HOST=true` (next-auth v5).
- **NestJS:** Enable Express's trust proxy in `main.ts`:
  ```ts
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.set('trust proxy', 1);  // trust first hop (our internal nginx)
  ```

**Security headers:** set at the app layer (Next.js `middleware.ts` + NestJS `helmet`), not at nginx. Since requests traverse KKU proxy → our nginx → our app, putting headers at the app ensures they always reach the user. Include:

- `Strict-Transport-Security: max-age=63072000; includeSubDomains`
- `X-Frame-Options: SAMEORIGIN`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Content-Security-Policy: ...` (calibrate per module — strict default, relaxed where needed)

### Coordinate with KKU network team before deploying

1. Confirm KKU reverse proxy's outbound source IP(s) — update `set_real_ip_from` directives in `nginx.conf`
2. Confirm KKU proxy is configured with **`proxy_ssl_verify off`** (required for self-signed acceptance), OR pin our cert's SHA-256 fingerprint in their config (stronger)
3. Confirm KKU proxy talks to us over HTTPS on `:8443` — request this upstream destination config
4. Confirm exact `X-Forwarded-*` header names KKU proxy sends (some organizations customize)
5. Agree on health check path — KKU proxy should poll `GET /healthz` on `:8443` (over HTTPS, ignoring cert verification) to decide when we're up
6. DNS: `program-landscape.kku.ac.th` A record configured by KKU DNS team → points to the KKU reverse proxy, which then forwards to our internal Ubuntu server

Document all of this in `docs/deployment/kku-network-integration.md`, including the cert fingerprint from `scripts/generate-self-signed-cert.sh` for possible pinning.

### Cert renewal

Self-signed cert is valid for 10 years. A calendar reminder at year 9 suffices. Renewal procedure:

```bash
# On prod server
cd /opt/program-landscape
sudo ./current/scripts/generate-self-signed-cert.sh
sudo docker compose -f current/docker-compose.yml restart nginx
# Notify KKU network team of new fingerprint if pinning is in use
```

## 4. Release bundling ("pack and ship")

The key requirement: **one command on dev builds everything; one bundle transfers to prod; one command deploys.**

Create `scripts/build-release.ts` (runs on dev machine inside WSL2):

```ts
// scripts/build-release.ts
// Usage: pnpm build:release 1.2.3

import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const version = process.argv[2] ?? `dev-${Date.now()}`;
const releaseDir = join('dist', 'releases', version);
mkdirSync(releaseDir, { recursive: true });

const ORG = 'khon-kaen-university';
const REPO = 'program-landscape';

const images = [
  { service: 'web',       image: `${REPO}-web`,       dockerfile: 'apps/web/Dockerfile.prod',         context: '.' },
  { service: 'api',       image: `${REPO}-api`,       dockerfile: 'apps/api/Dockerfile.prod',         context: '.' },
  { service: 'ingestion', image: `${REPO}-ingestion`, dockerfile: 'apps/ingestion/Dockerfile.prod',   context: '.' },
  { service: 'gotenberg', image: `${REPO}-gotenberg`, dockerfile: 'infra/gotenberg/Dockerfile',        context: 'infra/gotenberg' },
];

// 1. Build all images, tagged with version
for (const img of images) {
  const tag = `ghcr.io/${ORG}/${img.image}:${version}`;
  console.log(`Building ${tag}...`);
  execSync(
    `docker build --platform linux/amd64 -t ${tag} -f ${img.dockerfile} ${img.context}`,
    { stdio: 'inherit' }
  );
}

// 2. Save all images to a single tar file
const imageTags = images.map(i => `ghcr.io/${ORG}/${i.image}:${version}`).join(' ');
const imagesTar = join(releaseDir, 'images.tar');
console.log(`Saving images to ${imagesTar}...`);
execSync(`docker save -o ${imagesTar} ${imageTags}`, { stdio: 'inherit' });

// 3. Copy deployment artifacts
execSync(`cp docker-compose.prod.yml ${releaseDir}/docker-compose.yml`);
execSync(`cp -r infra/nginx ${releaseDir}/nginx`);
execSync(`cp -r infra/postgres ${releaseDir}/postgres`);
execSync(`cp .env.prod.example ${releaseDir}/.env.prod.example`);
execSync(`cp scripts/deploy.sh ${releaseDir}/deploy.sh`);
execSync(`cp scripts/rollback.sh ${releaseDir}/rollback.sh`);
execSync(`cp scripts/backup.sh ${releaseDir}/backup.sh`);
execSync(`cp scripts/restore.sh ${releaseDir}/restore.sh`);
execSync(`cp scripts/generate-self-signed-cert.sh ${releaseDir}/scripts/`);
execSync(`cp DEPLOYMENT.md ${releaseDir}/README.md`);

// 4. Write version manifest
writeFileSync(join(releaseDir, 'VERSION'), version);
writeFileSync(join(releaseDir, 'manifest.json'), JSON.stringify({
  version,
  builtAt: new Date().toISOString(),
  builtBy: process.env.USER ?? 'unknown',
  org: ORG,
  repo: REPO,
  images: images.map(i => `ghcr.io/${ORG}/${i.image}:${version}`),
  commit: execSync('git rev-parse HEAD').toString().trim(),
}, null, 2));

// 5. Create single tarball for transfer
const bundlePath = `dist/${REPO}-${version}.tar.gz`;
execSync(`tar czf ${bundlePath} -C dist/releases ${version}`);

// 6. Generate checksum for integrity verification
execSync(`cd dist && sha256sum ${REPO}-${version}.tar.gz > ${REPO}-${version}.tar.gz.sha256`);
console.log(`\nRelease bundle ready: ${bundlePath}`);
console.log(`Size: ${execSync(`du -h ${bundlePath}`).toString()}`);
```

Add to root `package.json`:
```json
"scripts": {
  "build:release": "tsx scripts/build-release.ts"
}
```

The resulting `.tar.gz` (typically 1–2 GB because it contains all Docker images) is what you transfer to the Ubuntu server.

## 5. Deploy/rollback scripts on the prod server

`scripts/deploy.sh` (runs on Ubuntu server, inside the extracted release directory):

```bash
#!/usr/bin/env bash
set -euo pipefail

RELEASE_DIR="$(cd "$(dirname "$0")" && pwd)"
VERSION=$(cat "$RELEASE_DIR/VERSION")
DEPLOY_ROOT="/opt/program-landscape"
CURRENT_LINK="$DEPLOY_ROOT/current"
RELEASES_DIR="$DEPLOY_ROOT/releases"

echo "=== Deploying KKU Curriculum Landscape v${VERSION} ==="

# Ensure directory structure
sudo mkdir -p "$RELEASES_DIR" "$DEPLOY_ROOT/secrets" "$DEPLOY_ROOT/backups"

# Preflight
command -v docker >/dev/null || { echo "docker not installed"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "docker compose v2 not installed"; exit 1; }

# 1. Load Docker images
echo "Loading images..."
docker load -i "$RELEASE_DIR/images.tar"

# 2. Stage release directory
TARGET="$RELEASES_DIR/$VERSION"
sudo cp -r "$RELEASE_DIR" "$TARGET"

# 3. Link env/secrets/certs from central location
sudo ln -sf "$DEPLOY_ROOT/secrets" "$TARGET/secrets"
sudo ln -sf "$DEPLOY_ROOT/.env.prod" "$TARGET/.env.prod"
sudo ln -sf "$DEPLOY_ROOT/certs" "$TARGET/infra/nginx/certs"

# 3a. Verify cert exists
if [ ! -f "$DEPLOY_ROOT/certs/fullchain.pem" ] || [ ! -f "$DEPLOY_ROOT/certs/privkey.pem" ]; then
  echo "ERROR: self-signed cert missing at $DEPLOY_ROOT/certs/"
  echo "Run ./scripts/generate-self-signed-cert.sh first."
  exit 1
fi

# 4. Back up DB before migration
if [ -L "$CURRENT_LINK" ]; then
  echo "Backing up current database..."
  "$CURRENT_LINK/backup.sh" pre-deploy-$VERSION
fi

# 5. Run DB migrations (in a one-shot container)
echo "Running migrations..."
cd "$TARGET"
export RELEASE_VERSION="$VERSION"
docker compose run --rm api pnpm --filter db prisma migrate deploy

# 6. Roll into new release (atomic symlink swap)
echo "Swapping release..."
sudo ln -sfn "$TARGET" "$CURRENT_LINK.new"
sudo mv -Tf "$CURRENT_LINK.new" "$CURRENT_LINK"

# 7. Bring services up with new images
cd "$CURRENT_LINK"
docker compose up -d --remove-orphans

# 8. Wait for health
echo "Waiting for services to become healthy..."
timeout 120 bash -c 'until [ "$(docker compose ps --format json | grep -c healthy)" -ge 6 ]; do sleep 2; done'

# 9. Smoke test
echo "Running smoke test..."
# Local HTTPS check — cert is self-signed so we pass -k. KKU proxy does the same.
curl -fsS -k -o /dev/null https://localhost:8443/healthz || { echo "Smoke test failed (nginx health)"; exit 1; }
curl -fsS -k -o /dev/null https://localhost:8443/api/health || { echo "Smoke test failed (api health)"; exit 1; }

# 10. Clean up old releases (keep last 5)
cd "$RELEASES_DIR"
ls -1t | tail -n +6 | xargs -r sudo rm -rf

# 11. Clean up dangling Docker images
docker image prune -f

echo "=== Deployment complete: v${VERSION} ==="
```

`scripts/rollback.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

DEPLOY_ROOT="/opt/program-landscape"
CURRENT_LINK="$DEPLOY_ROOT/current"
RELEASES_DIR="$DEPLOY_ROOT/releases"

PREVIOUS=$(ls -1t "$RELEASES_DIR" | sed -n '2p')
if [ -z "$PREVIOUS" ]; then echo "No previous release to roll back to"; exit 1; fi

echo "Rolling back to $PREVIOUS..."

# Restore previous DB snapshot if it exists
LATEST_BACKUP=$(ls -1t "$DEPLOY_ROOT/backups"/pre-deploy-*.sql.gz 2>/dev/null | head -1)
if [ -n "$LATEST_BACKUP" ]; then
  read -p "Restore DB from $LATEST_BACKUP? (y/N) " confirm
  [[ "$confirm" == "y" ]] && "$CURRENT_LINK/restore.sh" "$LATEST_BACKUP"
fi

sudo ln -sfn "$RELEASES_DIR/$PREVIOUS" "$CURRENT_LINK.new"
sudo mv -Tf "$CURRENT_LINK.new" "$CURRENT_LINK"

cd "$CURRENT_LINK"
export RELEASE_VERSION="$PREVIOUS"
docker compose up -d

echo "Rolled back to $PREVIOUS"
```

## 6. Database backup & restore

`scripts/backup.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

LABEL="${1:-$(date +%Y%m%d-%H%M%S)}"
BACKUP_DIR="/opt/program-landscape/backups"
mkdir -p "$BACKUP_DIR"

# Dump via the running postgres container
docker compose exec -T postgres pg_dump -U "$(cat /run/secrets/postgres_user)" kku_curriculum \
  | gzip > "$BACKUP_DIR/$LABEL.sql.gz"

# Also back up MinIO (original PDFs — they're evidence)
docker compose exec -T minio mc mirror local/ /tmp/minio-backup/
docker compose cp minio:/tmp/minio-backup "$BACKUP_DIR/$LABEL-minio/"

# Retention: keep 30 days of daily backups, 1 year of monthly
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +30 \
  ! -name "*-01.sql.gz" -delete

echo "Backup complete: $BACKUP_DIR/$LABEL.sql.gz"
```

`scripts/restore.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

BACKUP_FILE="$1"
[ -f "$BACKUP_FILE" ] || { echo "Backup file not found: $BACKUP_FILE"; exit 1; }

echo "WARNING: This will overwrite the current database."
read -p "Type 'restore' to confirm: " confirm
[[ "$confirm" == "restore" ]] || exit 1

# Stop services that write to DB
docker compose stop api ingestion

gunzip -c "$BACKUP_FILE" | docker compose exec -T postgres \
  psql -U "$(cat /run/secrets/postgres_user)" kku_curriculum

docker compose start api ingestion
echo "Restore complete."
```

Add a systemd timer on the prod server (documented in `DEPLOYMENT.md`) that runs `backup.sh` nightly at 02:00 local time.

## 7. Secrets management

Secrets live in `/opt/program-landscape/secrets/` on the prod server with mode 0600 owned by the deploy user.

Files expected:
- `postgres_user`
- `postgres_password`
- `minio_user`
- `minio_password`
- `.env.prod` (contains ANTHROPIC_API_KEY, KKU_SSO_CLIENT_SECRET, NEXTAUTH_SECRET, OPENAI_API_KEY if used, JWT_SECRET, etc.)

Document a rotation runbook in `docs/deployment/secrets.md`.

For production hardening later (if KKU requires): move to HashiCorp Vault or KKU's internal secret management. The current file-based approach is fine for initial deployment.

## 8. Handling images without Docker Hub access

The whole point of `docker save` + `docker load` is that the prod server never needs to pull from any registry. The images arrive as a tar file in the release bundle.

Base images (`node:20-alpine`, `nginx:1.27-alpine`, `postgis/postgis:16-3.4`, `redis:7-alpine`, `minio/minio:latest`, `gotenberg/gotenberg:8`) ARE pulled during the `docker build` step on the dev machine. The resulting images embed those layers, so the prod server only needs to load the final tar.

If the dev machine also has restricted outbound access:
- Maintain a small internal registry in KKU's network
- Mirror base images there once
- Dev machine pulls from the internal registry during build

Document this in `docs/deployment/network-requirements.md`.

## 9. Environment separation

Three environments:
- **dev**: Windows/WSL2 dev machines, `docker-compose.yml` (already exists)
- **staging** (optional): a second Ubuntu instance running the same bundle with a `staging` tag, used for dress-rehearsal deployments
- **prod**: single Ubuntu server, latest stable version

Env vars per environment:
- `.env.dev` — local dev
- `.env.staging` — staging secrets
- `.env.prod` — production secrets (never checked in; `.env.prod.example` is the template)

The build process is identical for all three; only the `.env.*` and the target server differ.

## 10. Monitoring the production box

Add to deployment checklist:
- **Disk space monitoring** — PDFs in MinIO grow unbounded; set alert at 70% used
- **Postgres bloat** monitoring — enable `pg_stat_statements`, review monthly
- **Log shipping** — decide early: do logs stay on the box (read via `docker logs`) or ship to central log aggregator (Loki + Grafana recommended if KKU has capacity)
- **Uptime monitoring** — external HTTP check hitting `/api/health` every minute (can use free tier of something like Uptime Robot, or KKU's internal monitoring if available)

## 11. Documentation — `DEPLOYMENT.md`

Create `DEPLOYMENT.md` at the repo root with:

- **Production facts**
  - Domain: `program-landscape.kku.ac.th`
  - GitHub repo: `https://github.com/khon-kaen-university/program-landscape`
  - **End-to-end TLS model:** KKU's university reverse proxy terminates the public cert; re-encrypts to us with a self-signed cert. KKU proxy configured with `proxy_ssl_verify off` (or cert pinning). We serve HTTPS on `:8443`.
  - Hosted on an on-prem Ubuntu server on KKU's internal network
- **Server requirements:** Ubuntu 22.04 LTS or 24.04, ≥16 GB RAM, ≥500 GB disk, ≥4 cores
- **One-time server setup:** install Docker Engine + Compose v2, create deploy user, create `/opt/program-landscape/`, place secrets in `/opt/program-landscape/secrets/`, **run `generate-self-signed-cert.sh` once** to create `/opt/program-landscape/certs/`
- **KKU network coordination items** (requires KKU network team):
  - DNS: A record `program-landscape.kku.ac.th` → KKU reverse proxy (not our server directly)
  - KKU reverse proxy config: forwards to our host `:8443` over HTTPS with `proxy_ssl_verify off` (or pin our cert fingerprint)
  - KKU reverse proxy IP(s) added to `set_real_ip_from` in `infra/nginx/nginx.conf`
  - Health-check endpoint for KKU proxy monitoring: `GET https://<our-host>:8443/healthz` returns 200 OK
  - Expected headers from KKU proxy: `X-Forwarded-For`, `X-Forwarded-Proto`, `X-Forwarded-Host` (confirm exact names with KKU)
  - Share our self-signed cert's SHA-256 fingerprint with KKU team (for pinning, optional but recommended)
- **Build on dev machine (Windows/WSL2):** `pnpm build:release 1.0.0`
- **Transfer:** `scp dist/program-landscape-1.0.0.tar.gz kku-prod:/tmp/`
- **Deploy on prod:** `ssh kku-prod`, `cd /tmp && tar xzf program-landscape-1.0.0.tar.gz && cd 1.0.0 && ./deploy.sh`
- **Rollback:** `ssh kku-prod`, `cd /opt/program-landscape/current && ./rollback.sh`
- **Backup:** automatic nightly via systemd timer; manual `./backup.sh some-label`
- **Restore:** `./restore.sh /opt/program-landscape/backups/<label>.sql.gz`
- **Common operations:** view logs (`docker compose logs -f <service>`), restart a single service, scale ingestion workers, run ad-hoc migration
- **Verifying KKU proxy integration after deploy:**
  1. From the Ubuntu host: `curl -k -H "Host: program-landscape.kku.ac.th" https://localhost:8443/healthz` should return `ok`
  2. From a browser: `https://program-landscape.kku.ac.th` should load the app with a valid publicly-trusted cert (from the KKU proxy)
  3. Check app logs show real client IPs (via `X-Forwarded-For`), not the KKU proxy IP
  4. Check NextAuth callback URL includes `https://program-landscape.kku.ac.th`, not `http://...`
  5. Check the self-signed cert fingerprint matches what was shared with KKU network team:
     `sudo openssl x509 -in /opt/program-landscape/certs/fullchain.pem -noout -fingerprint -sha256`
- **Incident response playbook**
- **Pre-flight checklist before every production deployment**

Required `.env.prod` values (document each):
```
NEXTAUTH_URL=https://program-landscape.kku.ac.th
AUTH_TRUST_HOST=true
APP_PUBLIC_URL=https://program-landscape.kku.ac.th
API_PUBLIC_URL=https://program-landscape.kku.ac.th/api
KKU_SSO_REDIRECT_URI=https://program-landscape.kku.ac.th/api/auth/callback/kku-sso
# ...plus all the database, queue, AI, and other secrets
```

## 12. CI/CD via GitHub Actions (hosted in khon-kaen-university org)

**Repository:** `https://github.com/khon-kaen-university/program-landscape`

**Container image naming:** use GitHub Container Registry (GHCR) convention even though images travel in bundles:
- `ghcr.io/khon-kaen-university/program-landscape-web:<version>`
- `ghcr.io/khon-kaen-university/program-landscape-api:<version>`
- `ghcr.io/khon-kaen-university/program-landscape-ingestion:<version>`
- `ghcr.io/khon-kaen-university/program-landscape-gotenberg:<version>`

Update `scripts/build-release.ts` to tag with the GHCR naming:

```ts
const ORG = 'khon-kaen-university';
const images = [
  { name: 'program-landscape-web',       dockerfile: 'apps/web/Dockerfile.prod' },
  { name: 'program-landscape-api',       dockerfile: 'apps/api/Dockerfile.prod' },
  { name: 'program-landscape-ingestion', dockerfile: 'apps/ingestion/Dockerfile.prod' },
  { name: 'program-landscape-gotenberg', dockerfile: 'infra/gotenberg/Dockerfile' },
];
for (const img of images) {
  const tag = `ghcr.io/${ORG}/${img.name}:${version}`;
  // ...
}
```

And update `docker-compose.prod.yml` service images:
```yaml
  web:
    image: ghcr.io/khon-kaen-university/program-landscape-web:${RELEASE_VERSION}
  api:
    image: ghcr.io/khon-kaen-university/program-landscape-api:${RELEASE_VERSION}
  # ...etc
```

**Workflows:**

`.github/workflows/ci.yml` (PR and push to main):
- Lint + typecheck + test + build
- Use secrets from org-level settings for any integration tests
- Block merge on failure

`.github/workflows/release.yml` (on tag push matching `v*`):
- Run full test suite
- Run `pnpm build:release ${tag}`
- Attach the resulting `.tar.gz` to the GitHub release
- Optionally push images to `ghcr.io` so they're also fetchable there (useful if network allows)
- Create a signed checksum file (`SHA256SUMS`) alongside the release
- Notify (via webhook or email) that a release is ready to deploy

**Optional: self-hosted runner inside KKU network**

If KKU allows, set up a self-hosted GitHub runner inside KKU's network registered to the `khon-kaen-university` org. This runner can SSH to the prod server and run `./deploy.sh` in the same workflow. Still keep a **manual approval step** in GitHub Actions UI before deploy — for a Council-facing system, human-in-the-loop is the right model.

**Branch protection (configure in GitHub repo settings):**
- `main` branch protected: require PR reviews, require CI pass, no direct pushes
- Release tags only by maintainers
- Signed commits recommended

**GitHub repo setup checklist:**
- [ ] Repo created at `https://github.com/khon-kaen-university/program-landscape`
- [ ] `CODEOWNERS` file defines review responsibilities
- [ ] Issue templates for bug, feature, data-source-integration
- [ ] PR template with checklist (tests, docs, CLAUDE.md updates, breaking changes flag)
- [ ] Branch protection on `main`
- [ ] GHCR access configured for pushing from Actions
- [ ] Secrets registered: `ANTHROPIC_API_KEY`, `KKU_SSO_CLIENT_SECRET`, any other integration keys
- [ ] `README.md` at repo root with status badges (CI, release), quickstart link to `prompts/`, link to `DEPLOYMENT.md`
- [ ] `LICENSE` file (discuss with KKU legal — likely MIT or Apache 2.0 for internal, or proprietary if Council requires)
- [ ] `SECURITY.md` describing how to report vulnerabilities

Do NOT wire automatic prod deployment from main/tag — the manual gate is non-negotiable for Council use.

## 13. Smoke test suite

A small set of smoke tests that run after every deployment via `scripts/smoke-test.sh`:

```bash
# Local HTTPS checks — self-signed cert, so -k to skip cert verification
curl -fsS -k https://localhost:8443/healthz
curl -fsS -k https://localhost:8443/api/health
curl -fsS -k https://localhost:8443/api/v1/faculties -H "Authorization: Bearer $TEST_TOKEN"
# End-to-end check from outside the server (run from your workstation):
# curl -fsS https://program-landscape.kku.ac.th/api/health
# ...
```

If any fail, `deploy.sh` exits non-zero and `rollback.sh` is suggested.

## 14. Tests

- Test that `build-release.ts` produces a valid bundle (check manifest, check images.tar contains the expected image names)
- Test that `deploy.sh` is idempotent (running twice with same version is a no-op)
- Test rollback path on a staging environment
- Test backup + restore round-trip (restore into a separate DB, compare row counts)

## Deliverables

- Working `pnpm build:release <version>` producing a complete bundle
- Production `docker-compose.prod.yml` with all services, healthchecks, resource limits
- Working `deploy.sh`, `rollback.sh`, `backup.sh`, `restore.sh`
- Nginx config with TLS
- `DEPLOYMENT.md` with full runbook
- A successful end-to-end test: build on WSL2, transfer to a test Ubuntu VM, deploy, smoke-test
- 3 suggestions for next session (likely: real data integration, or pilot rollout plan)
