# Deployment Runbook — Program Landscape

> Production deployment to a single on-prem Ubuntu server inside KKU's internal network. Designed around a **pack-and-ship** workflow: build the bundle on the dev machine, transfer the `.tar.zst` to the server, run `./scripts/deploy.sh`.

---

## Production facts

| Field | Value |
|---|---|
| Public URL | `https://program-landscape.kku.ac.th` |
| GitHub repo | `https://github.com/khon-kaen-university/program-landscape` |
| Image registry (optional) | `ghcr.io/khon-kaen-university/program-landscape-<service>:<version>` |
| Install path on server | `/opt/program-landscape/` |
| Our TLS port | `:8443` (HTTPS, self-signed) |
| HTTP port (redirects to HTTPS) | `:8080` |

## TLS architecture

```
user's browser
    │ TLS (public cert for program-landscape.kku.ac.th)
    ▼
KKU university reverse proxy
    │ TLS re-encrypted, proxy_ssl_verify off (or SHA-256 cert pinning)
    ▼
our Ubuntu server :8443
    │ (self-signed cert — 10-year lifetime)
    ▼
internal nginx container
    │ HTTP on docker bridge
    ├──► web:3000   (Next.js)
    └──► api:4000   (NestJS)
```

Self-signed cert generation + pinning handshake with KKU network team: see **[`docs/deployment/kku-network-integration.md`](./docs/deployment/kku-network-integration.md)**.

---

## Server requirements

- **OS**: Ubuntu 22.04 LTS or 24.04 LTS (x86_64).
- **RAM**: 16 GB minimum, 32 GB recommended.
- **Disk**: 500 GB SSD (Postgres + MinIO + backups grow).
- **CPU**: 4 cores minimum, 8 recommended.
- **Software**:
  - Docker Engine ≥ 24.0 + Docker Compose v2 (`docker compose`, not `docker-compose`).
  - `openssl`, `curl`, `wget`, `tar`, `gzip`, `systemd-timers`.
- **Network**:
  - Inbound from KKU reverse proxy on `:8443` (and optionally `:8080` for redirect).
  - Outbound HTTPS for data ingestion (flip off with KKU network team if only KKU-internal feeds are used).
  - NO inbound from public internet — KKU proxy is the only ingress.

---

## One-time server setup

Run once per host. Adapt the deploy-user name if your convention differs.

```bash
# 1. OS prereqs
sudo apt update && sudo apt install -y docker.io docker-compose-v2 openssl curl tar gzip

# 2. Deploy user + groups
sudo useradd -m -s /bin/bash -G docker,sudo deploy
# (+ add your operator SSH keys to ~deploy/.ssh/authorized_keys)

# 3. Base directory
sudo mkdir -p /opt/program-landscape/{releases,secrets,certs,backups}
sudo chown -R deploy:deploy /opt/program-landscape
sudo chmod 700 /opt/program-landscape/secrets

# 4. Secret files (one value per file, mode 0600)
sudo tee /opt/program-landscape/secrets/postgres_user >/dev/null <<<"kku_prod"
sudo tee /opt/program-landscape/secrets/postgres_password >/dev/null <<<"$(openssl rand -base64 32)"
sudo tee /opt/program-landscape/secrets/minio_user >/dev/null <<<"kku_minio"
sudo tee /opt/program-landscape/secrets/minio_password >/dev/null <<<"$(openssl rand -base64 32)"
sudo chmod 600 /opt/program-landscape/secrets/*

# 5. .env.prod
sudo cp /tmp/first-bundle/.env.prod.example /opt/program-landscape/.env.prod
sudo chown root:root /opt/program-landscape/.env.prod
sudo chmod 600 /opt/program-landscape/.env.prod
sudo vi /opt/program-landscape/.env.prod    # fill in real values
# IMPORTANT: DATABASE_URL must contain the same user/password as the
# secrets files above. The current release doesn't auto-splice them.

# 6. Self-signed cert
sudo /tmp/first-bundle/scripts/generate-self-signed-cert.sh
sudo openssl x509 -in /opt/program-landscape/certs/fullchain.pem -noout -fingerprint -sha256
# Share the fingerprint with KKU network team for pinning.

# 7. Systemd timer for nightly backups (see "Backups" below)
sudo cp /tmp/first-bundle/infra/systemd/program-landscape-backup.* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now program-landscape-backup.timer
```

Then coordinate with KKU network team (see [`docs/deployment/kku-network-integration.md`](./docs/deployment/kku-network-integration.md)) before the first deploy.

---

## Build → transfer → deploy

### On dev machine (Windows + WSL2 Ubuntu)

```bash
cd ~/projects/program-landscape
pnpm install --frozen-lockfile

# Build the bundle — produces dist/program-landscape-<version>.tar.zst
pnpm build:release 1.0.0

# Verify checksum before transfer
cat dist/program-landscape-1.0.0.tar.zst.sha256
```

The bundle is typically 1.5–2.5 GB (dominated by the four Docker images).

**Both machines need `zstd`** (`sudo apt-get install -y zstd`). The build
fails immediately without it; the server cannot unpack without it.

### Transfer to prod

Not `/tmp`. On this VM `/tmp` is memory-backed, and unpacking ~6.7 GB there
exhausted RAM and wedged the host — twice, on different releases, each time
needing a forced restart. Unpack somewhere on real disk.

```bash
scp dist/program-landscape-1.0.0.tar.zst kku-prod:~/
scp dist/program-landscape-1.0.0.tar.zst.sha256 kku-prod:~/
```

### On prod server

```bash
ssh kku-prod
cd ~
df -h .                                            # ~10 GB free: archive + unpacked tree
sha256sum -c program-landscape-1.0.0.tar.zst.sha256
tar --zstd -xf program-landscape-1.0.0.tar.zst
cd program-landscape-1.0.0
./scripts/deploy.sh
```

### Alternative: stream the images, skip the archive entirely

Lightest option — writes ~4 MB to the server instead of ~9 GB, because the
images never land on its filesystem as a file. `deploy.sh` detects that
`images.tar` is absent and continues against the already-loaded images.

```bash
# on the dev machine
ssh kku-prod 'docker load' < dist/releases/program-landscape-1.0.0/images.tar
rsync -a --partial --exclude images.tar \
  dist/releases/program-landscape-1.0.0/ kku-prod:~/program-landscape-1.0.0/

# on the server
cd ~/program-landscape-1.0.0 && ./scripts/deploy.sh
```

Integrity still holds: `docker load` verifies every layer digest, so a
corrupted transfer fails there rather than silently deploying.

`deploy.sh` is idempotent and covers:
1. Loads images from `images.tar` (no Docker Hub pull needed).
2. Stages release at `/opt/program-landscape/releases/1.0.0/`.
3. Symlinks secrets + `.env.prod` + certs from the central location.
4. Takes a pre-deploy DB snapshot (if a previous release exists).
5. Runs `prisma migrate deploy` in a disposable container.
6. Atomically swaps `/opt/program-landscape/current → releases/1.0.0`.
7. `docker compose up -d` the new stack.
8. Waits up to 3 minutes for every container to report healthy.
9. Runs `scripts/smoke-test.sh`.
10. Prunes old builds — release dirs + tagged images (keeps last 3; override with `KEEP_BUILDS`).

Total deploy time: 3–6 minutes for a zero-migration release; 5–10 minutes when migrations run.

---

## Rollback

```bash
ssh kku-prod
sudo /opt/program-landscape/current/scripts/rollback.sh           # → previous
sudo /opt/program-landscape/current/scripts/rollback.sh 0.13.0    # → specific
```

The script asks whether to restore the pre-deploy DB snapshot — say yes only when a bad migration was the root cause. For a code-only rollback, leave the DB alone (our migration policy is forward-only; schema is a prefix of all later versions).

---

## Backups

**Automatic:** a systemd timer runs `./scripts/backup.sh` nightly at 02:00 Asia/Bangkok.

Unit files (placed under `/etc/systemd/system/`):

```ini
# program-landscape-backup.service
[Unit]
Description=Program Landscape nightly backup

[Service]
Type=oneshot
User=root
WorkingDirectory=/opt/program-landscape
ExecStart=/opt/program-landscape/current/scripts/backup.sh
```

```ini
# program-landscape-backup.timer
[Unit]
Description=Nightly backup at 02:00 Asia/Bangkok

[Timer]
OnCalendar=*-*-* 02:00:00 Asia/Bangkok
Persistent=true

[Install]
WantedBy=timers.target
```

**Manual:**

```bash
sudo /opt/program-landscape/current/scripts/backup.sh pre-deploy-1.2.3
```

Outputs:
- `/opt/program-landscape/backups/<label>.sql.gz`  — pg_dump (custom format)
- `/opt/program-landscape/backups/<label>-minio.tar.gz`  — tar of MinIO data

Retention (enforced by the script):
- Dailies: 30 days.
- Pre-deploy snapshots: 90 days.
- Monthly archives (`monthly-YYYY-MM-01.sql.gz`, manually promoted): 365 days.

Off-server mirror: configure `rclone` or `aws s3 sync` to copy `/opt/program-landscape/backups/` to KKU's central archive nightly at 03:30.

---

## Restore

```bash
# Pick a backup file, then:
sudo /opt/program-landscape/current/scripts/restore.sh \
  /opt/program-landscape/backups/2026-04-24-020000.sql.gz
```

Interactive: you must type `restore` to confirm. Web + api + ingestion are stopped during `pg_restore` to avoid concurrent writes. Smoke test runs automatically afterward.

Full recovery drill runs quarterly — see `docs/backup-dr.md`.

---

## Required `.env.prod` values

`.env.prod.example` in the bundle lists every key. The non-obvious ones:

| Key | Value |
|---|---|
| `NEXTAUTH_URL` | `https://program-landscape.kku.ac.th` (public URL, not our `:8443`) |
| `AUTH_TRUST_HOST` | `true` — needed because TLS terminates upstream at KKU proxy |
| `NEXTAUTH_SECRET` | `openssl rand -hex 64` |
| `DATABASE_URL` | `postgresql://<pg_user>:<pg_password>@postgres:5432/program_landscape?schema=public` — same credentials as `/opt/program-landscape/secrets/postgres_{user,password}` |
| `REDIS_URL` | `redis://redis:6379` |
| `MINIO_ENDPOINT` | `http://minio:9000` |
| `GOTENBERG_URL` | `http://gotenberg:3000` |
| `AI_PROVIDER` | `google` (and set both `GOOGLE_AI_API_KEY` + `ANTHROPIC_API_KEY` so fallback works) |
| `KKU_SSO_*` | coordinated with KKU IT — see `docs/auth/kku-sso.md` |
| `ENABLE_LOCAL_AUTH` | **must be `false`** (prod guard aborts startup otherwise) |
| `MINIO_BUCKET_AVATARS` | `avatars` (auto-created on first upload — used by `/profile`) |
| `KKU_SCOPUS_API_KEY` | Elsevier institutional key — primary publication source for `/profile`. Without it the profile page falls back to kkuscholar (slow). Profile-page-only; bulk modules continue using kkuscholar. |
| `OPENALEX_MAILTO` | Email address — enables OpenAlex's polite pool (10 req/s) for the profile page co-author DOI / metadata fallback. |

**Bulk vs profile-page outbound posture.** The profile page (`/profile`)
calls Scopus + OpenAlex per-user on cold cache loads. The cockpit /
gap-analyzer / benchmarking modules **never** touch Scopus or OpenAlex —
they read from the kkuscholar mirror at `10.130.2.151:5432` to stay
under Scopus's 20 k req/week institutional rate limit. If your firewall
blocks `api.elsevier.com` and `api.openalex.org`, only the profile page
degrades; everything else is unaffected.

---

## Common operations

```bash
# Tail logs
sudo docker compose logs -f --tail=200                    # all services
sudo docker compose logs -f --tail=200 api                # one service

# Restart one service (e.g. after a config tweak in .env.prod)
sudo docker compose restart api

# Container shell
sudo docker compose exec api sh

# Reset the ingestion worker (drain current jobs, restart)
sudo docker compose restart ingestion

# Manual DB migration
sudo docker compose run --rm --entrypoint "" api \
  node node_modules/.bin/prisma migrate deploy --schema=packages/db/prisma/schema.prisma

# Exec psql
sudo docker compose exec postgres psql \
  -U "$(sudo cat /opt/program-landscape/secrets/postgres_user)" \
  -d program_landscape

# Scale ingestion workers (not usually needed; BullMQ concurrency is
# env-tuned via PDF_INTAKE_CONCURRENCY and AI_JOBS_CONCURRENCY)
sudo docker compose up -d --scale ingestion=2
```

---

## Post-deploy verification checklist

After `deploy.sh` exits 0:

1. **From the Ubuntu host**
   ```bash
   curl -k https://localhost:8443/healthz                              # expect "ok"
   curl -k https://localhost:8443/api/v1/ready | grep -q '"status":"ok"'
   ```
2. **From a browser**
   - Navigate to `https://program-landscape.kku.ac.th` — SPA shell loads.
   - Dev-tools Network tab: every asset is `200`, no mixed-content warnings.
   - Cert chain: browser shows the KKU-issued public cert, not our self-signed one.
3. **Sign in**
   - Redirects to KKU SSO, bounces back to `/api/auth/callback/kku-sso`, lands on `/`.
   - Session cookie is `__Secure-authjs.session-token`, `httpOnly`, `SameSite=Lax`.
4. **Audit trail**
   - `docker compose logs api | grep -E 'AuditLog|requestId'` shows forwarded-for IPs from real KKU clients, not the proxy IP.
5. **AI path**
   - On `/admin/system-status`: the AI 24h strip shows the configured provider; no "ai provider failing" banner.
6. **Cert pinning**
   ```bash
   sudo openssl x509 -in /opt/program-landscape/certs/fullchain.pem -noout -fingerprint -sha256
   ```
   matches the fingerprint KKU network team has (or `proxy_ssl_verify off` is confirmed active on their side).

---

## Pre-deploy checklist

Before every production deploy:

- [ ] PR merged to `main`; release tag `vX.Y.Z` pushed.
- [ ] CI green on that tag.
- [ ] Migration reviewed for forward-only compliance (see `docs/migration-policy.md`).
- [ ] `docs/methodologies/*.md` updated for any methodology-version bump.
- [ ] `pnpm ai:eval` passes (≥ same # of safety cases green as last release).
- [ ] Release bundle checksum verified on the prod server before extraction.
- [ ] Operator has a rollback window and knows `./scripts/rollback.sh`.
- [ ] Council / Exec stakeholders informed if the release changes user-visible surfaces.

---

## Incident response (prod)

- **P1 — app unreachable.** `sudo docker compose ps` → which service is not healthy? `logs <service>`. If nginx is the only unhealthy one, usually means a cert mount broke — re-run the one-time cert step.
- **P1 — migration went wrong.** `sudo /opt/program-landscape/current/scripts/rollback.sh` → answer `y` to DB restore.
- **P2 — AI provider down.** System auto-falls back to the secondary (prompt-13 transient-fallback). Verify: `docker logs api | grep 'ai/fallback'`. If both are down, the UI shows a clear error; cost-impact is zero.
- **P2 — disk alarm.** `du -sh /var/lib/docker /opt/program-landscape/*` — usually MinIO or backup retention. Prune via `docker image prune -a` or rotate backups manually.

Full incident playbook: [`docs/guides/admin-runbook.md`](./docs/guides/admin-runbook.md).

---

## What's in the bundle

```
program-landscape-<version>/
├── DEPLOYMENT.md
├── VERSION
├── manifest.json
├── docker-compose.yml          (the prod compose)
├── .env.prod.example
├── images.tar                  (docker save of all 4 images)
├── infra/
│   ├── nginx/
│   │   ├── nginx.conf
│   │   ├── conf.d/
│   │   │   └── program-landscape.conf
│   │   └── certs/              (empty; symlinked to /opt/.../certs at deploy)
│   └── postgres/
│       ├── Dockerfile
│       ├── README.md
│       └── init/               (extension SQL)
└── scripts/
    ├── deploy.sh
    ├── rollback.sh
    ├── backup.sh
    ├── restore.sh
    ├── smoke-test.sh
    └── generate-self-signed-cert.sh
```

Everything the Ubuntu box needs is in there. Bundle + `.env.prod` + secrets files + cert = a working deploy, no network dependency at deploy time (aside from whatever your app itself calls outbound at runtime).

---

## Related docs

- [`docs/deployment/kku-network-integration.md`](./docs/deployment/kku-network-integration.md) — KKU proxy config, cert pinning, firewall rules
- [`docs/backup-dr.md`](./docs/backup-dr.md) — backup classes, retention, restore drill
- [`docs/migration-policy.md`](./docs/migration-policy.md) — forward-only schema evolution
- [`docs/security-review.md`](./docs/security-review.md) — endpoint authz, dep audit, remaining CVEs
- [`docs/guides/admin-runbook.md`](./docs/guides/admin-runbook.md) — everyday ops
- [`docs/rollout-plan.md`](./docs/rollout-plan.md) — phased launch plan
