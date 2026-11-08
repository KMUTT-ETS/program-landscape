# CLAUDE.md

> This file is read by Claude Code at the start of every session. It is the source of truth for how this project is built. Keep it current.

## Project: Program Landscape — KKU Curriculum Intelligence Platform

A strategic decision-support web application for Khon Kaen University Council and top management. Analyzes 297 academic programs against future trends, financial sustainability, and labor market demand.

**Naming — the canonical product name is "Program Landscape — KKU Curriculum Intelligence Platform"** (short form: *Program Landscape*). Three earlier names are **retired and must never appear in user-facing text, AI output, or documentation**: *Curriculum Compass* and *ทักษทัศน์* (both former internal codenames — ทักษทัศน์ is not a meaningful Thai word), and *KKU Curriculum Landscape* (the former title). They are recorded here only so nobody reintroduces them.

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
- **Analysis content** (AI narratives, briefs, summaries, recommendations): **English-only** per `docs/prompt-standard.md` — reversed from Thai-primary on 2026-08-16; Thai survives only in the standard's exemption list (product-data fields)
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
- ❌ Do NOT enable `ENABLE_LOCAL_AUTH` in production — `assertLocalAuthSafe()` crashes the deploy if you do. What it protects is the shared `DEV_AUTH_PASSWORD` fallback, which opens **any** account with no stored password hash, and SSO-provisioned users never have one. A password login against a **stored hash** is permitted in production and is how a new installation's first admin signs in before its SSO exists (see `passwordMatches()` and the first-run setup entry in the decisions log). Never widen that fallback to cover hashless accounts.
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
pnpm db:seed     # generic reference seed without dropping (KKU dev data: pnpm db:seed:kku)
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
- `docs/superpowers/notes/decisions-log.md` — full status history and decisions log (moved out of this file 2026-11-07)

## Documentation site (`apps/docs-site`)

The docs site (VitePress) has no content of its own. It renders `docs/**/*.md` plus a few root files copied by `gather.ts`; the allow/deny lists live in `apps/docs-site/src/manifest.ts` (`EXCLUDED`, `GATHERED`). **Every code change must be checked for docs impact before it is called done:**

- **Behaviour, API, methodology, connector, data-source or deploy-procedure change** → update the matching page under `docs/` (e.g. `docs/methodologies/`, `docs/data-sources/<slug>.md`, `DEPLOYMENT.md`) in the same commit. Never edit `docs/_generated/` (gitignored output).
- **New doc file** → check `manifest.ts`: it is rendered unless listed in `EXCLUDED`. Working notes (specs, plans) go under `docs/superpowers/`, which is excluded.
- **Renamed or moved doc** → fix inbound links; `pnpm docs:build` runs `check-site.ts` and fails on dead links and on retired product names (allowlist in `manifest.ts`).
- If nothing needs updating, say so in the commit or PR description ("docs: no impact").
- Run `pnpm docs:build` when `docs/`, `manifest.ts` or a gathered file changed.
- **Thai twins live at `docs/th/<same path>`** (served as the `th` locale) and are listed in `BILINGUAL_PAGES`. Each twin mirrors its English page's `##`/`###` headings and code blocks, and the two link each other near the top.
- **Not rendered on purpose:** `CLAUDE.md`, `DEPLOYMENT.md` and KKU-only pages (KKU SSO, network integration, production infrastructure, rollout plan, chatbot tests, JobThai acknowledgement, admin runbook). The site is for adopting institutions; links to these render as repository links.
- **Page shape:** every page under `tutorials/`, `guides/` and `workshop/` (both languages; READMEs, workshop troubleshooting and facilitator excepted) needs a `**Outcome.**` / `**ผลลัพธ์**` line in its first 20 lines and a `## Next step` / `## ขั้นต่อไป` section. `check-site.ts` enforces it.
- **Sidebar** (`apps/docs-site/.vitepress/sidebar.ts`) has six groups in reading order: Start, Tutorials, Workshop, Guides, Concepts, Reference. Data-source specs are grouped by tier read from `packages/shared/src/ingestion/catalog.ts`.

## Current status

> **Update after every major session — one or two lines per item here, full detail in `docs/superpowers/notes/decisions-log.md`** (newest first under "Recent decisions"). Keep this file under ~40k characters; the log is where history goes. The log holds the measured figures, run orders, prod post-deploy steps and open questions for every item below — read the matching entry before touching that area.

**Production runs v2.1.4** (deployed by 2026-10-10).

**Build prompts 00–13b: complete** (2026-04-22 → 04-24) — bootstrap, data model, auth/API, design system, PDF generation, ingestion, PDF intake, AI, Cockpit, Deep-Dive, Trends, Gap Analyzer, Scenarios, Benchmarking, AI Analyst, Decision Workspace, hardening, pack-and-ship deploy. Storybook deferred.

**In progress**
- [~] **Prompt 14: real data integration** — one connector per session via `prompts/14-integration-session-template.md`; mode flags `CONNECTOR_MODE` / `CONNECTOR_<SLUG>_MODE` (`packages/shared/src/ingestion/connector-mode.ts`). Real: `kku-registry`, `kku-hr`, `kku-finance`, `kku-research` (v2: internal kku-publications mirror), `kmitl-skill-mapping`, `kku-research-services`; `job-108` (government job announcements) is built — check the log for its deploy state. Deprecated: `jobthai`/`jobsdb` feeds, `scopus`, `openalex`. Cost-allocation methodology still v0 (not Council-ready).
- [~] **Adopter-ready Program Deep-Dive** — branch `feat/generic-adoptor`, plans 1–6 done 2026-11-04, NOT merged/released. Another university (tested: KMUTT) runs the Deep-Dive from XLSX + public connectors (`tcas`, `un-wpp`, `kmitl-skill-mapping`, `openalex-works`) + curriculum PDF. Setup checklist at `/admin/programs/<id>?tab=checklist`; `health-score.v5.6`. KMUTT verified 47/48. Write-up `docs/superpowers/notes/2026-11-03-kmutt-e2e-verification.md`. Run `pnpm skills:normalise --source=linkedin --auto-promote` once after the KMITL connector.
- [~] **Adopter docs site reorganised** — branch `feat/doc-reorganzize-2` (2026-11-07), merged into `feat/generic-adoptor`; NOT merged to main. Adopter guide split into a hub + 15 task pages (EN/TH); Thai under `docs/th/`; six sidebar groups; KKU-only pages, `CLAUDE.md`, `DEPLOYMENT.md` off the site. Plan `docs/superpowers/plans/2026-11-07-docs-site-reorganisation.md`.
- [~] **Adopter workshop docs** (~2026-11-21 workshop) — bilingual `docs/workshop/`; participants load their own data or a `pnpm workshop:mock` set (the committed *Workshop Demo University* sample data and rehearsal track were removed 2026-11-08). PENDING: sessions 4–5, mock API, reference solution, real-key sample run, clean-laptop dry run.
- [~] **Institute XLSX import** — 16 declaration-driven datasets (`packages/db/src/import/datasets/`), branch `feat/institute-xlsx-import`, NOT merged. Adopter guide `docs/data-import.md`.
- **First-run setup wizard** (`/setup`, same branch) — first visitor claims `SUPER_ADMIN`; closed by admin-exists OR `system_settings.setup.completed`. Open-claim risk accepted by owner.

**Shipped (newest first)** — v2.1.4 deploy reliability (absolute compose secret paths) · v2.1.3 postgres image build fix · v2.1.2 Landscape atlas (`landscape-atlas.v1`) · v2.1.1 reliability (`embedWithRetry`, self-hosted fonts) · v2.1.0 Programme overlap (`program-overlap.v1`; Telecom↔Electrical pair UNCONFIRMED — don't show Council) · v2.0.x research-service grants + Staff Profile API + Google Scholar fetch + demand-first Gap Analyzer (`gap-map`, v1.9.7; job-108 joins JobThai as `gap-map.v2`).

## Standing traps and rules (distilled from the decisions log)

**Data visibility — the silent-empty-UI family**
- `realDataWhere()` requires a non-null `ingestion_run_id` whose `DataSource.mocked = false` (independent of `status`). An empty section with SQL-visible rows is almost always one of these. Every XLSX dataset needs its `xlsx-<slug>` catalogue entry; `pnpm data-sources:sync --apply` fixes a drifted dev DB (an api e2e failure naming a missing `xlsx-*` source is this).
- `IS_CANONICAL_PROGRAM` keys on `sequenceNoFromSheet IS NOT NULL`. Imported class offerings need `registryFacultyName` or faculty-scoped users can't see them.
- Health-score null rule: missing metrics are excluded from averages, never 0 or 50. Same for gap-map `supply-unknown`.

**Methodology versions** — a version names the formula a *published* figure used. Bump on any formula change after release; never edit a published prompt version in place.

**Database safety**
- `prisma migrate diff --from-migrations --shadow-database-url` RESETS its target — it wiped dev on 2026-09-08. Shadow DB is only `program_landscape_shadow`. Safe forms: `--from-empty` / `--from-schema-datasource`, then `prisma migrate deploy`.
- `.claude/settings.json` guard (`scripts/dev-guard/db-destructive-guard.py`) denies destructive DB commands, even when a command only *mentions* them. Hand blocked commands to the operator; commit with `git commit -F <file>`.
- Never print `.env` lines (`cut -d= -f1 .env` for names). Quote any `.env` value containing `#`.
- Restores: `pg_restore --no-owner --no-acl` without `--clean` (postgis extensions make it exit 1). Probe throwaway postgres readiness over TCP, not the socket; first boot ~80 s.

**Dev process**
- `nest start --watch` only watches `apps/api/src` — edits to `packages/*` leave the api stale. Check process start time; use `ss -ltnp` to find what is listening. Never `pkill -f "pnpm dev"`.
- Each app needs the root `.env` linked (`pnpm link-env`); Next's Edge middleware otherwise has no `NEXTAUTH_SECRET`.
- Server actions return HTTP 200 on failure — read the api log, not the web log.
- Never run `pnpm setup` / `db:up` with overridden ports — compose recreates the shared dev postgres/redis.
- Tailwind: only `border-subtle|default|strong|transparent` border colours emit CSS (~800 `border-border-*` uses render nothing); `text-danger-default`/`text-warning-default` emit nothing. Use an arbitrary value wrapping the token var.
- A narrowed vitest `include` silently drops tests — compare file/test counts, not just the pass line.
- Mocked `fetch`/`queue.add` hide real-API constraints (ScrapingBee's required `custom_google`, BullMQ ids can't contain `:`). Assert on the outgoing request.
- A timed-out probe is not a negative result.

**Build, release, deploy**
- Bundle is `.tar.zst` (`pnpm build:release <ver>`); both machines need `zstd`. Commits landing mid-build reach only some images — restart the build. `docker builder prune -af` afterwards.
- Never reintroduce `next/font/google` (fetches at build time). Fonts live in `apps/web/public/fonts/`.
- Node must be ≥24.22.1 (Node2Shell, 2026-11-07). The ingestion runner overwrites the Playwright image's bundled `/usr/bin/node` and gates the version — re-check on every `PLAYWRIGHT_VERSION` bump.
- `infra/postgres/Dockerfile` stays on bullseye with pinned digest + pgvector 0.8.6 from `apt-archive.postgresql.org`; never move to bookworm (collation change).
- Compose secrets must be absolute `/opt/program-landscape/secrets/…`. Ingestion runs as UID 1010. Worker-spawned scripts are esbuild-bundled (`apps/ingestion/scripts/bundle-pipeline-scripts.ts`) — add new spawn targets there.
- `docker compose exec -T` waits for stdin — pass `</dev/null` when run by hand. After a failed `compose up`, finish with `docker compose up -d --remove-orphans` then `smoke-test.sh`.
- Run the bundle's `scripts/dr/verify-backup.sh` before deploying (preflight gate 6). Backup timers are installed by hand (DEPLOYMENT.md first-boot step 7). No SSH keys to prod — hand commands to the operator.
- `AI_GOOGLE_EMBEDDING_MODEL` (env only, `gemini-embedding-001`) drives every `embed()` whenever a Google key is set; admin overrides don't apply. OpenRouter-only installs use `AI_OPENROUTER_EMBEDDING_MODEL` (must be 1536-dim).

**AI cost and data quirks**
- `gemini-3.8-flash` is missing from `PRICING` (`packages/shared/src/ai/providers/google-ai.ts`) and the pricing store loads asynchronously, so short CLI runs log $0. Derive costs from tokens × catalogue rate.
- `kmitl_skill_growths` keeps superseded snapshots — read only the newest capture. The 2026-09-14 capture has no Thailand rows.
- Linked `tcas_admission_stats` rows are round 3 only; count each course code once per year.
- `FinancialMetric.fiscalYear` actually holds an academic year. Registry/HR years are Buddhist Era (CE + 543).
- Gap-map field verdicts must NOT feed the health score (recursive, wrong unit, orthogonal). Approve narrow job fields first; the field cap is a backstop.
- Scholar rows have no `ingestion_run_id`, so most Council roll-ups exclude them — an open decision. The merge never deletes (CI gate `scholar-no-delete`).
- Two leaked credentials still need rotating: `KMITL_SKILL_MAPPING_SECRET_KEY`, `SCRAPINGBEE_API_KEY`.
- Known pre-existing failures on this dev box: `usage-action-coverage.test.ts` ×4, `gap-map.test.ts` ×5 (no metric data), `usage-queries.test.ts` after a user deletion, time-of-day-flaky `usage-retention.test.ts`.
