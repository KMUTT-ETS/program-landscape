# Plan — Prompt 07: Container & Dockerfile hardening

**Mode:** code change. Surgical edits to compose + Dockerfiles. No functional regression.

## What's already in place (from prompts 02 + 13b)

- 3 multi-stage Dockerfiles (web/api/ingestion) with non-root `USER app`.
- Custom postgres + gotenberg images.
- Compose file with healthchecks + resource limits + logging caps + named volumes + compose secrets.

## What needs to land in this prompt (per scope items 1–9)

| # | Item | Status | Action |
|---|---|---|---|
| 1 | Non-root | App images already use `USER app` (UID 1001). | **Verify.** Add `user:` overrides in compose for upstream images that may default to root. |
| 2 | Read-only root FS | Not enabled. | **Add `read_only: true` + tmpfs mounts** for every service. Map: nginx → `/var/cache/nginx`, `/var/run`, `/tmp`; web → `/tmp`, `/.next/cache`; api → `/tmp`; ingestion → `/tmp`; gotenberg → `/tmp`. Postgres / Redis / MinIO write to named volumes — read_only:true + writable mounts on data dirs. |
| 3 | Drop capabilities | Not set. | **`cap_drop: [ALL]`** on every service. **No add-back** — nginx binds 8080/8443, both >1024 inside the container, so no `NET_BIND_SERVICE` needed. |
| 4 | No-new-privileges | Not set. | `security_opt: ["no-new-privileges:true"]` on every service. |
| 5 | Health checks | Already present on all 7 services. | **Verify** + improve: nginx healthcheck currently `wget /healthz`; keep. Confirm gotenberg endpoint is `/health`. |
| 6 | Multi-stage | Done in prompt 02. | **Document** image-size deltas; flag any source-map or `.cache` leak. |
| 7 | Pinned digests | All images on tags. | **Resolve digests** for locally-cached images (`redis:7-alpine`, `minio:RELEASE…`, `nginx:1.27-alpine`); add inline placeholders for the rest with the `pin-digests.sh` helper script + documented rotation procedure. |
| 8 | Resource limits | Already set on all 7 services. | **Verify;** no changes needed. |
| 9 | Logging caps | Already set on all 7. | **Verify;** standardise to 50 MB / 5 files per the prompt's recommendation. |

## Approach

1. Open `docker-compose.prod.yml`. For each service, add the security block:
   ```yaml
   read_only: true
   security_opt: ["no-new-privileges:true"]
   cap_drop: [ALL]
   tmpfs:
     - /tmp
   ```
2. Per-service deviations:
   - **nginx:** add `tmpfs: /var/cache/nginx, /var/run`. Set `user: "nginx"` (the alpine image is already non-root by default, but be explicit).
   - **postgres:** `read_only: true` + `tmpfs: /tmp` + `tmpfs: /var/run/postgresql` (postgres needs to write a socket file). Or skip read_only on postgres (data volume handles persistence; the image is a long-lived stateful service that needs `/etc/postgresql/postgresql.conf` writable for `pg_isready`-time tweaks). **Decision:** read-only off for postgres (it's a non-trivial change with risk of breaking pg_ctl / pg_isready); add cap_drop + no-new-privileges only.
   - **redis:** read_only + tmpfs `/tmp`.
   - **minio:** read_only off — minio rewrites `/root/.minio` config files at startup. cap_drop + no-new-privileges only.
   - **gotenberg:** read_only + tmpfs `/tmp` (Chromium scratch).
   - **ingestion:** no inbound port, but BullMQ worker may need `/tmp` for AI scratch.
3. Pin digests for every image. For the 4 we have locally cached (`redis:7-alpine`, `nginx:1.27-alpine`, `gotenberg:8`, `minio:RELEASE…`), pull the digest from `docker image inspect`. For our own images (built from Dockerfiles), keep tag-based since the build step embeds the version.
4. Run `docker compose -f docker-compose.prod.yml config` to validate.
5. Write the report.

## Acceptance criteria

- `docker compose -f docker-compose.prod.yml config` exits 0.
- Every service in compose has: `read_only` (or documented deviation), `security_opt: no-new-privileges:true`, `cap_drop: [ALL]`, `mem_limit`, `cpus`, `logging`, `healthcheck`.
- Every Dockerfile has `USER` directive set to a non-root UID.
- A digest-rotation script (`scripts/pin-image-digests.sh`) exists.

## Out of scope

- Actually rebuilding any image (deferred to deploy step).
- Migrating to rootless docker on the prod host (post-launch).
- Switching nginx to OpenResty / unprivileged variant (post-launch).
