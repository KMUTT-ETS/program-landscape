# Production Infrastructure Summary

> Single-page reference for what the production machine needs to host
> Program Landscape end-to-end. Use this to spec the server, brief the
> network team, and prepare credentials/secrets before the first deploy.
>
> **For step-by-step deploy commands, see [`DEPLOYMENT.md`](../DEPLOYMENT.md).**
> **For KKU-network handshake details, see [`docs/deployment/kku-network-integration.md`](./deployment/kku-network-integration.md).**

---

## Production deployment specifics

| What | Value |
|---|---|
| Public URL | `https://program-landscape.kku.ac.th/` |
| Server IP (KKU internal network) | `10.101.118.80` |
| Listening port | `8443` (HTTPS, self-signed) |
| Public TLS termination | KKU university reverse proxy (managed by KKU IT) |
| Self-signed cert on our nginx | required (KKU proxy re-encrypts to us) |
| Outbound DB / API egress | unrestricted within KKU internal network |

## Hosting model at a glance

```
                    public internet
                          │
                          │  TLS (KKU-issued public cert for
                          │   program-landscape.kku.ac.th)
                          ▼
              ┌──────────────────────────┐
              │  KKU university reverse  │
              │  proxy (existing)        │
              └──────────────────────────┘
                          │  TLS re-encrypted
                          │  proxy_ssl_verify off  (or SHA-256 pin)
                          ▼
              ┌──────────────────────────┐
              │  Our Ubuntu server       │
              │  10.101.118.80 :8443     │
              │  (single VM / bare-metal)│
              └──────────────────────────┘
                          │
                          ▼
              ┌──────────────────────────────────────────────┐
              │  internal nginx (TLS, self-signed 10y cert)  │
              │   ├── /              → web:3000  (Next.js)   │
              │   ├── /api/auth/*    → web:3000  (NextAuth)  │
              │   └── /api/v1/*      → api:4000  (NestJS)    │
              ├──────────────────────────────────────────────┤
              │  postgres:5432  (16 + postgis + pgvector)    │
              │  redis:6379                                   │
              │  minio:9000     (S3-compatible object store) │
              │  gotenberg:3000 (PDF rendering, headless     │
              │                  Chromium with TH Sarabun    │
              │                  New embedded)               │
              │  ingestion       (BullMQ workers, no port)   │
              └──────────────────────────────────────────────┘
```

**Single-host, all-Docker.** Every service is a container managed by
`docker compose`. The host runs nothing application-specific outside
Docker except `nginx -t` style sanity tools. Bundle is built off-site
on the dev machine and shipped as a single tarball.

---

## Hardware spec

| Resource | Minimum | Recommended | Why |
|---|---|---|---|
| **CPU** | 4 cores | **8 cores** | Gotenberg launches headless Chromium per PDF render; ingestion workers + AI calls run concurrently. |
| **RAM** | 16 GB | **32 GB** | Postgres shared buffers (4 GB) + MinIO cache + Chromium peaks (Council Pack rendering 4–8 PDFs at once) + Node heap × 3 services. |
| **Disk** | 500 GB SSD | **1 TB NVMe SSD** | Postgres + MinIO + 90 days of pre-deploy DB snapshots + 30 days of nightly backups + Docker image layers + 297-program PDF archive (~5 GB) + research mirror snapshots. SSD is non-negotiable for Postgres index access patterns. |
| **OS** | Ubuntu 22.04 LTS | Ubuntu 24.04 LTS | Both supported; 24.04 has newer Docker Engine packaged. x86_64 only. |
| **GPU** | none | none | All ML/AI runs via vendor APIs (Gemini, Claude). No on-prem inference. |

**Backup target (off-server):** another KKU storage location reachable via
`rclone` or `aws s3 sync`. Plan ~50 GB of monthly archives kept for 1 year.

---

## Software stack

### Container images (4 of ours + 4 from upstream)

Built and shipped as `images.tar` inside the release bundle. Loaded on
the host with `docker load` — the prod box never pulls from a registry
at deploy time.

| Image | Source | Purpose |
|---|---|---|
| `program-landscape-web:<ver>` | `apps/web/Dockerfile` | Next.js 14 App Router. Standalone build. Serves `/` + `/api/auth/*`. |
| `program-landscape-api:<ver>` | `apps/api/Dockerfile` | NestJS API. Serves `/api/v1/*` + WebSocket. |
| `program-landscape-ingestion:<ver>` | `apps/ingestion/Dockerfile` | NestJS standalone. BullMQ worker — connectors, PDF intake, AI jobs. |
| `program-landscape-postgres:<ver>` | `infra/postgres/Dockerfile` | `postgis/postgis:16-3.4` + `postgresql-16-pgvector` + init SQL for extensions + Thai locale. |
| `nginx:alpine` | upstream | TLS termination + path routing. |
| `redis:7-alpine` | upstream | BullMQ queue + cache. |
| `cgr.dev/chainguard/minio:latest` | upstream | Object storage for PDFs, generated outputs, avatars. Chainguard rebuild (upstream `minio/minio` is EOL); runs as non-root UID 65532 — see deploy.sh volume chown. |
| `gotenberg/gotenberg:8` | upstream | Headless Chromium PDF renderer with TH Sarabun New embedded (font dropped in at build time). |

**All images are `linux/amd64`.** Dev builds on Apple Silicon must use
`docker buildx --platform linux/amd64`.

### Runtime versions

- **Node.js**: 20 LTS (in every Node container).
- **PostgreSQL**: 16 with `postgis 3.4`, `pgvector`, `pg_trgm`, `btree_gin`, `uuid-ossp`. Extensions declared in Prisma schema (`previewFeatures = ["postgresqlExtensions"]`).
- **Redis**: 7.x.
- **Prisma**: 5.22 (client + migrate).
- **Docker Engine**: ≥ 24, Compose v2 (`docker compose`, hyphen-free).

### Application stack (recap)

- **Frontend**: Next.js 14 App Router, TypeScript strict, Tailwind, shadcn/ui, Recharts + visx, deck.gl, Framer Motion, cmdk. Sarabun primary font (loaded locally from `apps/web/public/fonts/sarabun/`).
- **Backend**: NestJS with TypeScript.
- **ORM**: Prisma 5.22.
- **Cache/queue**: Redis + BullMQ (`ingestion`, `pdf-intake`, `ai-jobs`, `trend-monitors` queues).
- **PDF generation**: All routes through `PdfGenerationService` → Gotenberg. Never in-process.
- **Object storage**: MinIO (S3-compatible). Buckets:
  - `pdf-raw` — original PDFs from the intake pipeline
  - `pdf-output` — generated Council Packs / briefs / scenario packs
  - `avatars` — user-uploaded profile photos (auto-created by app on first upload)
  - `db-backups` (optional) — pre-deploy DB snapshots before destructive migrations
- **Auth**: `next-auth` v5, KKU SSO via SSONext (custom protocol — not standard OIDC). Local credentials only in dev.
- **i18n**: `next-intl` for static analysis-content strings.
- **Monorepo**: pnpm workspaces.

---

## Network requirements

### Inbound (from KKU campus network) — host `10.101.118.80`

| Port | Protocol | From | Purpose |
|---|---|---|---|
| `8443` | HTTPS (self-signed) | KKU upstream proxy only | Application traffic |
| `8080` | HTTP (optional) | KKU upstream proxy only | Auto-redirect to 8443 |
| `22` | SSH | KKU bastion / admin VLAN only | Operator access |

**Public internet**: no direct exposure. The KKU upstream reverse proxy
is the only ingress.

### Outbound (from prod server)

| Destination | Protocol | Why | Optionality |
|---|---|---|---|
| `generativelanguage.googleapis.com` | HTTPS | Gemini API (default `AI_PROVIDER`) | Required if Gemini is the primary |
| `api.anthropic.com` | HTTPS | Claude API (Analyst module + fallback) | Required for the Analyst page |
| `api.openalex.org` | HTTPS | Co-author resolution fallback for the profile page | Optional — falls back gracefully |
| `api.elsevier.com` | HTTPS | Scopus author + abstract retrieval (profile page only) | Optional but high-value — without it the profile page falls back to kkuscholar (slow) |
| `10.130.2.151:5432` | Postgres | kkuscholar institutional research mirror — used by all bulk modules + profile fallback | Required for cockpit / gap / benchmarking |
| `10.101.104.192:1433` | TDS | KKU HCM (HR), MS SQL Server | Required for kku-hr ingestion |
| `10.101.106.44:3310` | MySQL | UNICON DS2001 / DS2003 / DS2004 (staff) | Required for staff data |
| `10.130.2.156:3306` | MySQL | reg_unicon (registry) | Required for registry data |
| Oracle warehouse (`KKU_REGISTRY_DB_*`) | Oracle TNS | KKU Registry data warehouse | Required for kku-registry |
| `skill.kmitl.ac.th/api/v1` | HTTPS | KMITL Skill Mapping API | Required for gap analyzer demand side |
| `fonts.gstatic.com` | HTTPS | Google Fonts (Inter, Sarabun, JetBrains Mono) at build/dev time | Build-time only — fonts are bundled into the image |

**Firewall posture**: outbound HTTPS to whitelisted hosts only. Egress
through KKU's internal network proxy if required (set `HTTPS_PROXY`
in `.env.prod`).

### DNS

| Hostname | Resolves to | Notes |
|---|---|---|
| `program-landscape.kku.ac.th` | KKU upstream proxy | The public URL users hit. |
| (our server) | `10.101.118.80` | Reachable from KKU internal network only — KKU proxy → us at `:8443`. |
| `10.130.2.151` | kkuscholar | Hardcoded IP — KKU Library asset. |
| `10.101.104.192` | KKU HCM (HR) MS SQL | Hardcoded IP — KKU HR-IT moves it occasionally; verify before deploys. |

---

## TLS

- **Public cert** (for `program-landscape.kku.ac.th`) terminates at the
  KKU upstream proxy. **We do not handle the public cert.**
- **Self-signed cert** (10-year lifetime, RSA 4096) on our internal nginx
  for the upstream-to-us hop. Generated by
  `scripts/generate-self-signed-cert.sh`. Fingerprint shared with the
  KKU network team for SHA-256 pinning (or they configure
  `proxy_ssl_verify off` if pinning is not desirable).
- **End-to-end encrypted** — there's no plaintext hop on KKU's network.

---

## Persistence

All state lives under `/opt/program-landscape/` on the host:

```
/opt/program-landscape/
├── current               → releases/<ver>/   (atomic-swap symlink)
├── releases/             (last 5 releases retained)
├── secrets/              (mode 0600, root-owned)
│   ├── postgres_user
│   ├── postgres_password
│   ├── minio_user
│   └── minio_password
├── certs/                (self-signed cert + key)
├── .env.prod             (mode 0600, root-owned)
├── volumes/              (Docker named-volume mounts)
│   ├── postgres-data/
│   ├── redis-data/
│   ├── minio-data/
│   └── gotenberg-cache/
└── backups/              (nightly + pre-deploy + monthly)
```

Backup retention: 30 days dailies, 90 days pre-deploy, 365 days monthly.
Off-server mirror via `rclone` / `aws s3 sync` nightly at 03:30
Asia/Bangkok.

---

## Required `.env.prod` keys

The complete list ships in `.env.prod.example` inside every release
bundle. Sensitive subset:

### Auth + framework

| Key | Value |
|---|---|
| `NEXTAUTH_URL` | `https://program-landscape.kku.ac.th` (public URL, not `:8443`) |
| `AUTH_TRUST_HOST` | `true` (TLS terminates upstream) |
| `NEXTAUTH_SECRET` | `openssl rand -hex 64` |
| `KKU_SSO_WEB_BASE` | **Production SSONext WEB host** (KKU IT issues; differs from UAT-Stage `https://sso-uat-web.kku.ac.th`). Likely `https://sso.kku.ac.th`. |
| `KKU_SSO_API_BASE` | **Production SSONext API host** (likely `https://api-sso.kku.ac.th`). |
| `KKU_SSO_APP_ID` / `KKU_SSO_CLIENT_ID` / `KKU_SSO_CLIENT_SECRET` | KKU IT issues a separate set per environment. |
| `KKU_SSO_REDIRECT_URI` | `https://program-landscape.kku.ac.th/api/auth/callback/kku-sso` (must be byte-exact match to what KKU IT registers). |
| `KKU_SSO_LOGOUT_REDIRECT_URI` | `https://program-landscape.kku.ac.th/signin?signout=1` |
| `ENABLE_LOCAL_AUTH` | **`false`** — startup guard aborts in prod otherwise |

> See `docs/auth/kku-sso.md` for the full SSONext wire protocol + claim mapping.
> The dev UAT-Stage uses different host bases — both env vars are environment-driven so the same code path serves dev / staging / prod.

### Database + queue

| Key | Value |
|---|---|
| `DATABASE_URL` | `postgresql://<user>:<pw>@postgres:5432/program_landscape?schema=public` (credentials match secrets files) |
| `REDIS_URL` | `redis://redis:6379` |
| `MINIO_ENDPOINT` | `http://minio:9000` |
| `MINIO_PUBLIC_ENDPOINT` | `https://program-landscape.kku.ac.th/minio` (or empty if signed-URL signing isn't used) |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` | Match secrets files |
| `MINIO_BUCKET_PDF_RAW` | `pdf-raw` |
| `MINIO_BUCKET_PDF_OUTPUT` | `pdf-output` |
| `MINIO_BUCKET_AVATARS` | `avatars` (auto-created on first upload) |
| `GOTENBERG_URL` | `http://gotenberg:3000` |

### AI providers

| Key | Value |
|---|---|
| `AI_PROVIDER` | `google` (preferred) or `anthropic`. Set both keys so transient-fallback works. |
| `GOOGLE_AI_API_KEY` | Gemini key |
| `ANTHROPIC_API_KEY` | Claude key — required by the Analyst module (tool-use is Anthropic-only) |
| `KKU_INTELSPHERE_URL` / `KKU_INTELSPHERE_API_KEY` | Optional KKU-internal proxy for AI calls |
| `AI_QUOTA_VIEWER_USD` … `AI_QUOTA_ADMIN_USD` | Per-role daily caps (see prompt 13 hardening) |

### KKU data sources

| Key | Value |
|---|---|
| `KKU_REGISTRY_DB_*` | Oracle TNS for the KKU registrar warehouse |
| `KKU_HR_DB_*` | MS SQL for HCM (`10.101.104.192:1433`) |
| `KKU_PUBLICATIONS_DB_*` | Postgres for kkuscholar (`10.130.2.151:5432`, kkuscholar/kkuscholar) |
| `KKU_RESEARCH_YEAR_FROM` | `1997` (window cutoff for the mirror) |
| `UNICON_DS2001_DB_*` / `UNICON_DS2003_DB_*` / `UNICON_DS2004_DB_*` | MySQL for the staff datasets |
| `KMITL_CLIENT_ID` / `KMITL_SECRET_KEY` | KMITL Skill Mapping (institutional partner) |

### Profile-page fallbacks (NEW)

| Key | Value |
|---|---|
| `KKU_SCOPUS_API_KEY` | Elsevier institutional API key — primary publication source for the profile page (`/profile`). Without it, the page falls back to kkuscholar (slow). |
| `OPENALEX_MAILTO` | Email address — enables OpenAlex's polite pool (10 req/s instead of 1). E.g. `denpong@kku.ac.th`. |

Both are profile-page-only; bulk modules (cockpit, gap-analyzer,
benchmarking) read from kkuscholar to stay under Scopus's 20k-req/week
rate limit.

### Connector mode flags

| Key | Value |
|---|---|
| `CONNECTOR_MODE` | `real` in prod (per-source overrides via `CONNECTOR_<SLUG>_MODE`). Stays `mocked` in dev/staging until each source has 30 days of green-history. |

### Dev-only (ignored in prod)

| Key | Value |
|---|---|
| `NEXT_DEV_ALLOWED_ORIGINS` | Comma-separated IPs — silences the cross-origin warning when devs hit the LAN dev server from another host. Production ignores it. |
| `ENABLE_LOCAL_AUTH` | `false` in prod (must). `true` only in dev. |

---

## Operational essentials

### Migrations

- **Forward-only.** Every migration must be a strict prefix of all later
  versions. See `docs/migration-policy.md`.
- Run from a disposable container during deploy:
  ```
  docker compose run --rm --entrypoint "" api \
    node node_modules/.bin/prisma migrate deploy
  ```
- `deploy.sh` automates this — operators don't run prisma manually.
- Pre-deploy DB snapshot is taken automatically by `pre-deploy-snapshot.mjs`.

### Backups

- **Nightly** at 02:00 Asia/Bangkok via systemd timer
  (`program-landscape-backup.timer`).
- Output: `pg_dump` (custom format) + tar of MinIO data.
- Pre-deploy snapshots automatic.
- Off-server mirror at 03:30 to KKU central archive.

### Monitoring (today / planned)

- **Today**: `/api/v1/ready` endpoint probes Postgres / Redis / MinIO /
  Gotenberg / AI provider. Returns 503 with per-dep verdict on failure.
  Used by nginx for traffic gating.
- **Today**: pino structured JSON logs on api + ingestion, with
  request-id propagation. Tail via `docker compose logs -f`.
- **Today**: `/admin/system-status` page for Council/Exec readers.
- **Today**: `/admin/data-quality` + `/admin/ai-cost` admin dashboards.
- **Planned**: Prometheus + Grafana + OpenTelemetry (prompt 14 / post-launch).

### Incident response

- **App unreachable** → check `docker compose ps`. Usually nginx cert
  mount or MinIO healthcheck.
- **Migration failure** → `./scripts/rollback.sh` with DB restore.
- **AI provider down** → automatic transient-fallback to secondary
  (already wired). Visible in `docker logs api | grep ai/fallback`.
- **Disk pressure** → MinIO + backup retention; prune via
  `docker image prune -a` or rotate manually.

Full runbook: `docs/guides/admin-runbook.md`.

---

## Data flows worth knowing

### KKU SSO sign-in

```
user → /signin → KKU SSONext (custom protocol, NOT OIDC)
     → /api/auth/callback/kku-sso
     → provisioning: User row + UserScope rows + employeeId
     → land on / (dashboard)
```

### Profile page (added 2026-05-09 — Scopus-direct path)

```
GET /profile (server component)
  → getProfileData(userId)
    ├── prisma.user + prisma.facultyMember (employeeId bridge)
    ├── prisma.staffEducationHistory (DS2003 by citizenIdHash)
    ├── prisma.programFaculty (curriculum)
    ├── prisma.researchOutput (legacy local cache)
    └── publications cache lookup OR live pipeline:
         ├── Scopus AU-ID search (1.5s, full author lists)
         ├── kkuscholar fallback (only when Scopus returns 0)
         ├── DOI bridge (OpenAlex → Scopus by DOI)
         └── Metadata search (OpenAlex → Scopus by title + surname)
  → render hero + sections
  → user_publications_cache stores final result for 24h
```

Cold load: ~5s. Warm load (cache hit): ~10ms.

### Bulk research metrics (cockpit, gap, benchmarking)

```
ingestion worker (cron 0 4 * * *):
  KkuResearchRealConnector → kkuscholar mirror
  → ResearchOutput rows in our Postgres
  → MV refresh (mv_program_metrics, mv_faculty_metrics, …)
  → modules read MVs via queryMetricByScope()
```

These DO NOT call Scopus / OpenAlex live — they read kkuscholar
in batch and our Postgres at request time. Profile page is the only
exception.

### PDF generation

```
client clicks "Export Council Pack"
  → POST /api/v1/cockpit/export
  → PdfService.generateAndPersist(template, data)
    → PdfGenerationService renders React → HTML
    → POST to gotenberg:3000/forms/chromium/convert/html
    → MinIO putObject
    → return signed URL (15-min TTL)
```

PDFs are NEVER generated in-process (no puppeteer / react-pdf /
html-pdf). All paths go through Gotenberg with TH Sarabun New
embedded.

---

## What's NOT on the prod box

- **No Docker Hub access at runtime.** All images shipped in the bundle.
- **No `npm install` at deploy.** Standalone Next build + Prisma client
  pre-generated.
- **No interactive terminals into prod containers** for app-level
  troubleshooting — use `docker compose logs` + admin dashboards.
- **No public web access** — all ingress goes through the KKU upstream
  proxy.
- **No payment / billing PII** — KKU pays AI vendors centrally; per-user
  cost is governance, not billing. Citizen IDs (Thai national ID) are
  hashed at every boundary; raw never persists.
- **No GPU / on-prem model inference** — all AI vendor APIs.

---

## Pre-procurement checklist

For the network/IT team to fulfil before the server arrives:

- [x] Server provisioned at `10.101.118.80` on the KKU internal network (Ubuntu 22.04/24.04 LTS x86_64, 8 cores / 32 GB / 1 TB SSD)
- [x] Public URL agreed: `https://program-landscape.kku.ac.th/`
- [x] TLS terminated by KKU university reverse proxy (handled by KKU IT) — re-encrypts to our `:8443`
- [ ] Hostname registered in KKU DNS (e.g. `program-landscape-app.kku.ac.th` for ops SSH)
- [ ] KKU upstream proxy configured to forward `program-landscape.kku.ac.th` → `https://10.101.118.80:8443`
- [ ] Self-signed cert fingerprint exchanged with KKU network team (pinning) OR they confirm `proxy_ssl_verify off` is acceptable
- [ ] Firewall: inbound `:8443` from KKU proxy only; SSH `:22` from KKU bastion/admin VLAN only
- [ ] Outbound HTTPS allowed to: `generativelanguage.googleapis.com`, `api.anthropic.com`, `api.openalex.org`, `api.elsevier.com`, `skill.kmitl.ac.th`, `fonts.gstatic.com`
- [ ] Outbound to internal DBs allowed: `10.130.2.151:5432`, `10.101.104.192:1433`, `10.101.106.44:3310`, `10.130.2.156:3306`, KKU Oracle warehouse
- [ ] Off-server backup target reachable (rclone-able S3 or KKU central archive mount)
- [ ] Operator SSH keys ready for the `deploy` user
- [ ] **KKU SSO production credentials** issued by KKU IT and the prod redirect URI registered:
  - [ ] `KKU_SSO_WEB_BASE` (production SSONext WEB host)
  - [ ] `KKU_SSO_API_BASE` (production SSONext API host)
  - [ ] `KKU_SSO_APP_ID` + `KKU_SSO_CLIENT_ID` + `KKU_SSO_CLIENT_SECRET` for production
  - [ ] Redirect URI registered at IdP: `https://program-landscape.kku.ac.th/api/auth/callback/kku-sso`
- [ ] All third-party API credentials in hand:
  - [ ] Google Generative Language API key
  - [ ] Anthropic API key
  - [ ] Scopus API key (Elsevier — KKU Library subscription)
  - [ ] KMITL Skill Mapping client ID + secret
  - [ ] kkuscholar Postgres credentials (KKU Library)
  - [ ] KKU HR / Registry / UNICON DB read-only credentials

After these are ready, follow `DEPLOYMENT.md` for the deploy itself.

---

## Useful refs

- **[`DEPLOYMENT.md`](../DEPLOYMENT.md)** — pack-and-ship deploy runbook
- **[`docs/architecture.md`](./architecture.md)** — internal architecture, monorepo, MV strategy
- **[`docs/deployment/kku-network-integration.md`](./deployment/kku-network-integration.md)** — KKU proxy + cert pinning details
- **[`docs/data-sources.md`](./data-sources.md)** — every external data source documented
- **[`docs/auth/kku-sso.md`](./auth/kku-sso.md)** — SSONext custom protocol
- **[`docs/security-review.md`](./security-review.md)** — endpoint authz audit, dep CVEs
- **[`docs/migration-policy.md`](./migration-policy.md)** — forward-only schema rules
- **[`docs/backup-dr.md`](./backup-dr.md)** — backup classes, retention, restore drill
- **[`docs/pdpa.md`](./pdpa.md)** — PDPA posture, citizen-ID hashing, DSAR workflow
- **[`docs/readiness-checklist.md`](./readiness-checklist.md)** — 12-gate Council-readiness audit
