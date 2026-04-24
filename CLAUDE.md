# CLAUDE.md

> This file is read by Claude Code at the start of every session. It is the source of truth for how this project is built. Keep it current.

## Project: KKU Curriculum Landscape

A strategic decision-support web application for Khon Kaen University Council and top management. Analyzes 297 academic programs against future trends, financial sustainability, and labor market demand. Internal codename: *Curriculum Compass* / *ทักษทัศน์*.

**Audience:** University Council, top management, deans, department heads, analysts. **High-stakes decisions** affecting program closures, mergers, launches, faculty livelihoods. Trust and defensibility matter more than feature count.

## The eight strategic questions this app must answer

1. Which programs are strategically critical to KKU's mission and Thailand's future?
2. Which programs are financially unsustainable at current trajectory?
3. Which programs are misaligned with future skill demand (1, 5, 10 years out)?
4. Which programs duplicate each other across faculties and could be consolidated?
5. Where are the white spaces — programs we should launch but haven't?
6. Which programs are at quality/relevance risk (aging faculty, outdated curriculum, weak research base)?
7. What is the demographic ceiling on each program given Thailand's declining youth cohort?
8. How does each program compare to peer institutions (Thai, ASEAN, global)?

## The eight modules

1. **Portfolio Overview Cockpit** — health heatmap, BCG matrix, rollup tree
2. **Program Deep-Dive** — per-program shareable scorecard
3. **Future Trends Radar** — AI-curated external signal feed
4. **Demand-Supply Gap Analyzer** — labor market vs KKU production
5. **Strategic Scenario Planner** — what-if simulation
6. **Competitive Benchmarking** — peer comparison and white-space detection
7. **AI Analyst** — conversational interface
8. **Decision Workspace** — captures decisions, tracks follow-through

## Multi-level analytical scope (mandatory across the system)

Every analytical view, metric, chart, and AI insight supports four scopes:
- **University** (KKU as a whole)
- **Faculty** (e.g., Faculty of Engineering)
- **Department** (e.g., Department of Computer Engineering)
- **Program** (single curriculum)

Implementation rules:
- Scope state lives in URL: `?scope=faculty&scopeId=<id>` (shareable)
- All analytical API endpoints accept `scope` and `scopeId` parameters
- All aggregations roll up cleanly: program → department → faculty → university
- Single shared `<ScopeSelector>` component, built once, reused everywhere
- AI Analyst tools take `scope` arguments and respect them

## Language strategy

- **UI labels** (menus, buttons, headers, form fields, errors): **English only**
- **Analysis content** (AI narratives, briefs, summaries, recommendations): **Thai primary** with on-demand English translation toggle
- **Data labels** (program/faculty/course names): both `nameTh` and `nameEn` stored, both displayed where space allows
- Charts: axis labels in English, data labels in Thai
- All Council Pack PDFs default to Thai with optional English appendix

## Theme strategy

- Light + dark mode required from day one
- All colors via CSS variables, never hardcoded hex
- Token system in `packages/design`, both modes verified WCAG AA
- Per-user preference persisted in DB; system preference as default
- No flash of wrong theme on load (use `next-themes` SSR-safe approach)

## SaaS UX principles

Visual benchmark: **Linear, Vercel Dashboard, Stripe Dashboard, Retool, Notion, Height**.

- Command palette (Cmd/Ctrl+K) for navigation and search
- Keyboard shortcuts everywhere; `?` shows the sheet
- Density-tunable layouts (compact/comfortable/spacious)
- URL-shareable state (filters, scope, view config)
- Skeletons not spinners
- Optimistic UI for mutations
- Side panels (Linear-style) over full-page navigation where appropriate
- Subtle Framer Motion (≤200ms)
- Toasts for confirmations, never modals where a toast suffices
- Bulk actions on tables, saved views

## Stack

- **Frontend:** Next.js 14 (App Router), TypeScript strict, Tailwind, shadcn/ui, Recharts + visx, deck.gl, Framer Motion, cmdk
- **Backend:** NestJS with TypeScript
- **Database:** PostgreSQL 16 with `postgis`, `pgvector`, `pg_trgm`
- **ORM:** Prisma
- **Cache/queue:** Redis + BullMQ
- **PDF generation:** Gotenberg (Docker) with TH Sarabun New embedded — all PDFs route through `PdfGenerationService`, never in-process libraries
- **Object storage:** MinIO (S3-compatible) for original PDFs and generated outputs
- **Auth:** `next-auth` v5 (KKU SSO via OIDC; local credentials only in dev)
- **i18n:** `next-intl` for static analysis-content strings
- **Monorepo:** pnpm workspaces — `apps/web`, `apps/api`, `apps/ingestion`, `packages/shared`, `packages/db`, `packages/ui`, `packages/design`, `packages/pdf-templates`
- **Containerization:** docker-compose (postgres, redis, web, api, ingestion, minio)
- **Testing:** Vitest, Playwright, testcontainers for PostgreSQL

## Coding conventions

- TypeScript strict mode; **no `any`**
- Zod for all I/O validation (request, response, ingestion, AI extraction)
- Server components by default; client components only when needed for interactivity
- Conventional commits (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, `test:`)
- ESLint enforces no hardcoded color values (use design tokens)
- Prettier on save
- Run `pnpm check` before committing (lint + typecheck + test)

## Council-readiness rules (NON-NEGOTIABLE)

These apply to every module, every endpoint, every UI surface. **No exceptions.**

1. **Provenance on every chart** — `<ProvenanceButton>` opens drawer with sources, freshness, calculation method, methodology version, caveats
2. **Confidence + sources on every AI output** — `<ConfidenceBadge>` shown, sources clickable, "show reasoning" expandable, "disagree" feedback button
3. **Freshness timestamp on every data point** — `<FreshnessBadge>` showing "Updated Xh ago" with exact timestamp on hover
4. **Audit logging on every mutation** — via `@AuditLog()` decorator, written to `AuditLog` table
5. **AI inference logging on every AI call** — via `@AiCall()` decorator, written to `AiInference` table
6. **Methodology versioning** — every metric carries `methodologyVersion`; methodology docs in `docs/methodologies/` are versioned in git

## Skills used in this project

Always invoke the relevant Claude skill at the start of each session. See `prompts/SKILLS.md` for the full mapping.

| Session type | Skill to invoke |
|---|---|
| UI work (any module) | `frontend-design` |
| Theme/design system | `frontend-design` + `theme-factory` |
| PDF intake/extraction | `pdf-reading` |
| PDF generation (Council Pack, briefs) | `pdf` |
| Word/Excel/PowerPoint exports | `docx`, `xlsx`, `pptx` |

## Folder conventions

```
apps/
  web/         # Next.js — frontend
  api/         # NestJS — main API
  ingestion/   # NestJS standalone — workers + connectors

packages/
  shared/      # Shared types, Zod schemas, AI service, RBAC, decorators
  db/          # Prisma schema, migrations, scope-aware query helpers
  ui/          # shadcn-extended component library + Storybook
  design/      # Design tokens (light + dark), Tailwind config

docs/
  architecture.md
  data-sources.md
  pdf-ingestion.md
  ai-governance.md
  glossary-th-en.md
  design-system.md
  auth/kku-sso.md
  methodologies/
    health-score.md
    cost-allocation.md
    forecasting.md
    ...

prompts/       # Claude Code prompts (this is the build manual)
```

## What NOT to do

- ❌ Do NOT hardcode colors, fonts, spacing — use design tokens only
- ❌ Do NOT use `any` in TypeScript
- ❌ Do NOT call AI services without the `@AiCall()` decorator
- ❌ Do NOT mutate data without the `@AuditLog()` decorator
- ❌ Do NOT bypass `<ScopeSelector>` and hardcode scope in components
- ❌ Do NOT skip provenance UI on charts (required for Council use)
- ❌ Do NOT use localStorage for anything that should persist (use DB)
- ❌ Do NOT enable local-credentials auth in production
- ❌ Do NOT translate Thai content to English by default (translate on demand only)
- ❌ Do NOT mock data in production code paths (mocks live in test fixtures and seed scripts)
- ❌ Do NOT use raw SQL except via Prisma's `$queryRaw` with Zod-validated results
- ❌ Do NOT add a "TH/EN UI toggle" — the UI is English-only by design
- ❌ Do NOT introduce new charting libraries — extend `<Chart>` instead
- ❌ Do NOT generate PDFs in-process (no puppeteer, no react-pdf, no html-pdf) — all PDFs route through `PdfGenerationService` → Gotenberg
- ❌ Do NOT use any font other than TH Sarabun New for Thai PDF body text — it is the Cabinet-mandated standard for official documents
- ❌ Do NOT create a Makefile — primary dev is Windows. Use `pnpm` scripts.
- ❌ Do NOT use `rm -rf` in scripts — use the `rimraf` package (cross-platform)
- ❌ Do NOT string-concatenate paths with `/` — use Node's `path.join()`
- ❌ Do NOT hardcode POSIX shell commands in scripts that run outside Docker — use Node-based tooling

## Run, test, lint

All commands via pnpm (cross-platform — Windows, WSL2, macOS, Linux). **No Makefile** — this project's primary dev machine is Windows.

```bash
pnpm setup       # install deps, set up local infra
pnpm dev         # run web + api + ingestion in parallel
pnpm db:up       # start postgres + redis + minio + gotenberg
pnpm db:reset    # drop + migrate + seed (dev only)
pnpm db:seed     # seed without dropping
pnpm db:migrate  # apply pending migrations
pnpm test        # unit + integration
pnpm e2e         # playwright
pnpm lint        # eslint
pnpm typecheck   # tsc --noEmit
pnpm check       # lint + typecheck + test (run before committing)
pnpm storybook   # ui package storybook
```

## Platform

- **Developer machine:** Windows via WSL2 (Ubuntu 24.04). All tooling must be cross-platform.
- **Production machine:** on-prem Ubuntu server on KKU's internal network running Docker + Docker Compose v2.
- **Production URL:** `https://program-landscape.kku.ac.th`
- **GitHub repo:** `https://github.com/khon-kaen-university/program-landscape`
- **Container images:** `ghcr.io/khon-kaen-university/program-landscape-<service>:<version>`
- **Install path on prod server:** `/opt/program-landscape/`
- **End-to-end TLS model:**
  - KKU's university reverse proxy terminates the public cert
  - Re-encrypts and forwards to our server over HTTPS on `:8443` with a **self-signed cert**
  - Our internal nginx handles TLS + path routing; both web and api run HTTP inside the docker network
  - KKU proxy configured with `proxy_ssl_verify off` (or SHA-256 cert pinning)
- **Deployment model:** pack-and-ship. Build all Docker images on dev machine (inside WSL2), package into a single tarball, transfer to prod server, deploy with one script. The prod server does NOT pull from Docker Hub — images are loaded from the bundle via `docker load`.
- **All production images are `linux/amd64`.** If a dev machine is ever ARM (M1/M2/M3 Mac), builds must use `--platform linux/amd64`.

App-level config for the upstream-TLS setup:
- NextAuth: `NEXTAUTH_URL=https://program-landscape.kku.ac.th`, `AUTH_TRUST_HOST=true`
- NestJS: `app.set('trust proxy', 1)` to respect `X-Forwarded-For` for audit logs
- Security headers set at app layer (not nginx) so they're correct regardless of proxy path

Dev conventions:
- Use `pnpm` scripts, not Make
- Use Node's `path.join()` for filesystem paths
- Use `rimraf` package, never `rm -rf` in scripts
- `.gitattributes` forces LF line endings
- Prisma `binaryTargets` includes `["native", "linux-musl-openssl-3.0.x", "windows"]`
- Claude Code runs inside WSL2

See `prompts/WINDOWS-DEV.md` for Windows dev setup. See prompt 13b (and `DEPLOYMENT.md` once built) for production deployment.

## Reference docs (read when relevant)

- `prompts/GLOBAL-UPDATES.md` — cross-cutting requirements
- `prompts/SKILLS.md` — which Claude skills to invoke per session
- `docs/architecture.md` — overall architecture
- `docs/design-system.md` — visual direction and token reference
- `docs/data-sources.md` — every external data source documented
- `docs/pdf-ingestion.md` — PDF intake pipeline
- `docs/pdf-generation.md` — PDF output pipeline (Gotenberg, templates, Thai gotchas)
- `docs/ai-governance.md` — AI usage policies, prompt versioning, bias monitoring
- `docs/auth/kku-sso.md` — KKU SSO configuration
- `docs/methodologies/` — per-metric methodology with versions

## Current status

> **Update this section after every major session.** This is how Claude Code knows where the project stands when you return.

- [x] Prompt 00: Bootstrap  *(completed 2026-04-22)*
- [x] Prompt 01: Data model  *(completed 2026-04-22)*
- [x] Prompt 02: Auth & API core  *(completed 2026-04-22)*
- [x] Prompt 02b: Design system  *(completed 2026-04-22; Storybook deferred)*
- [x] Prompt 02c: PDF generation (Gotenberg + TH Sarabun New)  *(completed 2026-04-23; fonts must be dropped in locally, see `infra/gotenberg/README.md`)*
- [x] Prompt 03: Ingestion framework  *(completed 2026-04-23; 23 connectors all MOCKED — real wiring in prompt 14)*
- [x] Prompt 03b: PDF intake  *(completed 2026-04-23; plumbing complete, LLM classifier + 7 extractors stubbed — real LLM in prompt 04)*
- [x] Prompt 04: Skills & AI  *(completed 2026-04-23; AiService + Google/Anthropic providers real; taxonomy seed; BullMQ ai-jobs; /skills + /admin/extraction-review UIs)*
- [x] Prompt 05: Cockpit  *(completed 2026-04-23; health-score.v1 methodology with explicit null handling; Heatmap + BubbleMatrix + Rollup views; AI brief + Council Pack export)*
- [x] Prompt 06: Deep-Dive  *(completed 2026-04-23; /programs/[id] with 10 sections, Radar + Funnel + Waterfall viz, role-gated faculty, disagreement capture, print + PDF export)*
- [x] Prompt 07: Trends Radar  *(completed 2026-04-23; 29 seeded signals, 6 monitor cron jobs scaffolded, TrendsRadar polar viz, Notification + SignalSubscription + Inbox)*
- [x] Prompt 08: Gap Analyzer  *(completed 2026-04-23; forecasting.v1 methodology with Holt's + demographic-adjusted linear; 8 sectors seeded; GapBars + schematic ThailandMap viz; 8 endpoints; gap-report PDF template)*
- [x] Prompt 09: Scenario Planner  *(completed 2026-04-23; scenario-engine.v1 deterministic pure-function engine with seeded Monte Carlo + tornado sensitivity; 5 intervention types; 4 seeded templates; workflow DRAFT→SHARED→COUNCIL_REVIEWED→DECIDED; 11 endpoints; scenario pack PDF wired)*
- [x] Prompt 10: Benchmarking  *(completed 2026-04-23; benchmarking.v1 with 3 seeded peer sets + 12 peer programs + 27 ranking rows; portfolio/subjects/program-level comparison; white-space detection; distinctiveness scoring; CoverageMatrix viz; 7 endpoints; 4 AI insight modes)*
- [x] Prompt 11: AI Analyst  *(completed 2026-04-23; tool-use agent via AiService.completeWithTools() on Anthropic; 12 Zod-typed tools wrapping prompts 05-10 helpers; 7 pre-built Council briefs; rule-based safety guardrails with 19 refusal-pattern tests; AnalystConversation + AnalystMessage + AnalystFeedback persistence; 3-pane UI with evidence side-rail; bilingual Thai/English)*
- [x] Prompt 12: Decision Workspace  *(completed 2026-04-23; extended CouncilDecision with snapshot+version+title; added DecisionMilestone + DecisionApprover + DecisionOutcomeReview + Annotation.visibility; 12 REST endpoints with role-gated status transitions; 3 new Council Pack PDF templates; 3 seeded sample decisions + 1 outcome review; outcome-review.v1 AI prompt; 19 status-transition tests)*
- [x] Prompt 13: Hardening  *(completed 2026-04-24; security headers + CSP + HSTS + secure cookies; @nestjs/throttler named buckets + per-user daily AI USD cap via AiQuotaGuard; DataExportGuard + @RequireExportReason decorator scaffolded; docs/security-review.md + npm-audit snapshot; pino structured logging on api + ingestion; /api/v1/ready dep-health probe; /admin/system-status + /admin/data-quality + /admin/ai-cost pages; model fallback on AiService (primary → secondary on transient errors); sanitizeAiOutput scrubber for Thai IDs/phones/non-KKU emails; 25 gold-question AI eval suite w/ pnpm ai:eval; 4 user guides + methodology compendium + PDPA posture + DSAR workflow + rollout plan; /changelog page; CacheService for Redis-backed aggregation caching; db-index review doc; pre-deploy-snapshot script + db:migrate:safe; .github/workflows/pr.yml + release.yml; Next 14.2.20 → 14.2.32, multer 1.4 → 2.0.1 — critical + high-severity vuln remediations)*
- [x] Prompt 13b: Deployment — pack-and-ship  *(completed 2026-04-24; multi-stage prod Dockerfiles for web/api/ingestion; docker-compose.prod.yml with healthchecks + resource limits + docker-compose v2 secrets; internal nginx on :8443 with self-signed TLS + /api/auth vs /api/v1 split; scripts/generate-self-signed-cert.sh; scripts/build-release.ts + `pnpm build:release <ver>` produces a single .tar.gz + SHA256 containing images.tar + compose + nginx + scripts + env template; scripts/{deploy,rollback,backup,restore,smoke-test}.sh on the prod server; DEPLOYMENT.md + docs/deployment/kku-network-integration.md; systemd timer for nightly backups; LICENSE + SECURITY.md + CODEOWNERS + PR template + 3 issue templates; enhanced release.yml uploads to GitHub release on tag; 6-case build-release integrity test)*
- [ ] Prompt 14: Real data integration

**Recent decisions worth knowing about:**

*Prompt 13b (2026-04-24):*
- **Three Dockerfiles, not one.** Separate prod Dockerfiles for web / api / ingestion instead of a mega-image. Each is 3-stage (deps / build / runner), uses node:20-alpine + tini, runs as a non-root `app` user, and bakes in `linux-musl-openssl-3.0.x` Prisma engines. Web uses Next's `output: 'standalone'` so the runner image stays ~150 MB.
- **`outputFileTracingRoot` set to the monorepo root** on the web app — without it, Next's standalone tracer walks up past the repo boundary and emits a corrupt manifest when built inside WSL2 / Docker.
- **`docker compose v2` only.** The compose file is `docker-compose.prod.yml` (hyphen in filename, but invoked via `docker compose -f`). Dev + prod compose share naming conventions; the prod file adds healthchecks, resource limits, `deploy.resources` blocks, named volumes for persistent data, and a dedicated `kku-internal` bridge network.
- **Compose `secrets:` read from files, not env.** Postgres + MinIO credentials live under `/opt/program-landscape/secrets/` (one value per file, mode 0600). The app's DATABASE_URL in `.env.prod` still embeds the password — documented as a 14 pain point to unify via a startup entrypoint that reads the secret files.
- **Nginx handles the `/api/auth/*` ↔ `/api/*` split explicitly.** next-auth lives at `/api/auth/*` in the web app; our NestJS prefix is `/api/v1`. Without an explicit `location /api/auth/` → web rule, next-auth calls would 404 against the NestJS router. Tested via build-release.test.ts regex.
- **Self-signed TLS with a 10-year lifetime.** `scripts/generate-self-signed-cert.sh` generates a 4096-bit RSA cert at `/opt/program-landscape/certs/`, valid until 2036. Rotation is a calendar reminder, not a cron job. KKU proxy either `proxy_ssl_verify off`'s or pins the SHA-256 fingerprint we hand over at deploy time.
- **`proxy_ssl_verify off` for v1, fingerprint-pinning planned for Phase 3.** We default to the simpler posture so the KKU network team has zero config dependency on us at go-live. Tightening happens when we have stable ops rhythm.
- **`set_real_ip_from` placeholders left in `nginx.conf`.** The file ships with RFC-1918 CIDRs as a placeholder; swapping in the real KKU proxy CIDR is a one-line change at first-deploy-time, documented in `docs/deployment/kku-network-integration.md`.
- **Pack-and-ship bundle is one `.tar.gz` + one `.sha256`.** No separate artefacts for compose, nginx, or env — everything travels in the tarball. The prod server doesn't need any registry access; `docker load < images.tar` is the only way new images arrive.
- **`scripts/build-release.ts` runs on the dev machine.** `pnpm build:release <ver>` builds all 4 images via `docker buildx --platform linux/amd64`, saves them with `docker save`, copies the deploy artefacts into `dist/releases/program-landscape-<ver>/`, tars + sha256sums the result. Bundle size is 1.5–2.5 GB (dominated by the images).
- **`deploy.sh` is idempotent.** If the same bundle version is re-deployed, it refreshes in-place rather than erroring. Atomic symlink swap (`/opt/program-landscape/current → releases/<ver>`) is the "point of no return"; anything before it is rolled back automatically on failure.
- **Migrations run in a disposable api container** — `docker compose run --rm --entrypoint "" api node node_modules/.bin/prisma migrate deploy`. We DON'T migrate from the long-lived api container because that races with ingestion on startup. A fresh container with only the migration task gives us a clean lifecycle.
- **Rollback is code-only by default.** `rollback.sh` asks whether to restore the pre-deploy DB snapshot; the usual answer is "no" because our migrations are forward-only and the code rollback is schema-compatible. DB restore is the escape hatch for a data-destructive migration (which shouldn't happen given `docs/migration-policy.md`).
- **Backup is systemd-timed, not cron.** `program-landscape-backup.service` + `.timer` unit files are shipped in the bundle under `infra/systemd/`. Nightly at 02:00 Asia/Bangkok. `backup.sh` pg_dumps + mirrors MinIO + applies retention (30 days dailies, 90 days pre-deploys, 365 days monthlies).
- **`.env.prod.example` is the source of truth for prod env keys** — 40+ keys documented with comments. The live `.env.prod` at `/opt/program-landscape/.env.prod` is mode 0600 root-owned and symlinked into each release dir by `deploy.sh`.
- **Repo hygiene: LICENSE + SECURITY.md + CODEOWNERS + 3 issue templates + PR template added.** LICENSE is an internal-use terms-of-use (not OSS) — KKU legal can swap to MIT/Apache if Council agrees. CODEOWNERS is placeholder teams; replace with real GitHub handles before go-live.
- **Release workflow uploads the `.tar.gz` to GitHub Releases on tag push.** `workflow_dispatch` runs it as a manual-build artefact too — operators can grab the bundle from the Actions UI instead of creating a release.
- **Test that validates the bundle** — `apps/api/test/build-release.test.ts`: 6 cases verifying every copy-pair source exists, every Dockerfile exists, compose tags are pinned to `${RELEASE_VERSION}`, nginx split is correct, all scripts are executable. Runs as part of `pnpm test`.

*Prompt 13 (2026-04-24):*
- **Named throttler buckets, not global burst.** `ThrottlerModule.forRoot` defines `default` / `ai_short` / `ai_hourly` / `heavy` so per-endpoint overrides pick a bucket rather than reinventing burst + hourly windows. Controllers do `@Throttle({ ai_short: { limit: 20, ttl: 60_000 }, ai_hourly: { limit: 200, ttl: 60 * 60 * 1000 } })`.
- **AI quotas are $-based, not call-based.** `AiQuotaGuard` reads cumulative `costEstimateUsd` from `AiInference` over the last 24h and refuses at cap. Caps: $1/day for VIEWER/COUNCIL/DEAN/DEPT_HEAD, $3 EXECUTIVE, $10 ANALYST/ADMIN. Overridable via `AI_QUOTA_*_USD` env. Fail-open on DB error — quotas are governance, not security.
- **CSRF is posture, not middleware.** Same-origin + `SameSite=Lax` session cookie + next-auth's CSRF token cookie suffice while the API is only reachable through the Next.js proxy. Explicit CSRF middleware on NestJS mutations is deferred to 13b if we ever expose a public M2M key.
- **Data-export audit infrastructure wired, applied to zero routes.** `@RequireExportReason()` decorator + `DataExportGuard` live in `apps/api/src/common/`. Applying to live export routes (`pdf/generate`, `cockpit/export`) would break the current UI without a reason dialog; scheduled for 13b UI polish.
- **Model fallback is transient-only.** `wrapWithTransientFallback` in `ai/providers/factory.ts` catches 429/5xx/timeouts only. Deterministic failures (validation, refusals, non-429 4xx) re-throw. Visible in audit via the `model` field on `AiInference` — grep for rows whose model differs from the configured primary.
- **Output sanitisation is a scrubber, not a refuser.** `sanitizeAiOutput()` in `@kku/shared/analyst/safety.ts` redacts Thai/English personal info (citizen IDs, phone numbers, non-KKU emails) from model responses with a visible `[REDACTED: CATEGORY]` marker. Conservative by default; reviewer can see what was scrubbed and feed back.
- **25 gold questions, not 50 (yet).** AI eval suite at `packages/shared/src/ai/eval/gold-questions.jsonl` starts with 25 — 8 safety cases (deterministic, gate-only), 17 module-specific (skipped without a live endpoint). Runner at `scripts/ai-eval.mjs`, exposed via `pnpm ai:eval`. Expand to 50 before Phase 2 of rollout.
- **Pino replaces Nest's default logger.** `nestjs-pino` on both api + ingestion, JSON in prod, pretty in dev. Request-id is propagated via `X-Request-Id` — KKU's upstream reverse proxy can inject its own; we fall back to a local generator. Redacts `authorization`, `cookie`, `exportReason` from request logs.
- **Health vs ready distinction.** `GET /healthz` stays dumb (process alive). New `GET /ready` probes Postgres/Redis/MinIO/Gotenberg/AI-provider and returns 503 with a per-dep verdict on any failure — used by nginx to gate traffic.
- **`/admin/system-status` is exec-readable, `/admin/ai-cost` is ADMIN-only.** System-status gives Council + Executive a pre-meeting snapshot without exposing per-user spend detail. AI-cost is gated tighter because user spend is sensitive under PDPA.
- **`/admin/data-quality` uses raw SQL for the anomaly scan.** ~1500 rows (297 programs × 5 years) makes a Postgres LAG window query cheap and O(n) enough not to need a Prisma `groupBy`. Migrate to a materialized view if program count grows > 1000.
- **CacheService is fail-open.** `common/cache.service.ts` is a Redis-backed JSON wrapper. On any Redis error, `get()` returns undefined → caller falls through to compute. No cache = slower, not broken.
- **Migration safety is a pre-deploy pg_dump, not a "migrate down".** `scripts/pre-deploy-snapshot.mjs` writes to MinIO `db-backups/pre-deploy/<ts>-<sha>.dump`. `pnpm db:migrate:safe` chains this → `prisma migrate deploy`. Rollback is always forward-compensating, never `prisma migrate resolve --rolled-back`.
- **Security review is a living doc.** `docs/security-review.md` captures the audit at a point in time; next update is triggered by (a) a new endpoint, (b) a new external dep, or (c) quarterly rotation. Remaining Next.js-line CVEs accepted until the 15.x major migration.
- **CI runs PR checks, release workflow is a gate.** `.github/workflows/pr.yml` runs lint + typecheck + test + AI eval on every PR + push to main. `release.yml` runs on tag push — builds every app to validate, then prints release metadata; the actual pack-and-ship tarball is generated manually on the dev machine and uploaded by ops (prompt 13b formalises this). Prod deploys are manual by design.
- **Deferred to 13b:** Per-template export-reason enforcement with a UI dialog, full Next.js 15 upgrade, actual Dockerfiles + `docker-compose.prod.yml`, pack-and-ship scripts, nginx config, Prometheus/Grafana, OpenTelemetry, nightly AI-eval cron, nightly outcome-review cron, first-run wizard (DB-backed per-user dismissal), contextual `?` help icons.

*Prompt 12 (2026-04-23):*
- **Reused what already existed.** `CouncilDecision`, `Annotation`, scenario → decision link all pre-dated prompt 12 (01, 05-06, 09). Prompt 12's job was to compose them into a workspace + add the missing tracking + outcome-review loop; avoided the temptation to rebuild. New tables are only 3: `DecisionMilestone`, `DecisionApprover`, `DecisionOutcomeReview`.
- **Status enum expanded in place rather than rewritten.** Added `COUNCIL_REVIEWED`, `IN_IMPLEMENTATION`, `COMPLETED`, `ARCHIVED` to the existing `DecisionStatus`. Migration uses `ALTER TYPE ADD VALUE IF NOT EXISTS` per value so re-apply is safe. The old values (`IMPLEMENTED`) stay for backwards compat; the graph lets them co-exist with the new ones.
- **Status transition graph lives in code**, not the DB. `ALLOWED_TRANSITIONS` + `assertTransitionAllowed()` in `@kku/db/decisions.ts` are the contract. Role gating (`TRANSITION_ROLE_GATE`) is a separate map: COUNCIL_REVIEWED requires EXECUTIVE/ADMIN; APPROVED/REJECTED require COUNCIL/EXECUTIVE/ADMIN; ARCHIVED is ADMIN-only. Everything else is ungated (owners can self-move their PROPOSED → rejection, etc.).
- **Snapshot is immutable once captured.** `captureSnapshot()` is called automatically when status transitions to COUNCIL_REVIEWED. Idempotent: once `snapshotJson` exists, returns the existing snapshot rather than overwriting. This is what makes the outcomes review meaningful — Council is comparing actual-vs-projected, not actual-vs-recomputed-now.
- **Snapshot payload is deliberately aggregate, not per-program detail.** Stores healthScores rollup + top 10 risks + top 10 skill gaps + recent trend count. A fuller per-program snapshot would balloon the DB and overlap with existing audit paths. When a reviewer needs per-program detail, they can look up the program at its version-at-time-of-decision via git / `pdf_documents` / `ai_inferences`.
- **Outcome-review horizons (6mo / 1yr / 3yr) fire independently**, via `dueOutcomeReviewHorizons()` + manual POST today. A nightly cron lands in prompt 13 — the pure function is reusable from that scheduler without any schema change. Each horizon writes exactly one `DecisionOutcomeReview` row; re-running upserts.
- **Outcome review AI uses plain `AiService.complete()`, not tool-use.** Reviews are narrative + structured JSON, not tool-driven reasoning. One `AiInference` row per review. Graceful no-key fallback persists a placeholder narrative so the workspace renders the "review pending" state cleanly.
- **Amendment creates a new decision row, never mutates.** `amend()` writes a new CouncilDecision (version + 1), links `supersededById` on the original, and flips the original's status to `SUPERSEDED`. Institutional memory — the original + its snapshot + milestones stay intact, audit trail unbroken.
- **Annotation visibility (PRIVATE / TEAM / COUNCIL) is new** but the `Annotation` table kept its shape. `listAnnotations()` applies visibility at read time: PRIVATE → author only; TEAM → everyone; COUNCIL → COUNCIL/EXECUTIVE/ADMIN. Uses `OR` filter on the Prisma where clause — not a materialized view — so privileged reads don't leak private notes.
- **3 new Council Pack templates**: `quarterly-review`, `annual-strategic-review`, `faculty-level-review`. They stand alongside the existing `council-pack` + `decision-record` templates. All 5 render through the same Gotenberg PdfService (no new infra). docx/pptx exports are deferred — PDF is the non-negotiable Council format per CLAUDE.md.
- **Decision UI has 5 tabs** (Overview / Milestones / Approvers / Outcomes / Discussion). The Discussion tab is a skeleton today — annotation API is live, the threaded inline-render is next pass. Overview tab carries the role-aware workflow CTAs: an EXECUTIVE sees "Mark Council-reviewed"; a COUNCIL sees "Approve / Reject" once the decision is already reviewed.
- **11 new REST endpoints**: list/create/get/patch + status + amend + milestones (create/patch) + approvers + outcome-review + lessons-learned + annotations (list+create). All scope-aware at the service layer; all mutations audit-logged via `@AuditLog`.
- **3 seeded sample decisions** at different statuses (IN_IMPLEMENTATION, COMPLETED, APPROVED), 2-3 milestones each, 2-3 approvers each, 1 pre-filled OutcomeReview on the COMPLETED one. Council sees the workspace populated on first boot.
- **Migration `20260423110000_decision_workspace`** — additive. 3 new tables, 3 new enums, 9 columns added to `council_decisions`, 1 column added to `annotations`. No data destruction; legacy `DecisionStatus` values retained.
- **19 new tests** covering status graph transitions + role gating + outcome-review horizon math. Pure functions, no Prisma — status transition rules never regress silently.
- **Deferred with clear flags:** nightly outcome-review scheduler (prompt 13); E-signature integration with KKU e-sign (post-launch); docx/pptx exports (Gotenberg is HTML→PDF; a separate pipeline for Office formats is prompt 14); email notifications on approval (in-app Notification works today; email via SMTP in prompt 13); threaded Discussion tab with inline evidence attachment (next pass).

*Prompt 11 (2026-04-23):*
- **Tool-use is Anthropic-only in v1.** Extended `AiService` with an optional `completeWithTools()` method, implemented on `AnthropicAiService` using the native `tool_use` API. `GoogleAiService` + the stubs throw `ToolUseNotSupportedError` — documented in the method comment. Operator action: `AI_PROVIDER=anthropic` is the Analyst module's required setting. Analyst service falls back to a friendly placeholder if `ANTHROPIC_API_KEY` is unset, rather than 500-ing.
- **The tool loop is orchestrated inside the provider**, not in the Analyst service. `completeWithTools()` loops call → execute → feed-result until the model stops requesting tools or iteration cap (default 8, hard cap 16). The caller passes an `executeTool(call) => Promise<string>` function. Keeps the provider layer responsible for protocol correctness; the Analyst service only owns business-level concerns (persistence, safety gate, evidence payload).
- **One `AiInference` row per LLM invocation.** Every iteration of the tool loop writes one row with `sourcesJson.toolCalls` capturing the tool_use blocks the model requested. `AnalystMessage.aiInferenceIds` is the array that stitches them together for audit. A Council question that involves 4 tool calls = 4+ inference rows + 1 message row.
- **12 Zod-typed tools wrap prompts 05-10 compute helpers, they don't duplicate them.** `query_programs`, `get_program`, `query_skills`, `query_trends`, `query_gaps`, `compare_peers`, `run_quick_scenario`, `generate_chart`, `cite_source`, `search_policy_docs`, `search_research`, `get_methodology`. The executor (in `apps/api/src/analyst/tool-executor.service.ts`) maps tool names to `@kku/db` helpers — the bot's answers are grounded in the same numbers Council sees in the modules.
- **`run_quick_scenario` is intentionally restricted.** One intervention, capped to 30 programs, Monte Carlo N=50. Full scenario planning stays in `/scenarios`; the analyst tool is for "what if we sunset X" sanity checks only. The system prompt directs the user to `/scenarios` for anything deeper.
- **Tool results are clipped to 8 KB per call.** Large result sets (297 programs × 5 years × ...) would blow the Claude context in 2 iterations. The `clip()` helper in the executor truncates arrays and leaves a `{truncated: N items elided}` marker so the LLM knows it's seeing a sample.
- **System prompt lives in `@kku/shared/analyst/tools.ts` under `ANALYST_SYSTEM_PROMPT`.** Versioned (`analyst-system.v1`). Bilingual handling is encoded via "mirror the user's language" rather than a sticky conversation setting — a user can switch Thai ↔ English mid-conversation and the assistant follows. Not a design goal to force all-Thai output; just matching user intent.
- **Safety guardrails are rule-based in `@kku/shared/analyst/safety.ts`.** Regex patterns for 5 categories: personal-info, salary-or-performance, prompt-injection, external-content-request, decision-commitment. Matches in both English and Thai. 19 test cases cover the obvious patterns. A real ML classifier is out of scope for v1; the system prompt handles the nuance the regex misses. The safety gate runs BEFORE the LLM — a refused question never reaches Anthropic, so the audit trail is "refused by rule", not a Claude output.
- **`checkAnalystSafety()` returns the triggered categories + an explanation; the service emits a language-appropriate refusal.** The system prompt also re-states the safety rules so the LLM catches edge cases (e.g. obscure prompt-injection phrasing that regex misses).
- **`detectLanguage()` heuristic: ≥30% Thai characters → Thai.** Simple + wrong sometimes; but since the system prompt also says "mirror the user's language", the assistant self-corrects. The detection is mostly used to format the refusal message, where a full LLM call is wasteful.
- **Conversation window is sliding 10 turns** — older turns are truncated when sent to the LLM. Full audit remains in DB. Summarisation of pruned turns (for long-running conversations) is deferred.
- **Tool traces are stored in `AnalystMessage.toolCallsJson` + a pre-computed `evidenceJson` payload.** The evidence panel renders from `evidenceJson` (which includes tool names, inputs, clipped results, iteration count, stop reason) — separate from the raw trace so future UI changes don't require re-deriving the same summary. Each `aiInferenceIds` entry links to `/admin/ai-logs/:id` (route to be built in prompt 13 hardening).
- **7 pre-built briefs seeded as templates**: state-of-the-portfolio, programs-at-risk, top-strategic-opportunities, faculty-scorecard (requires scope arg), demographic-stress, northeast-strategic-alignment, sector-deep-dive. Each brief is a Thai prompt shipped to the same chat endpoint; the controller annotates the response with the target PDF template (council-pack / scenario-pack) so the UI can wire the "Export PDF" button.
- **Streaming (SSE) is scaffolded but deferred.** v1 responses are single JSON payloads. Streaming doesn't change agent correctness — it improves perceived latency on long tool-use loops. Flagged for prompt 13 hardening. The non-streaming path is fully audit-grade; streaming will need extra work on inference-row stitching (currently batched at end of loop).
- **28 new tests, all passing:** 19 safety tests (refusal categories, language detection) + 9 tool executor tests (routing, schema validation, methodology lookups, citation formatting). Tests intentionally DON'T hit the LLM — mocking the tool executor + AiService is enough to verify routing correctness.
- **ZodValidationPipe widening from prompt 08 carries over** — chat/brief/feedback schemas all use `.default()`.
- **Migration:** `20260423100000_analyst` — additive, 3 new tables (analyst_conversations, analyst_messages, analyst_feedback) + 1 enum (AnalystMessageRole). No changes to existing tables beyond the User back-relation.
- **Deferred with loud notes:** SSE streaming (prompt 13); conversation-memory summarisation (when conversations routinely exceed 10 turns); tool-use on Google Gemini (Gemini function-calling API differs enough that a separate `GeminiToolUseService` wrapper is needed — not yet); semantic search with real embeddings on policy + research (prompt 14 fills `PolicyDocument.embedding` + `ResearchOutput.embedding`); in-memory conversation cache (every chat turn reads the last 10 messages from Postgres); `/admin/ai-logs/:id` drill-in route (prompt 13).

*Prompt 10 (2026-04-23):*
- **`benchmarking.v1` methodology** in `@kku/db/benchmarking.ts`. Six helpers with explicit return types: `listPeerSets`, `computePortfolioComparison`, `computeSubjectLeadership`, `computeProgramPeers`, `computeDistinctiveness`, `computeWhiteSpaces`. Every result carries `methodologyVersion = 'benchmarking.v1'`.
- **Peer suggestion uses a 3-tier scorer, not embeddings.** v1 tries skill-overlap (Jaccard) first; falls back to subject+country+level heuristic when either side lacks skills. Embedding-cosine via pgvector `<->` is scaffolded but commented — `PeerProgram.embedding` is almost entirely NULL until prompt 14 wires the real scraper. The scorer used per call is surfaced in the API response (`scorerUsed` field) so the UI can flag "heuristic fallback" explicitly.
- **White-space threshold is ≥3 peers.** A skill counts as a white space when ≥3 peer institutions teach it AND no KKU ProgramSkill row references it. Threshold is a query parameter so analysts can tighten/loosen for subject-specific reviews. Ranked by `peerCount` desc.
- **Distinctiveness score is a simple overlap ratio.** 100 × (1 − sharedSkills / totalKkuSkills). A KKU program that teaches nothing peers teach scores 100; one that shadows peer curricula exactly scores 0. Deliberately linear/transparent — no black-box weighting until we have accuracy feedback.
- **Portfolio comparison uses department name as subject proxy for KKU.** We don't have a dedicated `SubjectArea` field on `Program`; peer programs have one (free-text). The comparison is fuzzy by nature and the UI surfaces that as a "comparable basis" caveat at the top of every portfolio view. A v2 could add `Program.subjectArea` + an explicit controlled vocabulary if this becomes load-bearing.
- **Subject leadership trend buckets: rising / falling / stable.** Classification by `lastRank - firstRank`: delta < −3 → rising, > 3 → falling, else stable. The "3-rank dead zone" keeps small year-to-year churn from producing meaningless arrows.
- **3 new mocked connectors** added to `SOURCE_CATALOG`: `the-rankings` (Times Higher Education), `qs-rankings`, `scimago`. All three `mocked: true`. Existing `openalex` + `peer-programs-scraper` cover the rest. Real wiring is prompt 14; subscription/API keys live in KKU Library.
- **Thailand-department vs peer-subjectArea mapping is intentional pidgin.** Cross-institution subject taxonomies are a swamp — QS, THE, and SCImago all have incompatible schemas. v1 leaves `subjectArea` free-text; the analyst editing `PeerSetMember.noteTh` is the authoritative source of "this comparison is apples-to-apples" judgement. Real taxonomy reconciliation lives with the `the-rankings` + `qs-rankings` connector wiring (prompt 14).
- **Coverage-matrix viz** in `@kku/ui/viz/coverage-matrix.tsx` is inline SVG (same rationale as tornado/gap-bars). KKU row always highlighted with border + background. Skill column headers rotated 52° to fit ~40 skills at 900px width. Peer-skill-weight rendering currently returns 0 cells — peer skill weights aren't exposed on the peer-list endpoint yet; data is present in `PeerProgramSkill` but the UI reads `ProgramPeersResponse` which only carries counts. Flagged for a next-pass enrichment; not load-bearing for the primary "what peers teach we don't" narrative that lives on `/benchmarking/white-spaces`.
- **4 AI insight modes** via `@AiCall({ module: 'benchmarking' })`: suggest-peers, curriculum-gap, distinctiveness, positioning-brief. Each has Thai-primary output (rationaleTh, narrativeTh, summaryTh). Graceful no-key fallback. Devil's-advocate equivalent to `scenarios` isn't present here — benchmarking is descriptive, scenarios are prescriptive; arguing against the data at peer level would be noise.
- **`PeerSet.isSystem=true` seeds 3 peer sets:** Thai Top-10 (6 programs), ASEAN Top-20 (9 programs), Global Subject Leaders — CS (6 programs). System sets are visible to all users; custom sets are user-owned via `createdBy`. Editing `isSystem=true` rows is reserved for ADMIN (not enforced at the DB level — service layer gates it).
- **`/benchmarking/white-spaces` cross-links to Gap Analyzer opportunities.** White-spaces = peer consensus ("peers teach this"); gap-opportunities = market consensus ("employers demand this"). The defensible Council ask is at the intersection.
- **Migration `20260423090000_benchmarking`** — additive. 4 new tables (peer_sets, peer_set_members, peer_program_skills, peer_rankings) + 1 additive column on peer_programs (`subject_area`). No destructive changes.
- **Seed adds** 12 peer programs across 3 subject areas, 3 peer sets (6/9/6 members), 54 peer-program skill rows, 27 PeerRanking rows (THE + QS + SCImago × 9 institutions × 3 years each).
- **Peer curriculum structure comparison (credits, required/elective, capstone) is deferred** — peers don't publish this uniformly. Skill-coverage is the v1 substitute that both requires less data AND produces more actionable insights. Real curriculum-structure scraping lives with `peer-programs-scraper` in prompt 14.
- **Faculty composition + outcome comparison are both deferred** — peer faculty rosters + graduate-outcome data aren't in our schema and won't be easy to get. Documented as v2 deliverables.
- **Deferred with loud notes:** real THE/QS/SCImago APIs (prompt 14); real peer-programs-scraper (prompt 14); pgvector embedding-cosine peer suggestion (prompt 14 when peer embeddings fill); peer-skill weight rendering in CoverageMatrix cells (next pass); curriculum structure extraction (credits, capstone) from peer brochures; faculty + outcome comparison (both v2, dependent on peer data not in schema).

*Prompt 09 (2026-04-23):*
- **Scenario engine is pure + deterministic + lives in `@kku/shared`.** No DB calls, no Date.now, no Math.random. Same inputs + same seed → bitwise-identical outputs. Mulberry32 PRNG for Monte Carlo. Apps/api builds the baseline snapshot from Prisma rows before handing it to `runScenario()`. This is deliberate: the engine is the audit boundary — everything that influences a number is an explicit input, so runs are reproducible and reviewable.
- **No `apps/forecast` Python service** — same call as prompt 08. The engine runs <1s even on 297 programs × 5 years × 100 MC iterations. A BullMQ job path for "long runs" was scoped and deliberately skipped; when a real run ever exceeds a few seconds (probably when Monte Carlo N reaches 5k+ on full portfolio stress tests), we add a queue.
- **5 interventions with a fixed application order:** launch → reshape → rebalance → merge → sunset. Later interventions see earlier effects; sunset is last so its zeroing is authoritative. Order is a contract; changing it would silently change outcomes and break reproducibility.
- **Sunset in v1 is a step function** (enrollment → 0 from year 1). `phaseOutYears` is captured in the intervention schema but is a no-op inside `projectOutcome`. Documented as a v2 refinement. Picked the step function so "sunset removes this program's revenue" is testable and unambiguous.
- **Merge synergy coefficient** defaults to 0.85 (15% cost saving). Tuition is a weighted average by enrollment; skills are unioned; absorbed programs are dropped from the portfolio. Merge retention defaults to 0.92 — modeling the inevitable student attrition during transitions.
- **Monte Carlo N defaults to 100, capped at 2000.** Each iteration perturbs all 7 assumptions independently with Gaussian noise (σ values documented in methodology doc). v1 assumes assumption independence — they're actually correlated. Flagged as a known limit; v2 will use empirical resampling or a covariance matrix once we see real-run accuracy feedback.
- **Workflow transitions are role-gated at the service layer, not the decorator.** `markCouncilReviewed` requires EXECUTIVE or ADMIN; `decide` requires EXECUTIVE, COUNCIL, or ADMIN and creates a CouncilDecision row in a single transaction. Tested with 7 role-gating tests (apps/api/test/scenarios-service.test.ts).
- **DECIDED + ARCHIVED scenarios are immutable** — `assertEditable` refuses patches on them. Keeps the audit trail clean: once Council decides, the scenario is a historical record, not a draft.
- **Templates are seeded as `isTemplate=true` scenarios owned by the first ADMIN user**, workflow status SHARED (so they're visible library-wide). `Use this template` copies into a fresh owner-scoped scenario with `isTemplate=false`. Template editing is ADMIN-only; regular users can only read + copy.
- **4 templates seeded:** demographic-stress (2030 cohort shock), financial-stress-20pct (5-year revenue haircut), ai-disruption (placeholder coefficients, clearly labeled indicative), mekong-expansion (+20% intake blueprint). Each carries a `caveatTh` that surfaces in the UI + PDF.
- **5 AI insight modes** (suggest-assumptions / identify-risks / compare-narrative / devils-advocate / what-would-change-my-mind). devils-advocate argues AGAINST the apparent-best scenario — Council members need the strongest counter-argument in the room. All modes route through AiService with `@AiCall({ module: 'scenarios' })` audit. Graceful no-key fallback with `confidence: 0`.
- **Tornado viz** for sensitivity is inline SVG (not Recharts), same rationale as prompt 05/06 inline viz primitives. Theme-aware via `useChartPalette`. Rows arrive pre-sorted by absolute impact — most sensitive at top, canonical tornado layout.
- **UI editor uses 5 tabs with URL-shareable state** (`?tab=setup|assumptions|simulation|comparison|discussion`). Comparison tab is a skeleton today — the `POST /scenarios/:id/compare` endpoint is live, but the multi-select picker is a follow-up pass. Discussion tab shows workflow status + role-gated CTA hints; threaded comments live in prompt 12 (Decision Workspace).
- **ScenarioRun persists the full `ScenarioRunResult`** (projection + sensitivity + monteCarlo + methodology + seed). ScenarioResult stays as the flattened searchable metric store (9 scalar metrics per run). Running a scenario writes both.
- **11 REST endpoints** are `list / create / get / patch / run / results / compare / share / council-review / decide / brief`, plus `templates`. `brief` dispatches to one of 5 insight modes based on body.
- **ZodValidationPipe widening from prompt 08 carries over.** Create + patch schemas use `.default()` and `.transform()` extensively; the `ZodType<T, ZodTypeDef, unknown>` pipe signature is what makes it compile.
- **New migration:** `20260423080000_scenario_planner` — additive. Adds ScenarioType + ScenarioWorkflowStatus enums, 9 columns to `scenarios` (all with defaults so existing rows stay valid), and a new `scenario_runs` table. No changes to ScenarioResult.
- **Deferred with loud notes:** long-running BullMQ job path (prompt 13 if ever needed); cohort stock-flow model (v2 engine); correlated Monte Carlo (v2 engine); linear phase-out for sunset (`phaseOutYears` activation); multi-select comparison picker UX (next pass); real AI-disruption coefficients (prompt 14); real Lao/Cambodia market data for Mekong template (prompt 14); threaded comments (prompt 12).

*Prompt 08 (2026-04-23):*
- **Forecasting methodology v1 is locked** at `docs/methodologies/forecasting.md` + `FORECASTING_VERSION = 'forecasting.v1'` in `@kku/shared/forecasting`. Two families: Holt's linear trend for demand (demand series are short, ARIMA needs ≥30 obs + a Python toolchain we're not adding today), linear regression + demographic-multiplier for supply (Thailand 18–22 cohort shrinks ~1.8%/yr — plain linear systematically overshoots).
- **No `apps/forecast` Python service.** Prompt 08 allows either Python or TypeScript; I chose TypeScript + pure-function simple-statistics so the stack stays homogeneous. When we need SARIMA, we'll revisit then — not speculatively now.
- **Confidence bands are ±z·RSE·√h, not parametric.** Documented explicitly as visual indicators, not coverage guarantees. If back-testing shows persistent under-coverage, switch to bootstrap intervals.
- **Null handling rule** from prompt 05 extends here: degenerate series (0 or 1 observation) return `null` or the lone value with a wide band, never an extrapolation from one point.
- **`Sector` table is FLAT, not hierarchical.** 8 rows seeded: 3 BCG (Bio / Circular / Green) + 5 S-curve (Auto / Smart Electronics / Medical / Digital / Agri-Food). `SkillSector` is a weighted many-to-many so one skill can contribute to multiple sectors (e.g., "battery chemistry" → both Green and Next-gen Automotive). Each sector carries a `demandMultiplier` for strategic weighting; BCG-Green and SC-Digital are the most-multiplied at 1.20 and 1.35.
- **`ForecastRun` persists every forecast.** Written by the gap service at query time (when a horizon > 0 request fires) — not speculatively. The back-test loop (operator fills `actualValue` + `errorPct` when `targetYear` elapses) is manual today; a nightly cron job can fill it automatically in prompt 13.
- **Skill-gap supply uses `latest ENROLLMENT.graduatedOnTime` per program**, not a fixed-window aggregation. When a program's latest year is missing, supply contribution is 0 — a data gap, not a "no-supply" signal. Ranked by |gap| (either direction) so oversupply risks surface alongside opportunities.
- **Regional gap demand side is live** against `OccupationDemand` seed data (8 occupation codes × 4 provinces × 6 months = 192 rows). **Supply side is blocked** on KKU-Alumni real data (prompt 14) — the ThailandMap renders with a "deferred" note on the supply side. Don't let the "no-data" intensity on supply-side cells be read as "no graduates" — it means "we don't know which province they ended up in yet."
- **Schematic Thailand map, not true choropleth.** `packages/ui/src/viz/thailand-map.tsx` renders 6 regional blocks (N/NE/C/E/W/S) with intensity colouring. A real province-level GeoJSON would add ~500 KB to the bundle and still not render without per-province supply data. Upgrading this to a proper choropleth is a clear deliverable of prompt 14.
- **`computeOccupationGap` supply side is a heuristic.** Occupation → program mapping isn't persisted anywhere yet (needs ISCO-08 crosswalk + KKU-Alumni graduate tracking). v1 uses "any program teaching a skill whose code prefix-matches the occupation code" as a cheap proxy, with `kkuProductionShare = 0` as a honest placeholder. Real occupation-demand gap work is prompt 14.
- **`/gap-analysis/opportunities` peer-coverage column lights up in prompt 10.** Today it returns 0 with a "prompt 10" label. The fit-note column is a template — real per-skill editorial fit lands once the Benchmarking module is online.
- **`/gap-analysis/forecast-accuracy` seeded with 9 back-tests** (5 demand + 4 supply, all with filled `actualValue`). MAPE-by-horizon is grouped by `targetYear - currentYear` so the page has shape on first boot. Real accuracy data accretes as forecasts age.
- **AI insights (3 modes) are POST-only, one `AiInference` row per call** via the existing `@AiCall({ module: 'gap-analysis' })` decorator. Modes: `strategic-top-5` (council-facing), `program-skills-to-add` (per-program), `sector-brief` (1-page Thai sector analysis). Graceful no-key fallback returns a placeholder + `confidence: 0` rather than 500-ing.
- **`ZodValidationPipe` widened** to accept `ZodType<T, ZodTypeDef, unknown>` so schemas with `.default()` or `.transform()` compose cleanly. Required because `horizon` in the gap filter schema maps `'0' | '3' | '5' | '10'` (string input from query) to `0 | 3 | 5 | 10` (number output). Previously hit the same class of issue as `@kku/shared/pdf/types.ts` — this is the permanent fix.
- **Migration:** `20260423070000_gap_analyzer` — additive, three new tables (sectors, skill_sectors, forecast_runs) + two enums (SectorFamily, ForecastKind). No changes to existing tables.
- **Deferred with loud notes:** real JobThai/JobsDB/GoldenPath connector data (prompt 14); real NESDC GPP composition (prompt 14); per-province graduate tracking via KKU-Alumni (prompt 14); ARIMA/SARIMA comparison on real data; SSE/MSE auto-fit of Holt's α/β; Thailand true-province choropleth; peer-coverage column on /opportunities (prompt 10); nightly back-test cron for `actualValue` fill-in (prompt 13); per-program demand-supply matching via ISCO crosswalk (prompt 14).

*Dev-env fix (2026-04-23):*
- **Each app needs its own `.env` or symlink**, not just the monorepo root. Next.js `@next/env` loads from the Next project directory (`apps/web/`), never the monorepo root. When it's missing, the Edge-runtime middleware bundle is compiled with `NEXTAUTH_SECRET` undefined and every protected route 307s back to `/signin` — even though the Node runtime signs JWTs just fine. The symptom ("UI black/white + can't sign in") actually had two distinct causes bundled together: the oklch alpha syntax bug (92b23e6 → fixed) and this env-loading trap.
- **Canonical fix:** `scripts/link-env.mjs` symlinks root `.env` into `apps/web`, `apps/api`, `apps/ingestion`. Runs as part of `pnpm setup`, also exposed as `pnpm link-env`. Falls back to copy on Windows without Developer Mode. All symlink targets are gitignored by the existing `.env` rule.

*Prompt 07 (2026-04-23):*
- **29 realistic TrendSignal rows are SEEDED, not collected.** All 23 connectors are still mocked (prompt 03) — the monitors scaffolded here run on cron but return "found nothing" until prompt 14 wires real upstreams. The seeded signals span 5 types (policy / research / market / tech / news) with bilingual summaries and three of them target seeded programs so the Deep-Dive's "Trend exposure" section surfaces content on first boot.
- **Six monitor cron jobs live on the new `trend-monitors` BullMQ queue.** Cadences in `MONITOR_CADENCE`: policy every 6h, job-market daily, research/peer-programs/tech-signals weekly, patents monthly. Each monitor is a stub that logs "scanned, nothing new" today. When you flip one real, the two entry points are: (a) for PDF-origin signals, enqueue the existing `ANALYZE_POLICY_DOC` ai-job which already produces the AI analysis; (b) for API-origin signals, call `createSignal()` from `@apps/ingestion/src/trend-monitors/monitors` which handles fan-out for free.
- **Notifications are in-app only for now.** `Notification` table + `/inbox` UI + top-bar bell entry are all live; SMTP email digest is deferred to prompt 13 when we wire ops mail. The flow `createSignal → fanoutSignalToSubscribers → Notification rows` is fully tested (3 new vitest suites) and idempotent (existing (user, signal) pair never double-fires).
- **`SignalSubscription` uses free-text discriminators.** `filterType` ∈ {`program`, `skill`, `sector`, `signal_type`}; `filterValue` is matched against fields per type. Sector today is a keyword-in-title fallback — real sector tagging lives in a `TrendSignal.tags` column we'll add when prompt 14's connectors start emitting them.
- **`/trends` uses a Radix filter rail + polar radar side-by-side.** `<TrendsRadar>` is hand-rolled SVG (Recharts' `PolarScatter` can't do concentric time rings cleanly). Dot size + opacity encode impact; radius from centre = time since detection; angle = signal type wedge. Click a dot → detail page. Tested implicitly via build; visual regression defers with the rest (Playwright still not installed).
- **Weekly digest endpoint returns DATA, not PDF.** `GET /trends/digest/weekly` returns the digest shape; the PDF itself is cut via `POST /pdf/generate` using the existing `weekly-trend-digest` template from prompt 02c. Separating shape from format means the in-app "digest view" (planned for prompt 12) and the PDF share one source of truth.
- **Sub-pages `/trends/sectors` and `/trends/regions/[region]` are filter presets today.** They redirect back into `/trends` with a keyword search. Real sector/region tagging lands with prompt 14; this is enough structure for operators to bookmark.
- **`"mark reviewed" uses Annotation with `kind='signal_review'`.** Keeps TrendSignal append-only while still giving operators a "mark as seen" affordance. Distinct from `kind='disagreement'` (from prompt 06) so the admin UI can filter.
- **`TrendsController` "dangerZoneCount" returns 0 today.** That cross-join (signals × programs in cockpit danger zone) is a natural prompt-08 deliverable — Gap Analyzer computes program-level risk routinely and can feed this number. Shape kept stable so the prompt-08 wire-up is a one-line code change.
- **Deferred with loud notes:** real signal detection (prompt 14 connector wiring); SMTP email digest (prompt 13); `/trends/sectors` real sector tagging; patent API access; "Add to scenario" button (prompt 09); related-signal suggestion via vector similarity (prompt 10); Thailand region choropleth on `/trends/regions/*` (same data gap as the deep-dive's geographic section).
- **Migration:** `20260423060000_notifications_and_subs` — additive, two new tables (notifications, signal_subscriptions). No changes to `trend_signals`.

*Prompt 06 (2026-04-23):*
- **Deep-dive endpoints are explicit fan-out, not a single giant call.** Ten `GET /programs/:id/<section>` endpoints. The UI parallelises the fetches — above-the-fold sections (header, narrative) paint first, below-the-fold continue loading. Avoids the "one slow aggregator blocks the whole page" failure mode.
- **Role-gated faculty visibility is LOAD-BEARING.** `COUNCIL` role gets `visibility: 'aggregates-only'`, which strips names + specialisation + employeeCode from every member row. Ranks + retirement date + succession risk ARE visible. Implemented at the Prisma `select` layer (not just filtered post-fetch) so the wrong data never leaves the DB. Unit-tested against prompt 14's future salary field — when we persist salaries, they inherit the same gating.
- **`Annotation.kind` is a discriminator, not an enum.** Free-text to avoid migrations when new section names land. Values in use today: `'comment'` (default), `'disagreement'` (expert correction of an AI output), `'narrative_edit'` (reserved for prompt 12's Decision Workspace). `sectionKey` + `aiInferenceId` pinpoint which surface the disagreement is about.
- **Disagreement flow persists, doesn't route.** `POST /programs/:id/disagreements` writes an Annotation row linked to the specific AiInference and returns. The "route to model improvement queue" wiring (retrain trigger, feedback aggregation dashboard) lives with prompt 13's hardening work — not valuable until we have enough disagreements to learn from.
- **`/cockpit/export` handles both Council Packs AND per-program briefs.** The deep-dive PDF export button hits `/cockpit/export` with `scope: 'program'`. One audit trail, one template, one signed-URL path. Per-program-specific template (`program-brief` in `@kku/pdf-templates`) is a lighter single-page brief — kept in reserve for cases that don't need the full council-pack framing (emails, quick share links).
- **Program scope previously 404'd from the cockpit.** That's now live at `/programs/[id]` — the cockpit's drill-in contract from prompt 05 closes.
- **Three new viz primitives in `@kku/ui/viz`:** `<RadarChartSmall>` (Recharts), `<Waterfall>` (inline SVG — Recharts' stacked-bar waterfall is painful to colour), `<FunnelPipeline>` (Recharts FunnelChart). All three are theme-aware via `useChartPalette`.
- **Explicit return types on `@kku/db` deep-dive helpers.** Prompt 01's `declaration: true` tsconfig baseline means inferred return types that reference Prisma-generated interfaces fail portability checks. Each public function in `program-deep-dive.ts` has an explicit `Promise<...Result>` annotation. When adding a new helper, add the interface.
- **Print view is separate from PDF export.** `/programs/[id]/print` is a minimal A4-styled Next page designed for `Ctrl/Cmd+P` from the browser. The formal Gotenberg-backed PDF (with TH Sarabun New, Chromium rendering, Council Pack framing) is the "Export PDF" button — different deliverable, different fidelity.
- **Section empty-states are NOT placeholders, they're the UX.** Data-sparse sections (Thailand geographic heatmap, peer auto-suggestion, rich TGAT/TPAT distribution) render with clear "blocked on prompt X" messages. A Council member opening a program with limited data sees what's known and what isn't — not a fabricated dashboard.
- **Deferred to specific later prompts (all flagged in UI empty-states):** Thailand choropleth (needs per-graduate province — KKU-Alumni connector, prompt 14); peer auto-suggestion via skill-embedding similarity (Benchmarking module, prompt 10); real TGAT/TPAT distribution (needs TCAS connector); "top 5 AI recommendations" text (currently surfaced via the narrative regeneration path; dedicated recommendation generation lands in prompt 11's AI Analyst); per-section confidence badges beyond narrative (every section flows through Provenance drawer but per-section confidence scores wait for the extraction feedback loop in 13).
- **Migration:** `20260423050000_annotation_kind` — three new columns on `annotations` (kind + section_key + ai_inference_id). Additive, backwards-compatible.

*Prompt 05 (2026-04-23):*
- **Health score methodology v1 is the locked reference.** `docs/methodologies/health-score.md` + `HEALTH_SCORE_VERSION = 'health-score.v1'` in `packages/db/src/health-score.ts`. **Equal-weighted across the 5 dimensions** (demand / financial / quality / relevance / capability) by design — equal weights are the least-arguable default; any weighted formulation encodes a value judgement that must be surfaced explicitly, and v1 deliberately doesn't.
- **Null handling rule is LOAD-BEARING.** Missing metrics are EXCLUDED from the average, NEVER substituted with 0 or 50. Every score carries `dataCompletenessPct` and the UI (Heatmap + overall cells) renders null as `—` in tertiary text. Do NOT "fix" null-with-zero — that would punish programs for data gaps.
- **`relevance` + `capability` dimensions return null for v1.** Real relevance needs the post-approval ProgramSkill materialisation (still deferred from prompt 04); real capability needs the KKU-HR real feed. Both have placeholder scorer functions that deliberately return `{ score: null, completeness: 0 }` so every row shows "low data" rather than a fabricated number.
- **Cross-scope composite consistency is NOT asserted.** Faculty overall ≠ weighted mean of its departments' overalls — each is computed independently from the MV at its own scope. For v1 the divergence is small; enforce bottom-up consistency in a future version if it ever matters.
- **Heatmap + BubbleMatrix are new in `@kku/ui/viz`.** Deferred from 02b. BubbleMatrix renders inline SVG (no Recharts) for PDF export compatibility; pulls palette via `useChartPalette()` so dark-mode switch works without remount. Heatmap rows are clickable for drill-in; cells with `completeness < 50%` get a muted row-background tint so the reader notices the gap.
- **AI brief generation has a graceful no-key fallback.** When no `GOOGLE_AI_API_KEY` / `ANTHROPIC_API_KEY` is configured the brief endpoint returns a Thai+English placeholder explaining what's missing and `confidence: 0`. The rest of the flow (save to Decision Workspace, etc.) still works — operators get feedback rather than a 500.
- **Council Pack export composes through prompt 02c's `pdf` service.** `/cockpit/export` builds the `council-pack` template's `sections` + `executiveSummary` + `provenance` from live cockpit data and calls `PdfService.generateAndPersist`. PDF is always light theme (that invariant already lives in `packages/pdf-templates/base-css.ts`).
- **Program scope redirects to `/programs/:id` from the cockpit.** Deep-Dive is prompt 06; the redirect is in place so the top-bar ScopeSelector's program picker doesn't land in a broken state. Today `/programs/:id` is a 404 — that's expected and will resolve in prompt 06.
- **Landing page changes:** authenticated COUNCIL / EXECUTIVE / DEAN / DEPT_HEAD users redirect from `/` → `/cockpit`. ANALYST / ADMIN still land on the existing dev overview at `/` (it's an "everything at once" snapshot used during build; analysts like it).
- **`SavedCockpitView` is per-user, JSON filter blob.** Migration `20260423040000_saved_cockpit_views`. Filter shape is Zod-validated at the API boundary but free-form in the DB so new filter facets land without a migration. `lastUsedAt` is touch-bumped on each load so recent views sort naturally.
- **Deferred with notes in `docs/methodologies/health-score.md`:** real demand signal (needs JobThai/JobsDB real), rollup consistency, Redis aggregation cache (simple passthrough now — prod-scale caching lands with prompt 13 if the materialized-view reads ever become the bottleneck), Playwright visual regression (scaffold exists — run `npx playwright install` then `pnpm e2e` to kick off), F1 accuracy on handcrafted Thai-vs-English corpora (same blocker as prompt 04 — no ground truth yet).

*Prompt 04 (2026-04-23):*
- **`AiService` is THE abstraction.** Every LLM call routes through `packages/shared/src/ai/AiService`. Modules never import `@google/genai` or `@anthropic-ai/sdk` directly. The factory picks the provider from `AI_PROVIDER` env (google / anthropic / openrouter / intelsphere). OpenRouter + IntelSphere are stubs that throw at call time — deliberately loud, not silent fallback.
- **Two real providers, two stubs.** `GoogleAiService` (Gemini) is the default; `AnthropicAiService` (Claude) is the alternative. Claude has no embeddings API, so the factory wraps the Claude-primary path to delegate `embed()` to Google transparently. This lets modules use Claude for reasoning and Gemini for vectors without juggling two service handles.
- **Prisma-backed recorder lives in `@kku/db`.** `packages/db/src/ai-inference-recorder.ts` — `@kku/shared` can't import `@kku/db` without a cycle, so the interface lives in shared and the concrete Prisma implementation lives in db. Every AI call writes one `AiInference` row via this recorder; the providers accept it as a constructor dep, so tests get trivial mocking.
- **`AiExtraction` is a new table, parallel to `PdfExtraction`.** Handles non-PDF-sourced AI outputs (course descriptions typed into admin forms, job posting JSON from connectors, policy doc narrative tagging that chains off a PdfExtraction). Review UI at `/admin/extraction-review` reads from it with the same approve/reject/edit pattern. Migration `20260423030000_ai_extraction`.
- **Prompt templates are code.** `packages/shared/src/ai/prompts/*` — each file exports a `*_VERSION` constant, a Zod output schema, and a `build*Messages` function. `AiExtraction.methodVersion` captures the version that produced each row. Edit policy: behaviour change = bump version; NEVER edit an existing published version in place.
- **New BullMQ queue: `ai-jobs`.** 4 handlers (EMBED_SKILL / EXTRACT_COURSE_SKILLS / EXTRACT_JOB_POSTING_SKILLS / ANALYZE_POLICY_DOC). Separate queue from `ingestion` and `pdf-intake` so AI concurrency + retries can be tuned for vendor rate limits independently. Apps/ingestion is the sole consumer; apps/api enqueues via the extraction-review admin endpoints.
- **Default auto-approve threshold is 0.85.** Every AI extraction below that lands in the review queue. High by design — Council-affecting extractions sit in front of a human until accuracy is measured. Tune via `AI_AUTO_APPROVE_THRESHOLD`.
- **Post-approval materialisation is DEFERRED.** The `/admin/extraction-review` approve endpoint currently flips `reviewStatus = APPROVED` but does NOT (yet) materialise the payload into CourseSkill / JobPostingSkill / etc. — that handler lands once we see real approved shapes. Scaffold + comment in `ai-admin.controller.ts`.
- **Vector-similarity candidate selection is DEFERRED.** Ai-jobs handlers currently pick candidate skills via "newest 30" rather than cosine similarity. Embeddings backfill runs via the EMBED_SKILL handler; flip the `pickCandidateSkills` impl to `$queryRaw` over `embedding <-> query_vector` once every skill has a vector. Comment in `ai-jobs/handlers.ts`.
- **Taxonomy seed is ~60 real skills + 500 synthetic.** `packages/shared/src/skills/taxonomy-seed.ts` holds the real taxonomy (parent-child hierarchy, 5 top-level categories — computing / engineering / life-sciences / agriculture / business / education / transferable / Thailand-BCG). Seed also keeps the 500 synthetic placeholder skills so downstream seed code (course-skill mapping) has depth. Full 500 ESCO + 100 TPQI bootstrap is a data-load chore — ESCO ships as RDF, requires its own parser.
- **`/skills` UI is scope-aware from URL.** `?scope=faculty&scopeId=X` filters the tree to skills covered by programs under that scope; ancestors are shown de-emphasised so the path stays coherent. Detail pane shows program coverage + recent demand signal at the current scope.
- **Cost tracking per call, not per rollup.** `AiInference.costEstimateUsd` filled by each provider from its PRICING table. `/admin/extraction-review` stats strip rolls per-module over 7 days. Per-month + budget alerts defer to prompt 13.
- **Tests:** 3 new suites — `ai-service.test.ts` (interface shape + prompt template + schema), `ai-jobs.test.ts` (handler confidence → review status routing + not-found skip), existing tests still passing. No F1 accuracy test yet — see docs/ai-governance.md §accuracy (hand-labeled corpus required).
- **Deferred with loud notes:** OpenRouter + IntelSphere providers; vector-similarity candidate selection; post-approval materialisation; F1 accuracy measurement on a hand-labeled corpus; translation cache; per-month cost rollup + budget alerts; full 500 ESCO bootstrap; rollup recomputation (CourseSkill → ProgramSkill → DepartmentSkill → FacultySkill) on extraction approval.

*Prompt 03b (2026-04-23):*
- **LLM-powered steps are stubbed, shaped correctly for prompt 04.** `PdfClassifier` + 7 `PdfExtractor` interfaces live in `@kku/shared/pdf-intake`; stub implementations return confidence 0 (extractors) or 0.5 when honouring a hint (classifier). Prompt 04's job is to replace the stub bodies with AI-service calls — interfaces, registry, review UI, state machine all keep working as-is.
- **Every PDF lands in the review queue today.** Stub classifier's max 0.5 + default 0.7 threshold means no auto-approvals happen; operators see every PDF. This is deliberate — until a real classifier lands, human eyes are non-optional.
- **Scanned PDFs park in PROCESSING, not FAILED.** `extractNativeText` detects `hasImages + very little text` and flips `isLikelyScanned`; the pipeline marks `ocrApplied: false` and sets `processingError` to "awaiting OCR". Prompt 04 wires Claude vision to finish the path — until then the park state is visible in the review UI.
- **Dedicated `pdf-intake` BullMQ queue.** Separate from `ingestion` so PDF parse concurrency + retries can be tuned independently. Default: 2 concurrency, 2 attempts, 10s base backoff. PDF connectors in apps/ingestion push jobs via this queue; apps/api enqueues on upload + re-extract.
- **Content-hash dedup is load-bearing.** `PdfDocument.contentHash` is UNIQUE. Upload + PDF connector both compute SHA-256 of bytes and upsert by hash. Same bytes, same row. Storage key is `<category>/<hash>.pdf` so we never store the same PDF twice in MinIO either.
- **Re-extraction preserves audit trail.** `PdfIntakePipeline` deletes existing PdfExtraction rows only when `methodVersion` matches, keeping historical rows with older versions. Bulk reprocess (`POST /pdfs/bulk-reprocess`) uses this to regenerate extractions when a v2 extractor lands.
- **pdfjs-dist needs `workerSrc` set to a real file path in Node.** Set via `require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')` — pdfjs 4.x still checks this even when running main-thread. Empty string silently fails.
- **Connectors now hand bytes through transform.** `PdfUploadConnector.transform` carries `bytes: Buffer` through the `NormalizedRecord.payload` so load() can PUT to MinIO with the real content. Prior to 03b it stripped bytes and wrote a placeholder s3 URL.
- **MinIO upload happens at BOTH entry points** — the PdfUploadConnector base AND the api `/pdfs/upload` endpoint share the same `S3Storage` client. Both compute the content hash, both upsert by hash. If a connector fetches a PDF that an operator also happens to upload, they collapse cleanly.
- **Review UI uses react-pdf (pdfjs under the hood).** Same pdfjs-dist as the ingestion worker, so text extraction and viewer stay in lockstep on fonts + text positioning. Signed URL from MinIO; 15-min TTL default.
- **`PdfIntakeModule` in apps/api** is a thin service + controller. The *worker* lives in apps/ingestion. Both processes open handles to the same `pdf-intake` queue — api produces, ingestion consumes.
- **New migrations**: `20260423020000_pdf_intake` (adds source_category_hint, processing_error, classification_confidence, review_notes, reasoning + JOB_POSTINGS_BATCH source category) + `20260423020100_pdf_extraction_type_committee_minutes` (follow-up enum value discovered mid-build — split out because the prior migration was already deployed).
- **Deferred to prompt 04:** real LLM classification + extraction bodies; OCR via Claude vision for scanned PDFs; table extraction strategy (Camelot vs vision LLM TBD); vector-similarity entity linking; trend signal auto-generation; WebSocket progress (polling is fine for admin paths); bundled sample PDFs with extraction-accuracy scores.

*Prompt 03 (2026-04-23):*
- **Single catalog in `@kku/shared`, not per-app constants.** `packages/shared/src/ingestion/catalog.ts` is the source of truth for which sources exist. The DB seed and the `apps/ingestion` connector registry both read from it. Adding a source means editing the catalog + adding a connector class + registering — in one commit, with no DB/code drift.
- **All 23 connectors are MOCKED.** Every connector has `readonly mocked = true` and returns realistic sample data. Their DataSource rows are seeded with `status: 'mocked'` and the admin UI shows the badge. Real wiring is prompt 14's scope; flipping a connector means replacing fetch/transform/load bodies and changing the flag in the catalog.
- **`DataSource.slug` is the cross-ref key.** Connectors look up their DataSource row by slug (lowercase-kebab). Don't rename a slug without a DB migration — existing IngestionRun FKs point at the DataSource id, but slug is how code finds it.
- **PDF connectors DON'T extract — they route.** `PdfUploadConnector`'s base class does one thing: create/upsert a `PdfDocument` row with `processingStatus = PENDING` and attach it to the IngestionRun via `pdfDocumentId`. Extraction (OCR, field parsing, domain-table routing) belongs in prompt 03b. If a module tries to parse a PDF inside a connector, that's a design violation.
- **BullMQ, single queue, two producers.** The queue name `ingestion` is defined in both `apps/ingestion/src/queue/queue.ts` and `apps/api/src/data-sources/ingestion-queue.service.ts` — they MUST match. apps/ingestion is the sole consumer (worker). apps/api only produces manual-run jobs when an admin clicks Run-now.
- **Scheduler reads cadence from DB at boot.** `IngestionScheduler.registerSchedules()` clears existing repeatables and re-registers from current `DataSource.cadenceCron` values. Admin edits take effect after the ingestion worker bounces — hot reconfiguration was judged not worth the cross-process pub-sub cost for a daily-cadence service.
- **Non-retryable errors short-circuit BullMQ retries.** `ConnectorRunner` catches `NonRetryableError` (validation, schema drift, permanent auth failure) and marks the run FAILED without re-throwing. Everything else re-throws so BullMQ's `exponential` backoff fires (default: 3 attempts, 5s base).
- **Provenance is best-effort today.** `getProvenance('pdf_document', id)` is precise — it follows the PdfDocument ← IngestionRun ← DataSource chain. Other entity types fall back to "most recent successful runs" because metric tables don't carry `ingestion_run_id` yet. Prompt 14 will add per-row ingestion_run_id columns to the metric tables.
- **Admin UI lives at `/admin/data-sources`.** ANALYST + ADMIN see it; ADMIN can edit cadence + bulk pause/resume; ANALYST can Run-now + view logs. Dropdown entry in the top-bar right menu. Uses all existing prompt 02b primitives (DataTable, FreshnessBadge, RightPanel, Badge).
- **New permissions:** existing `data_sources:read`, `data_sources:configure`, `ingestion:trigger` covered the surface — no new permissions needed. ANALYST gets `data_sources:read`; ADMIN gets all three.
- **Migration:** `20260423010000_ingestion_framework` adds IngestionRun + 3 enums (DataSourceInputFormat / IngestionRunTrigger / IngestionRunStatus) + 4 fields on DataSource (slug / inputFormat / cadenceCron / scheduleEnabled / ownerContact). Backfills existing DataSource.slug from lowered-kebab(name); `pnpm db:seed` immediately overwrites with the catalog's canonical slugs.
- **`@kku/db` now depends on `@kku/shared`.** Added for `SOURCE_CATALOG` + `ProvenanceEntry` types. Prior to this they were separate to avoid cycles — the cycle wasn't actually there (shared didn't import db), so the dep is clean.
- **Deferred** (documented in docs/data-sources.md + CLAUDE.md): per-source rate limits / quotas (per-queue BullMQ limits land with real wiring in 14); hot cadence reload; Playwright-based real scraping; real alerting on hard failures (today: console log per prompt spec).

*Prompt 02c (2026-04-23):*
- **Fonts live outside Git.** `infra/gotenberg/fonts/` is `.gitignored` for `*.ttf` — devs + the prod build pipeline drop the four TH Sarabun New files in locally before `docker compose build gotenberg`. `.gitignore` only blocks ttfs in that one path; everywhere else fonts commit normally. Sourcing + naming: `infra/gotenberg/README.md`.
- **Dockerfile fails loudly on missing fonts.** `COPY` aborts the build if a file is absent; a post-`fc-cache` check runs `fc-list | grep -ci sarabun` and exits non-zero if fewer than 4 faces registered. The common failure mode for Thai PDFs (upstream gotenberg renders tofu) can't slip through unnoticed.
- **React SSR → HTML, not `@react-pdf/renderer`.** Templates are React components rendered with `renderToStaticMarkup`; Chromium inside Gotenberg does the actual PDF conversion. `@react-pdf/renderer` mishandles Thai tone-mark shaping — it is *explicitly banned*, not just unpreferred.
- **`@kku/pdf-templates` is a new workspace package.** Holds `baseCss` (the Thai-safe CSS contract), `ChartForPrint` wrappers (no ResponsiveContainer, no animation, light-only palette baked in as hex), shared components (Cover / Section / ProvenanceAppendix / Footer), and six templates (`council-pack` as reference; `program-brief`, `scenario-pack`, `weekly-trend-digest`, `decision-record`, `data-quality-report` as module-filled skeletons).
- **`apps/api/tsconfig.json` now sets `jsx: 'react-jsx'`.** pdf-templates is a source-linked workspace dep and contains `.tsx`; TS has to *parse* those files when it follows the import even though api itself emits no JSX. Don't remove this — it isn't a sign that api renders React.
- **Template registry takes `ZodType<T, ZodTypeDef, unknown>`, not `ZodType<T>`.** Templates that use `.default()` produce input/output type divergence in Zod — `unknown` input matches what the HTTP boundary actually provides. See `packages/shared/src/pdf/types.ts` comment.
- **`allTemplates` iterates as `TemplateDefinition<unknown>[]`.** A heterogeneous readonly tuple can't collapse to a single generic — each template's schema narrows its own data at render time, the registry treats them uniformly at boot.
- **`<ChartForPrint>` hard-codes the light-mode chart palette as hex.** No CSS-var resolution at SSR time — the server-rendered SVG has no `<html>` to read `data-theme` off. The 12-colour `PRINT_PALETTE` array is the evaluated light version of `tokens.css`; mirror any change to the palette tokens in the same commit.
- **`PdfService` wraps the core `PdfGenerationService`.** NestJS layer adds: Prisma `pdf_generations` row before+after each render, MinIO putObject + presigned URL, `PdfGenerationError` → `ApiError` mapping so the global exception filter emits the standard envelope. Modules inject `PdfService`, not `PdfGenerationService`.
- **MinIO public endpoint override.** `S3Storage.getSignedDownloadUrl` signs against a separate client configured with `MINIO_PUBLIC_ENDPOINT` when set — otherwise the signature is cut for the docker-network hostname (e.g., `http://minio:9000`) which the browser can't reach. Leave `MINIO_PUBLIC_ENDPOINT` empty in pure-local dev; set it in compose + prod.
- **New permissions: `pdf:generate` (COUNCIL / DEAN / DEPT_HEAD / ANALYST / ADMIN) and `pdf:admin` (ADMIN).** Both live in `@kku/shared/auth/permissions.ts` and are checked via `@Authorized(…)` on controllers. VIEWER cannot generate PDFs.
- **Retry policy is single-attempt, transient-only.** `PDF_UPSTREAM_UNAVAILABLE` (Gotenberg unreachable / 5xx) retries once after 500ms. `PDF_RENDER_TIMEOUT`, `PDF_TEMPLATE_DATA_INVALID`, `PDF_UPSTREAM_REJECTED` do NOT retry — they're deterministic failures.
- **Migration workflow unchanged from prompt 01.** `20260423000000_pdf_generations/migration.sql` hand-written to match Prisma's diff output (enum + table + indexes + FK); no TTY needed. Apply with `prisma migrate deploy`.
- **Deferred** (noted in `docs/pdf-generation.md`): per-user rate limits on `/pdf/generate` (global throttler only today); golden-PDF visual regression tests; HTTP endpoint for `PdfGenerationService.merge` (the service method works, the controller doesn't expose it yet — Council Pack composition in prompt 12 will need it).

*Prompt 02b (2026-04-22):*
- **Tokens are OKLCH, not HSL.** `packages/design/src/css/tokens.css` holds every value as `L C H` triplets under `[data-theme='light'|'dark']`; Tailwind utilities wrap them with `oklch(var(...) / <alpha-value>)` so `bg-surface-1/80` works. Modern evergreen browsers support it natively — no RGB fallback shipped.
- **Tailwind preset blocks the default palette.** `packages/design/tailwind-preset.ts` resets `theme.colors` so `bg-slate-500` etc. are compile-time errors. Only tokens compile: `bg-surface-1`, `text-danger`, `bg-chart-3`, etc. Apps extend via `presets: [tailwindPreset]`.
- **ESLint flat config at root** with `no-restricted-syntax` rule banning literal hex (`#abc`) and literal-numeric `rgb()`/`oklch()` calls. Wrappers around CSS variables (`oklch(var(--color-x))`) are explicitly allowed.
- **Theme attribute:** `data-theme` (not `class="dark"`). `next-themes` configured with `attribute="data-theme"`; the Tailwind `darkMode` selector is `['class', '[data-theme="dark"]']` so both work.
- **Council-readiness trio is app-global.** `<ProvenanceProvider>` wraps the root and `<ProvenanceDrawer>` lives once at the tree root; every `<ProvenanceButton>` pushes into the same drawer. `<FreshnessBadge>` and `<ConfidenceBadge>` are drop-in.
- **Charts read the palette at runtime.** `useChartPalette()` resolves `oklch(var(--color-chart-N))` through `getComputedStyle` and subscribes to `data-theme` / `data-density` changes via MutationObserver — so Recharts re-renders with the correct colours on theme flip without remounting.
- **ScopeSelector URL convention:** `?scope=<level>&scopeId=<id>`. University has no scopeId. Compare mode (2–4 scopes side-by-side) deferred to a follow-up prompt.
- **Storybook deferred.** `/styleguide` page covers the visual-contract purpose; Storybook config + stories for 30+ components doesn't earn its cost this session. Revisit after module prompts if visual regression pain shows up.
- **Next.js bundler has a resolution oddity:** importing `DENSITY_MODES` from `@kku/design` fails TS in `apps/web` even though the export chain is correct (direct-path imports work). Worked around with an inline `const DENSITY_MODES = …` in the one consumer. Investigate when the moduleResolution settings stabilise.

*Prompt 02 (2026-04-22):*
- **JWT strategy: HS256, shared across services.** Next-auth's default is JWE (A256CBC-HS512); we override `jwt.encode`/`jwt.decode` with `jose` HS256 signing so NestJS can verify tokens via the same `NEXTAUTH_SECRET` without decryption keys. Custom codec lives in `apps/web/src/lib/auth/jwt-codec.ts`; NestJS verifies in `apps/api/src/common/jwt-auth.guard.ts`.
- **One authorisation entry point — `can(user, permission, scopeContext?)`** in `@kku/shared/auth`. Nest decorator `@Authorized(permission)` reads metadata and calls this function; `:own_faculty` / `:own_department` auto-imply `@RequireScope()`. Modules must not roll their own RBAC checks. 24 unit tests cover the role × scope matrix.
- **API envelope is mandatory** — `{ data, meta, error }`. `ResponseEnvelopeInterceptor` wraps every handler return. `GlobalExceptionFilter` maps ApiError taxonomy to HTTP status and envelope-shaped failure bodies.
- **Edge-safe middleware.** `apps/web/middleware.ts` verifies the session cookie via jose directly — it does NOT import `@/lib/auth` (which pulls Prisma and is Node-only). Keep this boundary; adding a Prisma call to middleware breaks the Edge build.
- **NextAuth callback route runtime = Node.js.** `apps/web/app/api/auth/[...nextauth]/route.ts` sets `export const runtime = 'nodejs'` because the jwt callback calls Prisma (provisioning). Don't remove.
- **Dev-only credentials provider — hard fail in prod.** `assertLocalAuthSafe()` throws at module load if `ENABLE_LOCAL_AUTH=true` and `NODE_ENV=production`. Test in `packages/shared/test/env-guard.test.ts`.
- **Theme preference round-trip:** client → server action → NestJS `PATCH /me/theme` → Prisma. JWT refresh happens on next session read via the `trigger === 'update'` branch of the jwt callback. Don't call `useSession().update()` unnecessarily — the page re-renders on next navigation and picks up the new token.
- **Response envelope for lists** includes `meta.scope = { level, id }` but NOT `meta.pagination` yet — the pagination block lives in the endpoint-specific `meta` until we lift it into the envelope schema (future prompt).
- **Non-standard ops:** `pnpm approve-builds` path — add `@swc/core` to `pnpm.onlyBuiltDependencies` so vitest can SWC-transform decorator metadata for NestJS tests.

*Prompt 01 (2026-04-22):*
- **Scope rollups: materialized views + one entry point.** Metrics stored at program level; four MVs (`mv_program_metrics`, `mv_department_metrics`, `mv_faculty_metrics`, `mv_university_metrics`) with a uniform column shape roll them up. `queryMetricByScope` in `@kku/db` is the single access point — modules must not write ad-hoc rollup joins.
- **Prisma owns the extensions.** Schema declares `postgis`, `vector`, `pg_trgm`, `btree_gin`, `uuidOssp` via `previewFeatures = ["postgresqlExtensions"]`. The `infra/postgres/init/01-extensions.sql` script remains as a belt-and-braces fallback; both idempotent.
- **Non-interactive migration workflow.** Claude Code sessions can't drive `prisma migrate dev` (needs TTY). We use `prisma migrate diff --from-empty --to-schema-datamodel` to generate SQL into a manually-named migration folder (`YYYYMMDDHHMMSS_name/migration.sql`), then `prisma migrate deploy` to apply. Strip the Prisma update banner from generated SQL files before committing.
- **pgvector fields:** `Unsupported("vector(1536)")` on Skill / JobPosting / PolicyDocument / PeerProgram / PdfDocument / PdfPage. Not accessible via Prisma Client — ingestion writes them via `$queryRaw`. Seed leaves NULL.
- **Weighted averages** on outcome rollups use `sample_size` as the weight — never naïve `AVG()`. 500-graduate and 12-graduate programs get proportional voice.
- **Skill rollups are NOT materialized views.** Weighted union across CourseSkill → ProgramSkill → DepartmentSkill → FacultySkill is too structural for a SUM-based MV; ingestion (prompt 04) maintains the denormalized tables.
- **pnpm build approval:** added `pnpm.onlyBuiltDependencies` to root `package.json` for `@prisma/client`, `prisma`, `@prisma/engines`, `esbuild`, `@nestjs/core`, `msgpackr-extract`, `unrs-resolver`. Required on pnpm ≥ 10 — installs silently skip postinstalls otherwise.

*Prompt 00 (2026-04-22):*
- **Typography direction:** IBM Plex Sans Thai (body/UI) + IBM Plex Mono (tabular/numeric). Alternatives (Sarabun+Prompt, Noto Sans Thai Looped) documented in `docs/design-system.md`. Re-validated at real UI sizes in prompt 02b. Deliberately distinct from TH Sarabun New (that font is reserved for PDF output per prompt 02c).
- **Colour direction:** warm neutral base (not cool greys); KKU Cardinal red (`~#A6192E`) used only as a sparing brand accent; "at-risk" uses a *different* pure red (`~#DC2626`) so risk flags aren't read as institutional rejection; indigo for default interactive affordances.
- **Docker image for Postgres:** custom `infra/postgres/Dockerfile` on top of `postgis/postgis:16-3.4` + `postgresql-16-pgvector`. Init script at `infra/postgres/init/01-extensions.sql` enables postgis, vector, pg_trgm, btree_gin, uuid-ossp. Rebuild with `docker compose build postgres` when the Dockerfile changes.
- **Workspace naming:** `@kku/shared`, `@kku/db`, `@kku/ui`, `@kku/design` (scoped); apps (`web`, `api`, `ingestion`) are unscoped because their names are used by the dev scripts directly.
- **Deferred:** `pnpm install` was **not** run this session — the user runs `pnpm setup` to install deps + start infra + migrate + seed. Nothing paid installed.
- **Deferred:** `Prisma` migrations not generated yet (waiting for prompt 01 to finalize the full schema). Scaffold schema covers Faculty / Department / Program / User / AuditLog / AiInference per prompt 00 spec.
