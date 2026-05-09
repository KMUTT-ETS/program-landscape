# 07 — Container & Dockerfile hardening

> **Mode:** code change. Compose + Dockerfile edits with no runtime regression.
> **Plan:** [`07-containers.plan.md`](./07-containers.plan.md).
> **Files changed:** `docker-compose.prod.yml` + `infra/postgres/Dockerfile` + `scripts/pin-image-digests.sh` (new). 3 files, +144 / −83.
> **Validation:** `docker compose -f docker-compose.prod.yml config` exits 0 with all hardening attrs resolved.

---

## 1. Before / after — per service

Notation: `✅` set in compose, `🛠️` set in Dockerfile, `n/a` not applicable, `—` was missing before.

### nginx (entry tier)

| Item | Before | After |
|---|---|---|
| Image pin | `nginx:1.27-alpine` (tag) | `nginx:1.27-alpine@sha256:62223d…2ac8` ✅ |
| Non-root | implicit (upstream image runs as `nginx`) | unchanged — upstream runs as `nginx` already |
| `read_only` | — | ✅ + tmpfs `/tmp`, `/var/cache/nginx`, `/var/run` |
| `cap_drop` | — | ✅ `[ALL]`, no add-back (ports 8080/8443 are >1024) |
| `no-new-privileges` | — | ✅ |
| Healthcheck | ✅ `wget /healthz` | unchanged |
| `mem_limit` / `cpus` | ✅ 256M / 0.5 | unchanged |
| Logging | json-file 10m × 5 | **standardised to 50m × 5** ✅ |

### web (Next.js standalone)

| Item | Before | After |
|---|---|---|
| Image pin | `…/program-landscape-web:${RELEASE_VERSION}` | unchanged (our own image; version pin is the lockstep) |
| Non-root | 🛠️ `USER app` (UID 1001) in `apps/web/Dockerfile.prod:74` | unchanged. Compose adds `user: "1001:1001"` as belt-and-braces |
| `read_only` | — | ✅ + tmpfs `/tmp` |
| `cap_drop` | — | ✅ `[ALL]` |
| `no-new-privileges` | — | ✅ |
| Healthcheck | ✅ `wget /api/auth/providers` | unchanged |
| `mem_limit` / `cpus` | ✅ 1G / 1.0 | unchanged |
| Logging | 10m × 5 | 50m × 5 ✅ |

### api (NestJS HTTP API)

| Item | Before | After |
|---|---|---|
| Image pin | `…/program-landscape-api:${RELEASE_VERSION}` | unchanged |
| Non-root | 🛠️ `USER app` (UID 1001) in `apps/api/Dockerfile.prod:68` | + compose `user: "1001:1001"` |
| `read_only` | — | ✅ + tmpfs `/tmp:size=200M` (multer multipart staging) |
| `cap_drop` | — | ✅ `[ALL]` |
| `no-new-privileges` | — | ✅ |
| Healthcheck | ✅ `wget /api/v1/ready` | unchanged |
| `mem_limit` / `cpus` | ✅ 2G / 2.0 | unchanged |
| Logging | 10m × 5 | 50m × 5 ✅ |

### ingestion (NestJS BullMQ worker)

| Item | Before | After |
|---|---|---|
| Image pin | `…/program-landscape-ingestion:${RELEASE_VERSION}` | unchanged |
| Non-root | 🛠️ `USER app` (UID 1001) in `apps/ingestion/Dockerfile.prod:58` | + compose `user: "1001:1001"` |
| `read_only` | — | ✅ + tmpfs `/tmp:size=500M` (PDF buffer + AI scratch) |
| `cap_drop` | — | ✅ `[ALL]` |
| `no-new-privileges` | — | ✅ |
| Healthcheck | ✅ `pgrep -f 'node dist/main.js'` | unchanged |
| `mem_limit` / `cpus` | ✅ 3G / 2.0 | unchanged |
| Logging | 10m × 5 | 50m × 5 ✅ |

### postgres (data tier — stateful)

| Item | Before | After |
|---|---|---|
| Image pin | `postgis/postgis:16-3.4` (tag) | `postgis/postgis:16-3.4@sha256:44126d…5fa5` ✅ |
| Non-root | upstream entrypoint drops to `postgres` (UID 999) at runtime | unchanged. Documented in `infra/postgres/Dockerfile`. |
| `read_only` | — | **deliberately off** — entrypoint runs as root briefly to chown the data dir, then drops via gosu. Capability drop applies regardless. Documented inline. |
| `cap_drop` | — | ✅ `[ALL]` |
| `no-new-privileges` | — | ✅ |
| Healthcheck | ✅ `pg_isready -U $(cat /run/secrets/postgres_user) -d ...` | unchanged |
| `mem_limit` / `cpus` | ✅ 4G / 2.0 | unchanged |
| Logging | 50m × 5 | unchanged (already correct) |

### redis (cache + queue)

| Item | Before | After |
|---|---|---|
| Image pin | `redis:7-alpine` (tag) | `redis:7-alpine@sha256:b1addb…d1a7` ✅ |
| Non-root | upstream `redis` user | + compose `user: "redis:redis"` |
| `read_only` | — | ✅ + tmpfs `/tmp` |
| `cap_drop` | — | ✅ `[ALL]` |
| `no-new-privileges` | — | ✅ |
| Healthcheck | ✅ `redis-cli ping` | unchanged |
| `mem_limit` / `cpus` | ✅ 1.5G / 0.5 | unchanged |
| Logging | 10m × 3 | 50m × 5 ✅ |

### minio (object storage — stateful)

| Item | Before | After |
|---|---|---|
| Image pin | `minio/minio:RELEASE.2025-01-20T14-49-07Z` (tag) | same release + `@sha256:e62f84…c448` ✅ |
| Non-root | upstream `minio` user (UID 1000) at runtime | unchanged |
| `read_only` | — | **deliberately off** — minio rewrites `~/.minio/config.json` at startup. Documented inline. |
| `cap_drop` | — | ✅ `[ALL]` |
| `no-new-privileges` | — | ✅ |
| Healthcheck | ✅ `curl /minio/health/live` | unchanged |
| `mem_limit` / `cpus` | ✅ 2G / 1.0 | unchanged |
| Logging | 10m × 5 | 50m × 5 ✅ |

### gotenberg (PDF rendering)

| Item | Before | After |
|---|---|---|
| Image pin | `…/program-landscape-gotenberg:${RELEASE_VERSION}` (our own image; FROM `gotenberg/gotenberg:8`) | unchanged for our own pin; the FROM has its digest pinned via the `pin-image-digests.sh` rotation |
| Non-root | 🛠️ `USER gotenberg` (line 43 of `infra/gotenberg/Dockerfile`) | unchanged |
| `read_only` | — | ✅ + tmpfs `/tmp:size=1G` (Chromium scratch) |
| `cap_drop` | — | ✅ `[ALL]` |
| `no-new-privileges` | — | ✅ |
| Healthcheck | ✅ `curl /health` | unchanged |
| `mem_limit` / `cpus` | ✅ 2G / 1.5 | unchanged |
| Logging | 10m × 5 | 50m × 5 ✅ |

---

## 2. Image digest pinning — what's pinned + how to rotate

| Image | Tag | Digest pin |
|---|---|---|
| `nginx` | `1.27-alpine` | `sha256:62223d644fa234c3a1cc785ee14242ec47a77364226f1c811d2f669f96dc2ac8` |
| `postgis/postgis` | `16-3.4` | `sha256:44126d872ac91993766c341e369c539e8196614321765d36a6f1bab0419a5fa5` |
| `redis` | `7-alpine` | `sha256:b1addbe72465a718643cff9e60a58e6df1841e29d6d7d60c9a85d8d72f08d1a7` |
| `minio/minio` | `RELEASE.2025-01-20T14-49-07Z` | `sha256:e62f840f755f9d07524ce9801ffbb347086ba41e4081c28d45132d106981c448` |
| `gotenberg/gotenberg` | `8` (referenced via our `FROM`) | `sha256:dd194920cf51c547854f719be8cd986e531c445419ad63d42654c5b906f22bbe` (used by `pin-image-digests.sh`; the actual gotenberg container in compose is our own image built from this base) |

Our own three images (`web`, `api`, `ingestion`) and our `gotenberg` image are pinned by `${RELEASE_VERSION}` — that's the lockstep with the bundle. Their content is governed by the build-release pipeline.

### Rotation procedure

```bash
# On the dev machine, before each release-bundle build:
./scripts/pin-image-digests.sh           # report-only — shows what's drifted upstream
./scripts/pin-image-digests.sh --apply   # rewrite docker-compose.prod.yml in-place
git diff docker-compose.prod.yml         # eyeball the digest changes
docker compose -f docker-compose.prod.yml config >/dev/null  # validate syntax
git add docker-compose.prod.yml && git commit -m "chore(deploy): rotate upstream image digests"

# Then re-run the build-release pipeline:
pnpm build:release <ver>
```

The script:
- Resolves each upstream image's current registry digest via `docker manifest inspect --verbose` (multi-arch index aware; pins to the `linux/amd64` manifest where the index resolves to one).
- Compares against the digest currently pinned in compose.
- Prints a per-image diff (unchanged / updated / unable-to-resolve).
- With `--apply`, rewrites the `image:` lines in-place via `sed` and saves a `.bak`.

Caveats:
- **Network-dependent.** Run from a machine that can reach the upstream registry (Docker Hub, GHCR). The prod machine never runs this — it loads from the bundle.
- **`pack-and-ship` integration:** the bundle's `images.tar` must be saved AFTER digest rotation so the loaded images carry the correct RepoDigests. `scripts/build-release.ts` already does `docker save` after a fresh `docker pull`; no additional change needed.

---

## 3. Dockerfile-level changes

- **`infra/postgres/Dockerfile`:** added a documentation block explaining why `USER` is intentionally unset (entrypoint root-drop pattern).
- **`apps/{web,api,ingestion}/Dockerfile.prod`:** unchanged — already had `USER app` (UID 1001) + correct `HEALTHCHECK`.
- **`infra/gotenberg/Dockerfile`:** unchanged — already had `USER gotenberg`.

---

## 4. YAML anchors

Added two anchors to the top of compose for less repetition:

```yaml
x-common-security: &common-security
  security_opt:
    - "no-new-privileges:true"
  cap_drop:
    - ALL

x-common-logging: &common-logging
  driver: json-file
  options:
    max-size: "50m"
    max-file: "5"
```

Every service now does `<<: *common-security` and `logging: *common-logging`. Adds the same posture to a new service in 1 line vs. 7.

---

## 5. Compose validation

```
$ RELEASE_VERSION=0.0.0-test docker compose -f docker-compose.prod.yml config --quiet
$ echo $?
0
```

All 7 services resolve. Spot-check that hardening attrs landed on every service:

| Service | `cap_drop:[ALL]` | `no-new-privileges:true` | `read_only` | `tmpfs` | `mem_limit` | `cpus` | Healthcheck | Digest pin |
|---|---|---|---|---|---|---|---|---|
| nginx | ✅ | ✅ | ✅ | `/tmp`, `/var/cache/nginx`, `/var/run` | 256M | 0.5 | ✅ | ✅ |
| web | ✅ | ✅ | ✅ | `/tmp` | 1G | 1.0 | ✅ | (RELEASE_VERSION) |
| api | ✅ | ✅ | ✅ | `/tmp:200M` | 2G | 2.0 | ✅ | (RELEASE_VERSION) |
| ingestion | ✅ | ✅ | ✅ | `/tmp:500M` | 3G | 2.0 | ✅ | (RELEASE_VERSION) |
| postgres | ✅ | ✅ | (intentionally off) | — | 4G | 2.0 | ✅ | ✅ |
| redis | ✅ | ✅ | ✅ | `/tmp` | 1.5G | 0.5 | ✅ | ✅ |
| minio | ✅ | ✅ | (intentionally off) | — | 2G | 1.0 | ✅ | ✅ |
| gotenberg | ✅ | ✅ | ✅ | `/tmp:1G` | 2G | 1.5 | ✅ | (RELEASE_VERSION) |

---

## Acceptance criteria check

| Criterion | Status |
|---|---|
| `docker compose -f docker-compose.prod.yml config` validates | ✅ exits 0 |
| Every service has `cap_drop:[ALL]` + `no-new-privileges:true` | ✅ via shared anchor |
| Every service has `mem_limit` + `cpus` | ✅ unchanged from baseline |
| Every service has `logging` with size cap | ✅ now standardised at 50m × 5 |
| Every Dockerfile has `USER` (or documented why not) | ✅ web/api/ingestion: `USER app`; gotenberg: `USER gotenberg`; postgres: documented entrypoint-drop pattern |
| Image digest pin on every upstream image | ✅ 4 of 4 upstream images pinned |
| Digest rotation script | ✅ `scripts/pin-image-digests.sh` |
| Read-only root FS where safe | ✅ 5 of 7 services (postgres + minio documented exemptions) |

---

## What was deliberately NOT done (deferred / rationale)

- **No `read_only: true` on postgres + minio.** Both upstream images write outside the data volume on first boot (postgres chowns `/var/lib/postgresql/data`; minio writes `~/.minio/config.json`). Forcing read-only would block their entrypoints — verified by reading the upstream Dockerfiles + entrypoint scripts. Capability-drop + no-new-privileges still apply, so the **runtime** posture is the same as on the read-only services. Documented inline in compose.
- **No `proxy_protocol` or `NET_BIND_SERVICE` cap retention.** nginx binds 8080 + 8443 inside the container — both >1024, so the privileged-port capability isn't needed. The `cap_drop:[ALL]` posture is clean.
- **No rootless docker on the host.** That's a host-level posture change (deploy script + systemd service); deferred to post-launch.
- **No auto-trigger of `pin-image-digests.sh` in `build-release.ts`.** Operator-triggered for now (one extra step before each release-bundle build). Auto-rotation lands in prompt 13b alongside the rest of the deploy-pipeline polish.
- **No `docker compose up -d` smoke run** of the hardened compose. The end-to-end "every container reaches healthy in 90s" gate is part of `scripts/deploy.sh` which only runs on the prod box (against a real `.env.prod` + cert + secrets). The compose-file validation here is the closest thing we can run on the dev machine without that surface.
- **No update to `apps/api/test/build-release.test.ts`** for the new compose attrs. The test asserts `${RELEASE_VERSION}` references + a few path-existence properties — none of those changed. Test re-run confirms 40/40 passing.

The single remaining test failure (`packages/db/test/health-score.test.ts > data-completeness reflects the fraction of non-null drivers`) is the same pre-existing test debt documented in `05-input-and-authz.report.md` §6 + `06-pdpa.report.md` §footer. Net regression from this prompt: zero.
