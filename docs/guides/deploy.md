# Deploy and size the infrastructure

> **ภาษาไทย:** [ฉบับภาษาไทย](../th/guides/deploy.md)

**Outcome.** You can package a release, ship it to your own server and size that server.

## The model: pack-and-ship

Production servers **never pull from a registry**. You build images on a development machine, bundle them into a single tarball, transfer it, and `docker load` on the server.

```bash
# On the dev machine (inside WSL2 if on Windows)
pnpm build:release <version>
# → dist/program-landscape-<version>.tar.zst  (~2.2 GB, zstd-compressed)
# → dist/program-landscape-<version>.tar.zst.sha256
```

The bundle contains `images.tar` (4 images, all `linux/amd64`), the compose file, the nginx config, the deployment scripts, the systemd units, and the env template. Nothing else needs to travel.

**All production images are `linux/amd64`.** If your dev machine is an ARM Mac, builds must pass `--platform linux/amd64`.

**One build-process gotcha:** `docker buildx` runs each image's `COPY` when that stage executes, so a commit landing mid-build makes it into some images and not others. If a fix must be in the bundle, kill the build, prune, and restart.

On the server, `scripts/deploy.sh` is idempotent and does an atomic symlink swap (`/opt/program-landscape/current → releases/<ver>`) as its point of no return; anything before that is rolled back automatically on failure. Migrations run in a **disposable container** (`docker compose run --rm --entrypoint "" api node node_modules/.bin/prisma migrate deploy`) rather than from the long-lived API container, which would race with ingestion on startup.

Companion scripts: `rollback.sh`, `backup.sh`, `restore.sh`, `smoke-test.sh`, `pre-deploy-snapshot.mjs`, `generate-self-signed-cert.sh`.

Rollback is **code-only by default**; `rollback.sh` asks whether to restore the pre-deploy database snapshot and the usual answer is no, because migrations are forward-only and the code rollback is schema-compatible.

## TLS topology

KKU's arrangement, which most Thai universities can mirror:

```
public → university reverse proxy (terminates public cert)
       → re-encrypts, forwards to our host on :8443 (self-signed)
       → our internal nginx (TLS + path routing)
       → web / api over plain HTTP inside the docker network
```

The upstream proxy is configured with `proxy_ssl_verify off` (or SHA-256 certificate pinning). One nginx detail that will bite you if you rebuild the config: `next-auth` lives at `/api/auth/*` on the web app while the NestJS prefix is `/api/v1` — you need an explicit `location /api/auth/` → web rule, or auth 404s against the Nest router.

Security headers are set at the **application layer**, not in nginx, so they are correct regardless of which proxy path a request takes.

KKU's own step-by-step runbook is [`DEPLOYMENT.md`](../../DEPLOYMENT.md) in the repository. It describes KKU's server, paths and network, so read it as a worked example and adapt the names to yours.

## Sizing

From `docs/production-infrastructure.md` — real numbers from KKU's deployment, not invented:

| Resource | Minimum | Recommended | Why |
|---|---|---|---|
| CPU | 4 cores | **8 cores** | Gotenberg launches headless Chromium per render; ingestion workers and AI calls run concurrently |
| RAM | 16 GB | **32 GB** | Postgres shared buffers (4 GB) + MinIO cache + Chromium peaks (4–8 concurrent Council Pack renders) + Node heap × 3 services |
| Disk | 500 GB SSD | **1 TB NVMe SSD** | Postgres + MinIO + 90 days of pre-deploy snapshots + 30 days of nightly backups + Docker layers + the programme PDF archive (~5 GB at 297 programmes) |
| OS | Ubuntu 22.04 LTS | Ubuntu 24.04 LTS | x86_64 only |
| GPU | none | none | All inference is via vendor APIs |

Read the rest of that document for the inbound/outbound network requirements table — it enumerates every destination the server needs to reach, which is exactly what your network team will ask for.

**Disk hygiene is a real operational concern, not a footnote.** KKU's dev machine hit 92% during one multi-build cycle (each ~2.5 GB tarball plus a ~6 GB staging directory plus 14 GB of reclaimable build cache) and production hit 100% during a deploy on accumulated old backups. Rules of thumb: keep the last three release tarballs on dev and run `docker builder prune -af` after each release cycle; keep the last three release directories, backups, and images on production; and always check `df -h /` **before** running `deploy.sh`, since the pre-deploy snapshot needs ~3 GB of headroom.

Backups are systemd-timed (nightly at 02:00 Asia/Bangkok), not cron; unit files ship in the bundle under `infra/systemd/`. Retention is 30 days of dailies, 90 of pre-deploys, 365 of monthlies.

## Next step

Continue with [Backup and disaster recovery](../backup-dr.md).
