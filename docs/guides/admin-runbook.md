# Admin Runbook

For KKU IT operations running Program Landscape on the on-prem Ubuntu server at `/opt/program-landscape/`. Production URL: `https://program-landscape.kku.ac.th`.

This runbook is a flowchart, not tutorial. Search for the symptom, follow the action.

---

## Architecture 1-pager

```
[KKU central reverse proxy] ── TLS →  [our nginx]  ── HTTP →  [web :3000]  (Next.js)
                                              │                └──────→  [api :4000]  (NestJS)
                                              │
                                              │  (api talks to:)
                                              │    postgres :5432   [data + audit]
                                              │    redis :6379      [BullMQ queues]
                                              │    minio :9000      [PDFs + backups]
                                              │    gotenberg :3001  [PDF generation]
                                              │
                                              └──→  [ingestion]  (NestJS, no HTTP) — consumes BullMQ, writes to postgres/minio
```

All traffic arrives on `:8443` with a **self-signed cert** — the KKU central proxy is pinned to our cert's SHA-256 fingerprint or runs `proxy_ssl_verify off`. The public-visible TLS is terminated upstream at `program-landscape.kku.ac.th`.

---

## Deploy a release

1. On a dev workstation: `git checkout <tag>` and `pnpm build:bundle` (packaging scripts in 13b).
2. SCP the bundle tarball to `/opt/program-landscape/releases/<tag>.tar.gz`.
3. SSH to the prod server:
   ```bash
   cd /opt/program-landscape
   ./scripts/deploy.sh <tag>
   ```
4. The deploy script:
   - Takes a Postgres snapshot (`pnpm db:backup`) → MinIO `db-backups/pre-deploy/`.
   - Stops web + api + ingestion containers.
   - Replaces the `current/` symlink with `releases/<tag>/`.
   - `docker load` the new images from the bundle.
   - `pnpm db:migrate:safe` — snapshot + `prisma migrate deploy`.
   - Starts containers in order: postgres → redis → minio → gotenberg → api → ingestion → web → nginx.
   - Probes `GET /api/v1/ready` on localhost. Rolls back (symlink flip back) if it stays 503 for 60s.

Total deploy time target: **< 10 minutes** for a zero-schema-change deploy, **< 20 minutes** when migrations run.

---

## Daily checks (auto + manual)

| Check | Automated | Manual verify |
|---|---|---|
| Daily Postgres backup | systemd-timer at 02:00 | Before Council week, open `/admin/system-status` and confirm `ingestion` + `recentDecisions` look sane |
| WAL continuity | Postgres config `archive_command` ships to MinIO `db-backups/wal/` | Weekly: list bucket, verify no gaps > 1 hour |
| MinIO mirror to KKU archive | `rclone` cron nightly at 03:30 | Monthly: hash-compare a sample |
| Disk usage on `/var/lib/postgresql` | alertmanager > 80% | Monthly: `du -sh /var/lib/*` |
| Certificate expiry (KKU proxy) | KKU IT manages | Annually: cross-check our self-signed cert SHA-256 pin |

---

## Symptom → action

### Users report "site won't load"

1. `curl -I https://program-landscape.kku.ac.th` — does it resolve?
   - DNS fail → KKU central DNS
   - SSL/TLS error → KKU central proxy
2. Inside our server: `curl -k https://localhost:8443` — does our nginx respond?
3. `docker ps` — are all containers UP?
4. `curl http://localhost:4000/api/v1/ready` — dependency health check.
5. Check `docker compose logs --tail=200 web api ingestion`.

### Users report "login loop"

1. Check `NEXTAUTH_URL` env is exactly `https://program-landscape.kku.ac.th` (no trailing slash).
2. Check `AUTH_TRUST_HOST=true`.
3. Check the session cookie name — prod uses `__Secure-authjs.session-token`. If users see `authjs.session-token` (non-secure), then `useSecureCookies` didn't kick in (usually because NODE_ENV isn't `production` in the container env).
4. KKU SSO endpoint reachable? `curl $KKU_SSO_ISSUER/.well-known/openid-configuration`.

### "PDF generation fails"

1. `/api/v1/ready` — is `gotenberg` ok?
2. `docker exec -it gotenberg fc-list | grep -ci sarabun` — must return ≥ 4 (the four TH Sarabun weights). If 0, check the four font files are present in `infra/gotenberg/fonts/` (they are committed) and re-run `docker compose build gotenberg`.
3. Check `PdfGeneration` table for the most recent row's `errorDetail`.

### "AI call failures"

1. `/admin/system-status` → AI 24h strip. If `calls=0` and it's been > 10 min, there's a provider issue.
2. `docker logs api | grep ai/fallback` — is the transient-fallback firing repeatedly? That means the primary is flaky.
3. Verify keys: `echo $GOOGLE_AI_API_KEY | wc -c` (expect ~40 chars). Never log the actual key.
4. Check the provider's status page — Google AI Studio or Anthropic status.

### "Migration would not apply"

1. First: `pnpm db:backup` (if the deploy script didn't already).
2. Read the migration SQL: `packages/db/prisma/migrations/<folder>/migration.sql`. Is it forward-only?
3. Apply manually: `pnpm --filter @kku/db exec prisma migrate deploy` — capture the error.
4. If it's a conflicting unique constraint, **do not `prisma migrate resolve --rolled-back`** — that marks it as never-applied, which diverges from reality. Instead: draft a compensating migration that handles the pre-existing data.

### "Ingestion queue is backed up"

1. `docker logs ingestion --tail=500 | grep -E "job|failed"`.
2. Redis: `docker exec -it redis redis-cli KEYS "bull:*" | head`. If thousands of keys: there's a stuck worker.
3. Restart the ingestion container: `docker compose restart ingestion`. Jobs will resume from the queue; nothing is lost unless you `FLUSHALL` Redis (which you shouldn't).

---

## Secret rotation

Quarterly. Procedure:

1. Generate new secret (`openssl rand -hex 64` for NEXTAUTH_SECRET; provider console for API keys).
2. Add both OLD and NEW to `.env.prod` as `*_OLD` and `*` respectively (the app supports dual-key for session tokens).
3. Deploy. Watch `/api/v1/ready` stays 200.
4. Wait 24 hours so old sessions roll over.
5. Drop `*_OLD` from `.env.prod`. Redeploy.

API keys (Google, Anthropic) don't need dual-key — the LLM call will just use the newest. Rotate in one deploy cycle.

---

## On-call escalation

| Severity | Response |
|---|---|
| **P1** — site down, Council meeting in < 24h | Page KKU IT on-call + AI project lead |
| **P2** — AI failing, ingestion stuck | Open a ticket, address within 4 business hours |
| **P3** — stale data, minor UI glitch | Next business day |

All incidents that affect a Council-facing recommendation (`/admin/ai-eval` regression, bad extraction that touched a decision) require a short post-mortem in `docs/incidents/YYYYMMDD-<name>.md`.

---

## Quick reference

```bash
# Health check
curl http://localhost:4000/api/v1/ready | jq

# Enter api container
docker exec -it api sh

# Tail api logs
docker compose logs -f --tail=100 api

# Reset dev DB (DEV ONLY — blocked in prod)
NODE_ENV=development pnpm db:reset

# Run AI eval
pnpm ai:eval

# Fix mojibake filenames (POST to internal API)
curl -X POST http://localhost:4000/api/v1/pdfs/fix-filenames \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{"dryRun": false, "limit": 5000}'

# Force re-extraction across all CURRICULUM PDFs
curl -X POST http://localhost:4000/api/v1/pdfs/bulk-reprocess \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{"sourceCategory": "CURRICULUM", "limit": 500}'
```
