# Adopter Guide — Program Landscape

**For a developer or small development team at a Thai university that has just been granted access to this repository and has never seen the codebase before.**

This document is your path *through* the existing documentation, not a replacement for it. Where `docs/` already covers something properly, this guide points at it and tells you what to read it for.

> **ภาษาไทย:** มีฉบับภาษาไทยของคู่มือนี้ที่ [`README.th.md`](./README.th.md)

Written 2026-08-27 against the `main` branch. Where a claim below could drift, the file path is given so you can re-verify it against the code you actually received.

---

## Table of contents

1. [Read this first](#1-read-this-first)
2. [Licence — CC BY-NC-SA 4.0](#2-licence--cc-by-nc-sa-40)
3. [What the platform actually is](#3-what-the-platform-actually-is)
4. [Getting access, forking, and taking future upstream fixes](#4-getting-access-forking-and-taking-future-upstream-fixes)
5. [First run — clone to a working local instance](#5-first-run--clone-to-a-working-local-instance)
6. [How the codebase is laid out](#6-how-the-codebase-is-laid-out)
7. [Configuration and environment](#7-configuration-and-environment)
8. [Data integration — the four tiers of adoption effort](#8-data-integration--the-four-tiers-of-adoption-effort)
9. [The connector contract, and how to write one](#9-the-connector-contract-and-how-to-write-one)
10. [Programme documents and the AI digest pipeline](#10-programme-documents-and-the-ai-digest-pipeline)
11. [Branding and UI adaptation](#11-branding-and-ui-adaptation)
12. [Methodologies — adapting the scoring to your institution](#12-methodologies--adapting-the-scoring-to-your-institution)
13. [The AI layer](#13-the-ai-layer)
14. [Traps that will cost you days](#14-traps-that-will-cost-you-days)
15. [Testing and CI](#15-testing-and-ci)
16. [Deployment and infrastructure sizing](#16-deployment-and-infrastructure-sizing)
17. [PDPA and governance](#17-pdpa-and-governance)
18. [Extending the platform with Claude Code](#18-extending-the-platform-with-claude-code)
19. [What you are NOT getting](#19-what-you-are-not-getting)
20. [Suggested order of work, with effort estimates](#20-suggested-order-of-work-with-effort-estimates)
21. [Appendix — documentation map](#21-appendix--documentation-map)

---

## 1. Read this first

**The single most useful fact for a Thai university adopting this platform:** four of the connectors read **MHESI UniCon national-standard datasets** — the same datasets your institution already submits to the Ministry, in the same schema. Those four are near drop-in. Change the host and database name; do not change the table structure.

| Connector | Dataset | What it carries |
|---|---|---|
| `unicon-ds1001` | DS1001 | Student information, one row per (student × academic year × semester) |
| `unicon-ds2001` | DS2001 | Staff master record — rank, contract, funding source, lifecycle |
| `unicon-ds2003` | DS2003 | Education qualifications of all employees |
| `unicon-ds2004` | DS2004 | Academic staff per programme (curriculum committee membership) |

Verify by reading the header comment of `apps/ingestion/src/connectors/sources/unicon-ds2001/connector.ts` — the source URL, the exact column projection, and the PDPA handling are all documented in the file.

Everything institution-specific — the registrar warehouse, HR, finance, course evaluations, digital-competency scores — is bespoke to KKU's systems and needs rewriting against your equivalents. [Chapter 8](#8-data-integration--the-four-tiers-of-adoption-effort) sorts all 39 catalogued sources into tiers by how much work each one is.

**You do not have to write those connectors before you see results.** Sixteen datasets can be uploaded as Excel spreadsheets from `/admin/data-setup`: your faculties, departments and programmes, then enrolment, finance, graduate outcomes, cohorts, admissions, staff, compensation, budgets, publications, class offerings, programme teaching teams and programme course lists. No code edits are needed. An upload produces the same provenance-stamped rows a connector would, so the dashboards treat both the same way. Most adopters should start there and write connectors later, to automate whatever they find themselves re-uploading. [Importing from spreadsheets](../data-import.md) is the guide.

**Three things to internalise before you start:**

- This is a **decision-support system for high-stakes decisions** — programme closures, mergers, faculty livelihoods. The codebase is built around provenance, audit logging, methodology versioning, and confidence disclosure. Those are not decorations; if you strip them out you have a dashboard that nobody in your Council will trust.
- **There is no mock-data escape hatch by policy.** The project rule is that blocked data sources stay *empty*, not faked. Empty sections render an explicit "no data — run this connector" state. Resist the urge to seed plausible numbers; the whole provenance chain (see [`realDataWhere()`](#trap-2-realdatawhere--empty-sections-with-rows-in-the-database)) is designed to catch exactly that.
- **The code is released under CC BY-NC-SA 4.0, which carries real obligations** — attribution, ShareAlike, non-commercial use — and does *not* license KKU's trademarks, the dependency tree, or any KKU data. Read the next chapter before you do anything public with this code.

---

## 2. Licence — CC BY-NC-SA 4.0

The repository's `LICENSE` file is **Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International (CC BY-NC-SA 4.0)**, with a Khon Kaen University header in front of the verbatim legal code. Copyright © 2026 Khon Kaen University.

**What that means for you, in four obligations:**

- **Attribute.** Credit KKU, name the licence, and link to it, in your repository, your documentation, and any user-visible about/credits screen. The `LICENSE` header gives you the exact string to paste — use it rather than inventing wording.
- **ShareAlike.** If you adapt the work, your adaptation goes out under CC BY-NC-SA 4.0 too, and you must say what you changed.
- **NonCommercial.** You may not use the work primarily for commercial advantage or monetary compensation. What that means for a university is genuinely ambiguous — see below.
- **Leave the notices intact.** Keep the copyright notice, the attribution notice, and the licence notice in anything you redistribute.

**Three things the licence does NOT give you, each of which will catch someone on your team:**

- **KKU's marks are not licensed.** "Khon Kaen University", "มหาวิทยาลัยขอนแก่น", "KKU", the crest, and the logo files in `apps/web/public/brand/` are expressly reserved. Copyright licences do not grant trademark rights, and CC's Section 2(b)(2) says so explicitly. You must remove or replace them in your deployment — [chapter 11](#11-branding-and-ui-adaptation) is the checklist, and roughly 101 files under `apps/web` mention KKU by name.
- **The dependency tree is not licensed by KKU.** `node_modules`, container base images, and fonts carry their own terms. TH Sarabun New in particular is not in the repository and has its own conditions. Audit before you redistribute.
- **No KKU data comes with the code.** The 297-programme catalogue, student and staff records, and every evaluation result derived from them are outside this release entirely. [Chapter 19](#19-what-you-are-not-getting) is the full list.

**On "NonCommercial", read this before you assume.** The term is not defined precisely enough for a university context, and your institution does things that sit near the line: tuition-funded operations, contract research, executive education, paid short courses, spin-offs. KKU has not yet published its own interpretation of the term for this work. **If your intended use is anywhere near that line, get it in writing from KKU's licensing contact before you build on it** — the licensing contact is named at the end of `LICENSE`.

**For your legal office, and KKU's.** CC BY-NC-SA is a *content* licence being used for software. Creative Commons themselves recommend against that. The consequences — no patent grant, no corresponding-source obligation, an undefined ShareAlike boundary for linking, and the NonCommercial ambiguity above — are set out with recommended mitigations in [`docs/licensing.md`](../licensing.md). That document is engineering guidance, not legal advice; treat it as the briefing note you hand your counsel, not the answer.

---

## 3. What the platform actually is

Program Landscape analyses an entire academic programme portfolio — at KKU, 297 programmes — against future skill demand, financial sustainability, demographic pressure, and peer benchmarks, and presents the result to a University Council in a form defensible enough to close a programme on.

**Eight modules** (all live):

| # | Module | What it answers |
|---|---|---|
| 1 | Portfolio Overview Cockpit | Health heatmap, BCG matrix, rollup tree |
| 2 | Program Deep-Dive | Per-programme shareable scorecard |
| 3 | Future Trends Radar | AI-curated external signal feed |
| 4 | Demand-Supply Gap Analyzer | Labour-market demand vs. graduate production |
| 5 | Strategic Scenario Planner | What-if simulation (sunset, merge, launch, reshape, rebalance) |
| 6 | Competitive Benchmarking | Peer comparison, white-space detection |
| 7 | AI Analyst | Conversational tool-use interface over the same data |
| 8 | Decision Workspace | Decision capture, approvals, outcome review |

**Every analytical surface works at four scopes** — university, faculty, department, programme — with scope in the URL (`?scope=faculty&scopeId=<id>`) so any view is shareable. This is a hard architectural rule, not a convention; see `CLAUDE.md` § *Multi-level analytical scope*.

**Stack**, verified against `package.json` and the workspace manifests:

| Layer | Choice |
|---|---|
| Frontend | Next.js 14 App Router, TypeScript strict (no `any`), Tailwind, shadcn-derived UI, Recharts + inline SVG |
| Backend | NestJS |
| Database | PostgreSQL 16 with `postgis`, `pgvector`, `pg_trgm`, `btree_gin` |
| ORM | Prisma (106 migrations as shipped) |
| Cache / queue | Redis + BullMQ |
| Object storage | MinIO (S3-compatible) |
| PDF output | Gotenberg (headless Chromium) with TH Sarabun New embedded |
| Auth | `next-auth` v5, OIDC SSO; local credentials **dev-only, hard-fails in production** |
| AI | `AiService` abstraction over Google Gemini / Anthropic Claude |
| Tests | Vitest (118 test files, ~1,400 `it()`/`test()` cases), Playwright for e2e |
| Monorepo | pnpm workspaces — `apps/{web,api,ingestion}`, `packages/{shared,db,ui,design,pdf-templates}` |

For architecture beyond this table, read `docs/architecture.md`. For how the scoring modules interlock, `docs/evaluation-pipeline.md` is the cross-module map and is the single most useful document before you change anything that touches more than one module.

---

## 4. Getting access, forking, and taking future upstream fixes

### Access

The canonical repository is `https://github.com/khon-kaen-university/program-landscape`. Access is granted by KKU's Office of the Vice President for Education and Digital. You will receive the repository only — no credentials, no data, no fonts (see [chapter 19](#19-what-you-are-not-getting)).

### Fork, don't diverge

Adopt as a **git fork with `upstream` configured**, not as a one-time copy. You will want KKU's bug fixes; the codebase is still under active development, and several subsystems (the prompt standard, the health-score methodology, the data-quality provenance chain) have moved substantially in the last few months.

```bash
git clone git@github.com:<your-university>/program-landscape.git
cd program-landscape
git remote add upstream https://github.com/khon-kaen-university/program-landscape.git
git fetch upstream
```

### Structure your changes so merges stay cheap

The single biggest determinant of whether you can still merge upstream in a year is **where you put your institution-specific code**. Recommendations, in descending order of payoff:

| Change type | Do this | Not this |
|---|---|---|
| Your connectors | New directories under `apps/ingestion/src/connectors/sources/<your-slug>/`, added as new `SOURCE_CATALOG` entries and new registry rows | Editing KKU's connector files in place |
| Your faculty/department/programme data | Spreadsheet upload at `/admin/data-setup` — it lives in your database, not your fork. See [Importing from spreadsheets](../data-import.md) | Editing KKU's faculty array in `packages/db/prisma/seed.ts` |
| Branding | Replace asset files and token *values*; keep token *names* | Renaming tokens or restructuring `tailwind-preset.ts` |
| Methodology weights | Bump the version constant and add your variant alongside; see [chapter 12](#12-methodologies--adapting-the-scoring-to-your-institution) | Editing the KKU formula in place |
| Your `CLAUDE.md` | Rewrite freely — this file is *meant* to diverge | — |

Files you should expect to conflict on every merge, and should therefore keep your edits in as few hunks as possible:

- `packages/shared/src/ingestion/catalog.ts` (append your entries at the end of the array)
- `apps/ingestion/src/connectors/registry.ts` (same)
- `packages/db/prisma/seed.ts`
- `packages/design/src/tokens/*.ts`
- `.env.example`

### Migrations will conflict, and that is the sharp edge

Prisma migrations are timestamp-named directories under `packages/db/prisma/migrations/`. If you add a migration and KKU adds a migration, both apply — but if you both edit the *same table*, you will have to reconcile by hand. Two mitigations:

- Prefix your migration names distinctly (`20260901120000_yourthuni_registrar_bridge`) so the history is readable.
- Prefer **additive** schema changes (new nullable columns, new tables) over altering KKU's. The repo already has this policy for itself; see `docs/migration-policy.md`, and note `scripts/migration-linter.ts`, which CI runs to flag destructive DDL.

### A merge cadence that works

Merge upstream **quarterly, not continuously**. Continuous merging means you re-litigate the same conflicts weekly. Quarterly means you read the intervening `docs/` changes and the `/changelog` page (`apps/web/app/changelog/page.tsx` is the authoritative release history — CLAUDE.md's log is explicitly best-effort and has known gaps) and make one deliberate pass.

---

## 5. First run — clone to a working local instance

**Target:** the app running at `http://localhost:3000` with an empty-but-valid database, on your own machine. Budget half a day the first time.

### Prerequisites

- Node 20+ (`.nvmrc` pins the version), pnpm 9+ (the repo declares `pnpm@10.33.1` as its packageManager)
- Docker + Docker Compose v2
- Linux, macOS, or Windows with WSL2 (Ubuntu). KKU's primary dev machine is Windows/WSL2; `prompts/WINDOWS-DEV.md` covers that setup. There is deliberately **no Makefile** — everything is a pnpm script.

### Sequence

```bash
# 1. Environment file. Start from the example and fill in what you have.
cp .env.example .env

# 2. Full setup — installs deps, links .env into each app, starts
#    postgres/redis/minio/gotenberg, runs migrations, registers data sources.
pnpm setup

# 3. Run all three services in parallel.
pnpm dev
```

`pnpm setup` expands to `pnpm install && node scripts/link-env.mjs && pnpm db:generate && pnpm db:up && pnpm minio:init && pnpm db:migrate && pnpm data-sources:sync --apply && pnpm db:seed:reference`. If any step fails, run them individually to isolate it.

**`pnpm setup` runs only the generic reference seed.** `pnpm db:seed:reference` (also what `pnpm db:seed` runs) loads Thai policy sectors, a neutral cost-method placeholder and the external report list. It loads no KKU data. `pnpm db:seed:kku` is KKU's own development seed (faculties, departments, demo accounts, synthetic skills): never run it for an adopting installation. Before the seed, `pnpm data-sources:sync --apply` registers one `data_sources` row per catalogued source and import dataset, with schedules off. Without those rows every upload is refused, because rows with no recorded source would be hidden by [`realDataWhere()`](#trap-2-realdatawhere--empty-sections-with-rows-in-the-database). Both steps are idempotent and never delete anything. Production deploys run the sync step (`deploy.sh`).

Once running:

| URL | What |
|---|---|
| `http://localhost:3000` | Web (Next.js) |
| `http://localhost:4000/api/v1/healthz` | API liveness |
| `http://localhost:4000/api/v1/ready` | API dependency health — probes Postgres, Redis, MinIO, Gotenberg, AI provider |
| `http://localhost:9001` | MinIO console |
| `http://localhost:3001` | Gotenberg |

### Signing in on day one

Open `http://localhost:3000`. A database with no administrator redirects to **`/setup`**, which asks for a name, an email and a password and creates the first `SUPER_ADMIN`. Sign in with that email and password. Every later account comes from that one. The same page is how a production installation gets its first administrator, so `DEPLOYMENT.md` covers it too.

`/setup` is unauthenticated: whoever submits it first owns the installation. It closes permanently on first use. Claim it as soon as the stack is up, and especially on any server others can reach. The password form is hidden once SSO is configured; `/signin?password=1` brings it back.

`ENABLE_LOCAL_AUTH=true` with `DEV_AUTH_PASSWORD` is a separate, development-only mechanism. It opens any account with no stored password, which only matters if you ran `pnpm db:seed:kku` and want to sign in as KKU's seeded demo users. It is guarded: `assertLocalAuthSafe()` throws at module load if `ENABLE_LOCAL_AUTH=true` while `NODE_ENV=production`, so you cannot ship it by accident.

Wiring your own university SSO is a separate task; `docs/auth/kku-sso.md` documents KKU's OIDC configuration as a worked example of the shape you need.

### What "working" looks like at this stage

Every analytical surface will be **empty**, and that is correct. A fresh installation has no faculties, programmes, students, staff or financial data, because that data is yours. It has no skill taxonomy either, so every skill figure reads 0 until you [build one](#building-your-skill-taxonomy). Empty sections render an explicit empty state. If you see fabricated-looking numbers, something is wrong.

The fastest way to fill it is the spreadsheet import. Upload faculties, departments and programmes from `/admin/data-setup`, then whichever metric datasets you hold. [Importing from spreadsheets](../data-import.md) gives the order, and [Get Program Deep-Dive working](../tutorials/program-deep-dive.md) walks through one programme end to end.

### If the app compiles but every protected route bounces you to `/signin`

This is the single most common first-day failure. See [Trap 4](#trap-4-per-app-env-files-and-the-silent-edge-middleware-failure).

---

## 6. How the codebase is laid out

```
apps/
  web/         Next.js 14 App Router — all UI. Server components by default.
  api/         NestJS — REST API at /api/v1, RBAC, audit logging, PDF service.
  ingestion/   NestJS standalone — BullMQ workers, connectors, one-shot scripts.

packages/
  shared/      Zod schemas, AI service + prompts, RBAC, connector contract,
               source catalog, scenario engine, forecasting. No DB imports.
  db/          Prisma schema + migrations + every scope-aware query helper and
               scoring methodology. This is where the analytics actually live.
  ui/          Component library — charts, viz primitives, council-readiness
               widgets (ProvenanceButton, ConfidenceBadge, FreshnessBadge).
  design/      Design tokens (OKLCH) + the Tailwind preset. Read chapter 11.
  pdf-templates/  React components rendered to HTML, then to PDF by Gotenberg.

docs/          See the appendix for the full map.
prompts/       The original Claude Code build manual. See chapter 18.
infra/         Docker build contexts — postgres (with extensions), gotenberg,
               nginx, systemd units.
scripts/       Release build, deploy, backup, restore, rollback, smoke test,
               env linking, migration linting.
```

### Two orientation rules that save time

**`packages/db/src/` is the analytical heart, not `apps/api/`.** The API layer is thin. Health scoring, risk scoring, gap analysis, benchmarking, the deep-dive queries, the data-quality provenance filter — all of it is in `packages/db/src/*.ts` as explicitly-typed exported functions. When you want to know "how is this number computed", start there, not in a controller.

**`packages/shared/` must never import `packages/db/`.** The dependency runs one way (`db` depends on `shared`). If you need a Prisma-backed implementation of a `shared` interface, the concrete class lives in `db` and is injected — `packages/db/src/ai-inference-recorder.ts` is the canonical example of this pattern.

### The Council-readiness rules

Six rules apply to every module, endpoint, and UI surface. They are listed in `CLAUDE.md` and audited by the twelve gates in `docs/readiness-checklist.md`:

1. `<ProvenanceButton>` on every chart — opens a drawer with sources, freshness, calculation method, methodology version, caveats.
2. `<ConfidenceBadge>` plus clickable sources plus a "disagree" affordance on every AI output.
3. `<FreshnessBadge>` on every data point.
4. `@AuditLog()` on every mutation (`apps/api/src/common/decorators.ts`).
5. `@AiCall()` on every AI call (same file).
6. Every metric carries a `methodologyVersion`, and the methodology doc is versioned in git under `docs/methodologies/`.

If you are adding a surface and it does not have these, it is not finished. This is what makes the output defensible in a Council meeting, and it is the part of the codebase most tempting to skip and most expensive to retrofit.

---

## 7. Configuration and environment

`.env.example` carries **104 uncommented keys** (plus ~20 commented optional ones); `.env.prod.example` carries more, with production-specific guidance in comments. Read both. Neither is a checklist you must complete — most keys are per-connector credentials you will not need until you wire that connector.

### The env keys that actually matter on day one

| Key | Note |
|---|---|
| `DATABASE_URL` | Must agree with `POSTGRES_*`; the release does not auto-splice them |
| `NEXTAUTH_SECRET` | Required. Missing → silent auth failure, see Trap 4 |
| `NEXTAUTH_URL`, `AUTH_TRUST_HOST` | Set to your public URL in production |
| `ENABLE_LOCAL_AUTH`, `DEV_AUTH_PASSWORD` | Dev sign-in. Hard-fails in production |
| `AI_PROVIDER` | `google` (default) / `anthropic` / `openrouter` / `stub`. Tool-use (AI Analyst) requires `anthropic` |
| `GOOGLE_AI_API_KEY` / `ANTHROPIC_API_KEY` / `OPENROUTER_API_KEY` | The key for your provider; `stub` works without any. Keep a Google key alongside the others: embeddings always go to Google |
| `CONNECTOR_MODE` | Global default connector mode. Leave at `mocked` initially |
| *(none — moved)* | Institution identity is set in the app at **/admin/organization** (names, short names, region, contact email, public URL). The Thai name must match the TCAS สถาบัน column exactly; the form checks it for you. |
| `MINIO_*`, `REDIS_*`, `GOTENBERG_URL` | Local defaults in `.env.example` work with `pnpm db:up` |

Brand colours and logos are set on the **Brand** tab of the same page (`/admin/organization?tab=brand`). The app derives light and dark shades from your two colours and checks they stay readable.

**Known gaps in `.env.example` you will hit.** `UNICON_DS2001_DB_*` and `UNICON_DS1001_DB_*` are documented in `.env.prod.example` but **absent from `.env.example`**. When a connector reports missing config, check `.env.prod.example` and `configFromEnv('<PREFIX>')` in the connector before assuming the key does not exist.

> `AI_PROVIDER` and `GOOGLE_AI_API_KEY` used to be missing here too; that gap is fixed. `.env.example` now ships `AI_PROVIDER=stub`, which is what lets `api` and `ingestion` boot without an LLM key (the code default, `google`, crashes both at boot when `GOOGLE_AI_API_KEY` is empty).

### Each app needs its own `.env` — this is not optional

Next.js's `@next/env` loads `.env` from the **Next project directory** (`apps/web/`), never from the monorepo root. The same trap hits `apps/api` and `apps/ingestion`.

`scripts/link-env.mjs` (`pnpm link-env`, also part of `pnpm setup`) symlinks the root `.env` into all three app directories and into `packages/db` (the Prisma CLI reads `DATABASE_URL` from `packages/db/.env`). On Windows without Developer Mode it falls back to copying — and a copy **drifts** when you edit the root `.env`, so re-run `pnpm link-env` after every env change on Windows.

The failure mode when this is missing is silent and misleading. See [Trap 4](#trap-4-per-app-env-files-and-the-silent-edge-middleware-failure).

### Secrets in production

Production uses Docker Compose file-based secrets under `/opt/program-landscape/secrets/` (one value per file, mode 0600) for Postgres and MinIO credentials, alongside a root-owned mode-0600 `.env.prod`. `DEPLOYMENT.md` § *One-time server setup* is the authority. Note the documented wrinkle: `DATABASE_URL` in `.env.prod` still embeds the password, so it must be kept in sync with the secret files by hand.

---

## 8. Data integration — the four tiers of adoption effort

This is the chapter that determines your project plan. The source catalog lives at `packages/shared/src/ingestion/catalog.ts` — **39 entries, 5 of them deprecated**. Connector implementations live under `apps/ingestion/src/connectors/sources/`, and the mock↔real routing table is `apps/ingestion/src/connectors/registry.ts`.

The tiers below sort every source by how much work it is *for you*, not by how important it is.

### Tier 1 — Works nearly as-is: the MHESI UniCon DS family

Every Thai university submits the UniCon DS datasets to MHESI in the **same schema**. That means the SQL projections, the column semantics, the Buddhist-era date handling, and the PII treatment in these four connectors transfer directly.

| Slug | Source in KKU's deployment | Rows in KKU snapshot |
|---|---|---|
| `unicon-ds1001` | `mysql://…/reg_unicon.view_ds1001` | 35,406 (AY 2568 sem 2) |
| `unicon-ds2001` | `mysql://…/UNICON_STAFF_KKU.DS2001` | 11,325 |
| `unicon-ds2003` | `mysql://…/UNICON_STAFF_KKU.DS2003` | 18,060 |
| `unicon-ds2004` | `mysql://…/reg_unicon.ds2004_<YYSEM>` | one row per (staff × programme × teach type) |

**What you change:** the connection details, via `UNICON_DS1001_DB_*` / `UNICON_DS2001_DB_*` / `UNICON_DS2003_DB_*` / `UNICON_DS2004_DB_*` env prefixes, consumed through `configFromEnv()` in `apps/ingestion/src/lib/mysql-client.ts`. Note that in KKU's deployment DS1001 deliberately reuses the DS2004 credentials because they are the same MySQL endpoint — check whether that holds at your institution.

**What you will probably still have to touch:**

- **DS2004's table-name convention.** KKU's snapshot tables are named `ds2004_<YYSEM>` using BE last-two-digits plus semester (`682` = AY 2568 semester 2). The connector resolves `MAX(suffix)` at runtime. If your registrar names them differently, that resolution logic changes.
- **Organisational-code resolution.** `unicon-ds2001` maps DS2001's 5-digit `DEPARTMENT_ID` to your `Faculty.id` by joining through `staff_program_assignment.fac_id` (see `buildDeptCodeToFacultyMap()` in that file). This works because DS2004 has already populated that bridge with MHESI faculty codes. If your DS2004 load has not run, DS2001 will load with `facultyId = null` — the connector reports the unresolved-code count in its metadata rather than failing.
- **`CURR_ID` → programme resolution.** DS1001 and DS2004 resolve MHESI curriculum IDs against `Program.mhesiCode` (with a `ProgramMhesiAlias` fallback). You must seed your programmes with their MHESI codes for this to work — see [chapter 10](#10-programme-documents-and-the-ai-digest-pipeline).
- **PII posture.** Each connector's SQL projection is the trust boundary and is documented in the file header — which columns are dropped at projection, which are hashed (`CITIZEN_ID` → `citizenIdHash` via `hashCitizenId()`), which are downcast to year precision. These were DPO-approved at KKU. **Your DPO must approve them independently.** Do not treat KKU's approval as transferable.

**Honest effort estimate:** one to three days per connector if your DS tables are where you expect and you have read access. Most of that time is credentials and network access, not code.

> **Caveat worth knowing:** there is no `docs/data-sources/unicon-*.md` spec file for these four. The per-source spec directory covers the older sources; the UniCon connectors document themselves in their file headers instead. Read the code.

### Tier 2 — Shared national and external sources: same for everyone

These read from sources that are identical regardless of which university you are. They need credentials or an institutional subscription, but not a rewrite.

| Slug | What it is | Your work |
|---|---|---|
| `tcas` | National TCAS admissions data | Configure; the shape is national |
| `kmitl-skill-mapping` | Aggregated skill-demand intelligence via KMITL's institutional-partner API | Request your own client ID + secret key from KMITL |
| `mhesi-cisa` | MHESI CISA | Configure |
| `thailand-demographics` | Thailand youth-cohort projections | Seeded via `pnpm demographics:seed`; national data |
| `world-bank` | World Bank indicators | Public API, works out of the box |
| `mhesi-policy`, `nesdc-reports`, `nxpo-reports`, `boi-sectoral`, `eeco-reports` | Thai policy and sectoral PDF report feeds | Public; already have real connectors |
| `wef-future-of-jobs`, `oecd-reports`, `adb-gms` | International report feeds | Public; already have real connectors |
| `the-rankings`, `qs-rankings`, `scimago`, `imd-rankings` | Ranking datasets | Subscription-gated; your library may already hold them |
| `nso-labor-force`, `tpqi` | National statistics, Thai qualification framework | Configure |

**Two attribution rules that are not negotiable.** KMITL's data is LinkedIn data subscribed by MHESI; KMITL only hosts the API. Never present it to a user as "KMITL data". And the KMITL feed's Thailand × job-postings quadrant is a **thin sample** (161 postings in the observed snapshot against ~950k global LinkedIn profiles) — any Council-facing surface using it must carry a sample-size caveat in its provenance drawer.

**Honest effort estimate:** hours each, mostly waiting on credentials. The `kmitl-skill-mapping` connector is the highest-value one here because it is what lights up the demand side of the Gap Analyzer and the labour-market driver of the health score.

### Tier 3 — Must be rewritten per institution

These read from KKU's own operational systems. The *shape* of what they produce is reusable; the *source* is not.

| Slug | KKU's source | What it feeds |
|---|---|---|
| `kku-registry` | Oracle registrar data warehouse | Enrolment metrics, cohort distributions, student demographics |
| `kku-hr` | MS SQL Server (HCM + `epm_report`) | Faculty members, ranks, compensation aggregates |
| `kku-hr-processed` | Processed HR mirror | Derived staff attributes |
| `kku-finance` | Oracle (tuition) + MS SQL (budget), read in one run | Tuition revenue, faculty budgets |
| `kku-evaluations` | KKU course-evaluation system | Teaching-quality driver of the health score |
| `kku-dq` | KKU digital-competency assessment API | Digital-competency evidence |
| `kku-research` | Internal `kkuscholar` Postgres research mirror (Scopus + PubMed) | Research outputs per faculty member |
| `kku-alumni` | Not yet implemented at KKU either | Graduate outcomes, province-level supply |
| `kku-admission-campaigns`, `kku-tcas-funnel` | KKU admissions systems | Admission funnel |
| `digital-transcript` | KKU digital transcript | Course-level records |

#### Worked example — `kku-dq`, a Tier 3 source whose payload you must not store

`kku-dq` is worth reading before you write your own connector, because it is the cleanest example
in the repo of a source that is useful in aggregate and radioactive per row.

KKU's Digital Intelligence assessment API returns **every student in one response** — about 24,800
records, 13.7 MB, in roughly 3.4 s. No pagination to manage; results only move as students sit the
test, so it runs weekly. The payload carries student first names, surnames and ids.

**None of that reaches the database, the logs, or disk.** Students are resolved to a programme *in
memory*, and the connector writes only two aggregate cubes: one per (faculty × programme × cohort),
one adding a module dimension. This is the same aggregate-at-source posture as `kku-registry` and
`kku-hr`, and it is the posture to copy — it is far easier to defend to a DPO than a per-row table
with an access-control story attached.

Three design decisions in that connector generalise:

- **Store `scoreSum` + `takenCount`, never a stored mean.** That is what makes a faculty or
  university figure a true weighted mean rather than a mean of means. If you store means you cannot
  recover the weighting later.
- **Do not drop what you cannot resolve.** Students who resolve to no programme land under a null
  `programId` that the dashboard renders as "Program not identified". Coverage is cohort-shaped —
  recent intakes resolve well, older ones poorly, because the resolution table is a current
  enrolment snapshot while the export is cumulative. Hiding those rows would have silently shrunk
  every faculty total.
- **`ingestion_run_id` is `onDelete: Restrict`, not nullable.** A cube row that outlives its run is
  unprovenanced, and `realDataWhere()` would silently drop it — see Trap 2. The constraint makes
  that unrepresentable rather than merely discouraged.

**How to approach a Tier 3 rewrite:**

1. Read the KKU connector's file header first. Every one of them documents the discovery process — which tables were probed, which columns turned out to be 100% NULL, which join keys are load-bearing, which collation mismatch bit them. Even where the source differs, the *questions* transfer.
2. Read the matching `docs/data-sources/<slug>.md` spec. These describe endpoint, rate limit, PDPA posture, and known issues.
3. Follow `prompts/14-integration-session-template.md` — see [chapter 9](#9-the-connector-contract-and-how-to-write-one).
4. **Aggregate at source.** The KKU connectors push `GROUP BY` and small-cell suppression (`HAVING COUNT(*) >= 5`) into the SQL so per-person data never crosses the wire. Preserve this. It is the single design decision that makes the PDPA story defensible.

**Honest effort estimate:** one to three weeks per connector, dominated by getting read access to systems whose owners have no reason to give it to you. Start the access conversations before you start the code. `kku-registry` and `kku-hr` are the two with the highest downstream leverage.

**Before you write a Tier 3 connector, check whether a spreadsheet covers it.** Registrar, HR and finance figures each have an import dataset that writes the same tables: enrolment, student and alumni cohorts, admission campaigns, class offerings, staff, compensation, budgets, finance and publications (full list in [Importing from spreadsheets](../data-import.md#what-you-can-import-today)). A term's export, uploaded each term, lights up the cockpit and deep-dive in days rather than weeks. Write the connector when the manual export becomes the bottleneck. Uploads and connector runs can feed the same table. When both write the same row, it stays attributed to the connector, and the connector's next run overwrites the uploaded figures, so don't run both for the same years.

### Tier 4 — Content, not code

Nothing to write; things to supply.

| What | Where it goes |
|---|---|
| Your faculties and departments | Spreadsheet upload at `/admin/data-setup` (*Faculties*, *Departments*). Thai institutions: spell faculty names the way TCAS does, or admission figures will not link |
| Your programme list | Spreadsheet upload (*Programmes*), plus `/admin/programs` for ongoing edits. See [chapter 10](#10-programme-documents-and-the-ai-digest-pipeline) |
| Your programme curriculum PDFs | `pnpm pdf:bulk-load`, or the UI at `/admin/programs/[id]?tab=files` |
| Course lists the PDF pipeline cannot read | Spreadsheet upload (*Programme course lists*). Takes precedence over PDF extraction for the programmes it names |
| Your logos and colours | See [chapter 11](#11-branding-and-ui-adaptation) |
| TH Sarabun New font files | `infra/gotenberg/fonts/` — deliberately not in git |
| Your skill taxonomy | Built from your own data with `pnpm skills:normalise`. A fresh installation has none. See [Building your skill taxonomy](#building-your-skill-taxonomy). Do not use `pnpm db:seed:kku` for it: that loads KKU's data and 500 synthetic placeholder skills |

---

## 9. The connector contract, and how to write one

### The interface

Defined in `packages/shared/src/ingestion/types.ts`. Four methods, invoked in order by the runner:

```
healthCheck(ctx) → HealthStatus          // can we reach the source at all?
fetch(ctx)       → RawRecord[]           // pull, unchanged, from upstream
transform(ctx, raw) → NormalizedRecord[] // map to our schema; 0..n per raw
load(ctx, normalized) → LoadResult       // write, idempotently
```

The three record types:

- `RawRecord` — `{ externalId, data: unknown, sourceTimestamp }`. `externalId` is what dedup keys on across re-runs.
- `NormalizedRecord` — `{ target, externalId, payload, freshnessDate, sourcePdfId? }`. `target` names the destination table.
- `LoadResult` — `{ recordsFetched, recordsLoaded, recordsFailed, metadata }`. The `metadata` blob is surfaced in `/admin/data-sources/<slug>` and is where you put unmapped-code samples, distribution counts, and anything an analyst needs for triage.

### What a real connector looks like

`apps/ingestion/src/connectors/sources/unicon-ds2001/connector.ts` is 310 lines and is the best single file to read. Concretely:

- `healthCheck` opens a connection with `configFromEnv('UNICON_DS2001_DB')` and runs `SELECT 1`, returning the resolved `user@host:port/database` in the message so the admin page shows what it actually connected to.
- `fetch` runs one explicit column projection (the PII trust boundary), then **refuses to proceed on zero rows** — `throw new NonRetryableError('EMPTY_DATA', 'DS2001 returned 0 rows — refusing to wipe')`. This matters because `load` does a snapshot replace; an empty fetch would otherwise delete the whole snapshot. Copy this guard.
- `fetch` also stashes per-run aggregates on `this.runState` (counts by staff type, by nationality, unhashable rows), which end up in `LoadResult.metadata`.
- `transform` hashes `CITIZEN_ID` at the boundary and returns `[]` for rows it cannot key — the unhashable count is tracked rather than silently dropped.
- `load` deletes prior rows for the same `(academicYear, semester)` scope, then inserts in chunks of 1,000 via `createMany`, stamping `ingestionRunId: ctx.runId` on every row. **That stamp is mandatory** — see [Trap 2](#trap-2-realdatawhere--empty-sections-with-rows-in-the-database).

### The mock → real pattern

Every catalog slug has a mock connector. Real implementations are added alongside, never in place of. `apps/ingestion/src/connectors/registry.ts` holds the pair table:

```ts
{
  slug: 'kku-registry',
  mock: () => new KkuRegistryConnector(),
  real: () => new KkuRegistryRealConnector(),
}
```

Mode resolution is in `packages/shared/src/ingestion/connector-mode.ts`, first match wins:

1. `CONNECTOR_<SLUG>_MODE` — slug uppercased, non-alphanumerics to `_` (e.g. `CONNECTOR_KKU_REGISTRY_MODE=real`)
2. `CONNECTOR_MODE` — global default
3. Hard default `mocked`

If a slug is set to `real` but no `real` factory is registered, the registry logs a loud warning and **falls back to the mock** — flipping an env var without writing the class never takes ingestion down.

**Rollback is "set the env back to `mocked`" and restart the worker.** No data migration, no schema change. Preserve this property in every connector you write; it is the reason the readiness checklist's gate 11 can be satisfied at all.

### The per-connector session playbook

`prompts/14-integration-session-template.md` (128 lines) is the existing playbook and you should use it verbatim. Its non-negotiables:

- **One slug per session.** Not two, not half. Two connectors means two sessions, possibly in parallel, never bundled.
- **Pre-session checklist completed by the data owner** before any code: spec filled in beyond the stub, credentials in the target environment's secret store, sample payload committed to `apps/ingestion/test/fixtures/<slug>/` (at minimum one happy path and one edge case), data owner confirms the endpoint is stable, DPO counter-signature if personal data is involved.
- **Exit criterion:** at least **three successful runs** visible in `/admin/data-sources/<slug>` with zero failures across ten attempts, plus a drift fingerprint (row counts and key-field distributions) recorded in the spec.
- **Explicitly out of scope for a connector session:** methodology bumps, materialising into domain tables, and UI changes. Each is a separate session.

Run a connector without going through BullMQ with `pnpm connector:run <slug>` — same code path as the worker, much faster to iterate.

### The `mocked` / `status` flag rule

When you flip a connector to real, the `data_sources` row must have **both** `status` and `mocked` updated, atomically. They are independent columns and `status='real'` does not imply `mocked=false`. Getting this wrong produces an empty UI with rows visibly present in SQL. `pnpm data-sources:audit` exists to catch exactly this drift; run it after every connector flip and after every database reset.

---

## 10. Programme documents and the AI digest pipeline

This is how a stack of curriculum PDFs becomes structured, queryable programme data. It is one of the most valuable parts of the platform and it transfers to your institution almost unchanged.

### The flow

```
Curriculum PDF  →  MinIO + PdfDocument row (content-hash deduped)
                →  AI digest (program-digest.v1)
                →  AiExtraction row: AUTO_APPROVED when its confidence clears
                   AI_AUTO_APPROVE_THRESHOLD (code default 0), else PENDING_REVIEW
                   until a human approves it
                →  materialised onto Program + ProgramSkill rows
                   (ProgramSkill only for names that exactly match the taxonomy)
                →  unmatched skill names → PROPOSED_SKILL extractions
                →  pnpm skills:normalise --source=program_digest → new Skill rows
```

### Commands

| Command | Purpose |
|---|---|
| `pnpm pdf:bulk-load <manifest.jsonl>` | One-time historical backfill. Dry-run by default; `--commit` to actually upload |
| `pnpm programs:digest <code\|mhesi\|seq>` | Digest one programme |
| `pnpm programs:digest-bulk [--limit N] [--level X]` | Bulk, with auto-resume |
| `pnpm programs:approve-pending` | Approve + materialise every digest still `PENDING_REVIEW`. An auto-approved digest was applied when written and is not re-applied |
| `pnpm skills:normalise --source=<linkedin\|program_digest> --auto-promote` | Build the skill taxonomy; see [Building your skill taxonomy](#building-your-skill-taxonomy) |
| `pnpm programs:pipeline <code>` | The full per-programme pipeline (below) |
| `/admin/programs/from-pdf` | The operator-facing submit wizard — new programme *or* revision |
| `/admin/programs/[id]?tab=files` | Attach a PDF through the UI |

Attach PDFs through the UI or `pdf:bulk-load`. KKU previously had a fuzzy filename matcher for linking orphan PDFs to programmes; **it was retired after it mislinked roughly 30 programmes**, which a later content-based audit had to unpick. Do not rebuild it.

### The full pipeline

`pnpm programs:pipeline <code|seq|id>` (or `--all [--limit=N]`) composes what used to be nine hand-run scripts, in dependency order. Read the header of `apps/ingestion/src/scripts/programs-pipeline.ts` for the authoritative version; in summary:

| Phase | What | Notes |
|---|---|---|
| 1 | PDF AI extraction — digest, faculty, skills, pedagogy | Runs in parallel |
| 2 | Approve + materialise digest → `ProgramSkill` | DB only, fast |
| 2b | Focused course-code extraction | Runs in parallel with phase 1. Replaces the digest's truncated course list with the full 40–90. **Skips a programme whose course list was uploaded** via the Programme course lists import |
| 3 | Career mapping, demand matching | Sequential |
| 4 | Institutional data linkage — cohorts, alumni, financials | Parallel; hits your registrar/finance sources |
| 6 | AI readiness assessment | **Executes before phase 5** — both 5 and 7 consume its score |
| 5 | Peer selection + peer review | Sequential |
| RE | Research expertise | **Insert-only**, skip-if-exists; never auto-regenerated |
| CR | Curriculum revision | After RE (reads its output). **Insert-only**, like RE |
| 7 | Strategic narrative | Consumes every prior phase |
| OV | Programme overlap | After 7. When several programmes are processed it is deferred and run once as a batch |
| 8 | Risk analysis | Deterministic maths + narrative |

`--skip=phase4` is the flag you want when your registrar connectors are not wired yet. `--only=phase5` runs one phase.

### Revisions — how a second มคอ.2 lands

The flow above is the *first* import of a curriculum. Once a programme exists, a new มคอ.2 must not
simply overwrite it: analyses that a council saw last month would change underneath them with no
record of why. The revision model exists for that, and it is the part of this pipeline most worth
copying wholesale.

A `ProgramRevision` is a staging container: a มคอ.2 attached to a programme, moving through

```
DRAFT → ANALYSING → IN_REVIEW → APPROVED
                              ↘ REJECTED
(an approved revision later displaced by another) → SUPERSEDED
```

`Program.activeRevisionId` points at the one that is live. Every analysis the pipeline produces —
strategic narrative, AI readiness, pedagogy, peer review, research expertise, skills, courses, the
curriculum-revision comparison — carries a `programRevisionId`, so a programme page renders one
internally consistent curriculum and a superseded revision's outputs stay intact and attributable
instead of being overwritten.

Three things to carry across if you implement this yourself:

- **Metadata is proposed, not applied.** Where a revision's digest disagrees with the programme's
  current column values, `metadataProposalJson` records both the proposed values and the ones they
  would replace, rather than writing through silently. Combined with the digest's skip-if-empty
  semantics, a re-digest can never blank a human-curated field.
- **`programRevisionId` is nullable, and NULL means the pre-feature baseline.** It agrees by
  construction with `Program.activeRevisionId` also being NULL. Do not backfill it with a synthetic
  revision — you would be inventing provenance for rows that predate the concept.
- **The operator decides new-vs-revision at submit time, before upload.** `/admin/programs/from-pdf`
  asks that first, then uploads, then — for a new programme — checks for duplicates by code, name
  and degree before committing. Putting the question first is what makes the duplicate check
  meaningful; asking it after extraction invites the operator to rationalise whatever the AI
  guessed.

The comparison itself (`ProgramCurriculumRevision`) is a separate, purely analytical row: an
AI-generated account of what the new curriculum changes, passed through an **anti-fabrication
validator** that strips claims the source text does not support. It stores its deterministic input
snapshot and the validator's drop counts alongside the payload, so a reader can audit the basis
without recomputing it. Expect it to read as terser and more hedged than a human summary — that is
the validator working, not the model underperforming.

### The prompt

`packages/shared/src/ai/prompts/program-digest.ts`, version `program-digest.v1`. A single call against the full PDF text producing a 15-field structured digest: programme metadata, course list with credits and learning outcomes, all skills the curriculum builds with weights and verbatim evidence quotes, a marketing-ready Thai recruitment summary, career paths, self-rated confidence, and caveats.

Materialisation (`packages/db/src/program-digest-materialize.ts`) uses **skip-if-empty semantics** — a re-digest never overwrites a human-curated value with a blank. Extracted skill names resolve against `Skill.nameEn` (lowercased exact) then `Skill.nameTh` (exact); **no fuzzy matching**. Unmatched names become `PROPOSED_SKILL` extractions. These do **not** become skills by being approved: `pnpm skills:normalise --source=program_digest --auto-promote` is the step that turns them into `Skill` rows, after which the digest has to be re-applied. That is how the taxonomy grows from your curriculum vocabulary; see [Building your skill taxonomy](#building-your-skill-taxonomy).

### What this cost KKU, so you can budget

228 of 297 programmes digested. Roughly **$0.04 per digest, ~$8.10 total** across six retry passes, on Gemini. The remaining 69 programmes had no PDF available — mostly medical specialty programmes and new additions. Expect a similar coverage shortfall and plan a document-acquisition workstream separately from the engineering.

### Building your skill taxonomy

**A fresh installation has no skills at all**: the `skills` table holds 0 rows. Until you build a taxonomy, every skill figure in the product reads 0, including all four cards of the Deep-Dive *Skills coverage* section, however many times you run the pipeline. That is because skill matching is exact. A skill the digest extracts reaches a programme (a `ProgramSkill` row) only when its name equals a taxonomy entry: `Skill.nameEn` compared lowercased, then `Skill.nameTh`. With an empty taxonomy nothing can match.

`pnpm setup` does not load a taxonomy, and `pnpm db:seed:kku` is not the answer. It loads KKU's faculties, departments and accounts along with about 60 real skills and 500 synthetic placeholders. The KMITL connector does not create skills either. It loads skill-demand rows, all with an empty `skill_id`, until a taxonomy exists to link them to.

What builds the taxonomy is `pnpm skills:normalise` (`apps/ingestion/src/scripts/normalise-skill-names.ts`). It sends raw skill names to the AI in batches of 25. The model either matches each name to an existing skill or proposes it as new. A proposal becomes a real `Skill` row only when you pass `--auto-promote` **and** its confidence is at least 0.9. Lower-confidence proposals stay in `skill_aliases` with status `NEW_PROPOSED`, waiting for review. Every decision is also written to `logs/normalise-skills-<timestamp>.jsonl`.

**On a fresh install the pipeline builds the taxonomy for you.** Phase 2 of `pnpm programs:pipeline` checks the programme's stored digest. It acts only on a programme that has no skills yet; a programme with skills is left alone. If the digest's skill names match nothing in the taxonomy, it promotes that programme's earlier proposals at confidence 0.9 or more (for example from a `skills:normalise` run without `--auto-promote`), runs the normaliser for that programme's own names with auto-promote, then re-applies the **same stored digest**. That is a database write, not a new AI digest, so phases 3, 6 and 7 later in the same run already see the skills. If every name already matches, it does nothing. Set `PIPELINE_BUILD_SKILL_TAXONOMY=0` to switch this off. `pnpm skills:normalise` stays as the manual tool, and is what you use for the LinkedIn source.

For the usual case, then, it is: digest the programmes, then run the pipeline.

To re-apply stored digests yourself, with no AI call, run `pnpm programs:approve-pending --rematerialise` (every approved digest) or add `--program-id=<id>` for one programme.

The manual route, in order:

| Step | Command | What it does |
|---|---|---|
| 1 | `pnpm connector:run kmitl-skill-mapping` | Loads labour-market skill demand (LinkedIn data via the KMITL connector). Needs credentials; see the [tutorial](../tutorials/program-deep-dive.md#labour-market-skills) |
| 2 | `pnpm skills:normalise --source=linkedin --auto-promote` | Builds the taxonomy from those skill names, then re-links the KMITL demand and growth rows to the new skills |
| 3 | `pnpm programs:pipeline <code> --only=phase1`, or `pnpm programs:digest <code>` | Digests the curriculum PDF. Names that match nothing become `PROPOSED_SKILL` extractions |
| 4 | `pnpm skills:normalise --source=program_digest --auto-promote` | Adds your curriculum's own vocabulary to the taxonomy |
| 5 | `pnpm programs:approve-pending --rematerialise` | Re-applies the stored digests so their skills now match. No AI call |
| 6 | `pnpm programs:pipeline <code> --only=phase3` | Career mapping and demand match. It must run **after** steps 2 and 5, or the *Demand match* card stays 0 |

- **Cost and time:** about USD 0.003 per batch of 25, so roughly USD 1 and 45 minutes for ~5,900 LinkedIn names. That was measured on an OpenRouter install; your model's price sets yours. The digest source is usually far smaller.
- **Re-running is safe.** Names already decided are skipped, so a second run only retries the ones that failed. The summary's `Failed:` line is the one to read. The script exits 0 even when batches failed, for example on an OpenRouter balance refusal ([see below](#running-on-openrouter)).
- **Without KMITL access, or outside Thailand,** skip steps 1, 2 and 6. Steps 3 to 5 still give you a taxonomy built entirely from your own curricula. The *Demand match* card then stays empty, because nothing supplies demand.
- **`PROPOSED_SKILL` approval does not create skills.** With `AI_AUTO_APPROVE_THRESHOLD` unset (its code default is 0), those extractions are auto-approved as soon as they are written. Approval only changes their review status; only step 4 turns them into `Skill` rows.

**Re-applying a digest costs no AI call.** `--rematerialise` writes the stored digest again. Re-running the AI digest (`pnpm programs:digest <code> --force`) is only needed when you want the curriculum re-read.

### Thai PDF output requires TH Sarabun New

All PDF *output* (Council Packs, briefs, decision records) renders through Gotenberg with TH Sarabun New embedded. The four `.ttf` files are **deliberately not in git** and must be placed at `infra/gotenberg/fonts/` before `docker compose build gotenberg`. Read `infra/gotenberg/README.md` for sourcing.

Two things that will catch you:

- The Docker build **fails loudly** if the fonts are missing — a `COPY` abort plus a post-`fc-cache` check that counts registered Sarabun faces. This is deliberate; the alternative failure mode is silently rendering tofu boxes in an official document.
- Google Fonts' **"Sarabun" is a different typeface** (Cadson Demak's). It is not TH Sarabun New and does not satisfy the Thai Cabinet requirement for official documents. Do not substitute it.

Never generate PDFs in-process. No puppeteer, no react-pdf, no html-pdf — `@react-pdf/renderer` in particular mishandles Thai tone-mark shaping and is explicitly banned in this codebase. Everything routes through `PdfGenerationService` → Gotenberg. `docs/pdf-generation.md` has the full contract.

---

## 11. Branding and UI adaptation

### The token system

Design tokens are **OKLCH triplets** in `packages/design/src/css/tokens.css`, scoped under `[data-theme='light']` and `[data-theme='dark']`. Tailwind utilities wrap them so alpha modifiers work (`bg-surface-1/80`).

`packages/design/src/tailwind-preset.ts` **replaces** — not extends — Tailwind's colour, spacing, radius, font-size, and shadow scales. `bg-slate-500` is a compile-time error by design. ESLint additionally bans literal hex and literal-numeric `rgb()`/`oklch()` calls via a `no-restricted-syntax` rule in `eslint.config.mjs`; wrappers around CSS variables are allowed.

Theme is switched via a `data-theme` attribute (not a `dark` class), through `next-themes` configured SSR-safe so there is no flash of wrong theme.

**Token naming matters more than it looks.** The convention is `--color-<family>-default`, not a bare `--color-<family>`. A wrong name does not fall back — it renders as a black box in SVG or black in HTML. Grep `tokens.css` before inventing a token name. Related: in SVG, paint `<text>` via the `fill=` attribute rather than `style.fill`.

### Rebranding checklist

| Asset | Path |
|---|---|
| Logos, light and dark | `apps/web/public/brand/kku-logo-light.png`, `kku-logo-dark.png` |
| Favicon | `apps/web/app/icon.png` — rebuild with `pnpm tsx scripts/build-favicon.ts` after replacing logos |
| Brand accent colour | `packages/design/src/tokens/color.ts` → `brandCardinal` (`default` / `hover` / `subtle`) |
| Fonts | `apps/web/app/layout.tsx`; local Sarabun fallbacks exist at `apps/web/public/fonts/sarabun/` for networks that cannot reach Google Fonts |

**Roughly 101 files under `apps/web` (`.ts`/`.tsx`) reference "KKU" or "Khon Kaen".** That is more than you would guess and includes page copy, empty-state text, PDF template headers, AI system prompts, and comments. Plan a deliberate sweep, and do it *early* — before you have written your own code on top, so the diff stays reviewable.

Consider renaming `brand-cardinal` to a neutral token name (`brand-primary`) as your first branding change. It makes every subsequent colour decision institution-agnostic and it is a mechanical find-and-replace now versus an archaeology exercise later.

### The name

The canonical product name is **"Program Landscape — KKU Curriculum Intelligence Platform"** (short form: *Program Landscape*). Three earlier names are retired and have been purged from user-facing text: *Curriculum Compass* and *ทักษทัศน์* (former internal codenames — the latter is not a meaningful Thai word), and *KKU Curriculum Landscape* (the former title). Treat all three as dead: if you find one in a comment or a historical prompt under `prompts/`, leave it as the historical record it is, but never surface it to a user. Thai copy does not translate the product name — it wraps the English name in a Thai noun phrase, e.g. *แพลตฟอร์ม Program Landscape*.

---

## 12. Methodologies — adapting the scoring to your institution

Every score the platform produces is computed by an explicitly-versioned function in `packages/db/src/` with a matching document under `docs/methodologies/`.

| Methodology | Doc | Implementation |
|---|---|---|
| Health score (`health-score.v4.0`) | `docs/methodologies/health-score.md` | `packages/db/src/health-score.ts` |
| Programme health + lifecycle | In-app paper `/docs/methodology` — `apps/web/app/docs/methodology/content-{en,th}.tsx` (the old markdown copy is retired) | `packages/db/src/health-score.ts` |
| Risk scoring | `risk-scoring.md`, `risk-management.md` | `packages/db/src/risk-scoring.ts` |
| Forecasting (`forecasting.v1`) | `forecasting.md` | `packages/shared/src/forecasting/` |
| Scenario engine | `scenario-engine.md` | `packages/shared/src/scenarios/` |
| Cost allocation | `cost-allocation.md` | **v0 draft — explicitly not Council-ready** |
| Cross-scope consistency | `cross-scope-consistency.md` | `packages/db/src/scope.ts` |
| Data quality (`data-quality.v2`) | — | `packages/db/src/data-quality.ts` |
| Evaluations, class GPA, verdict stability, AI extraction accuracy | see `docs/methodologies/` | various |

### Three rules for changing a methodology

1. **Bump the version constant, always.** `HEALTH_SCORE_VERSION = 'health-score.v4.0'` in `packages/db/src/health-score.ts` is stamped onto every score row. Changing a formula without bumping it makes historical comparisons silently wrong and breaks the audit trail that lets a Council member ask "why did this programme's score change?"
2. **Update the doc in the same commit.** The doc under `docs/methodologies/` is the version of record for what the number means. A drifted doc is worse than no doc.
3. **Null is not zero.** The health score's foundational rule: a missing metric is **excluded from the average**, never substituted with 0 or 50. Every score carries a `dataCompletenessPct` and the UI renders missing values as `—`. Do not "fix" this — substituting zero punishes programmes for your data gaps, which is precisely the failure mode that destroys Council trust.

### Where your weights differ

KKU's health score is composed of dimensions (demand, financial, quality, relevance, capability) with drivers inside each. Some drivers are explicitly weighted by KKU's strategic judgement — for example, a demand driver weighted for "the non-degree HRD shift squeezing post-graduate programmes". These are **KKU Council positions, not universal truths**, and you should expect to change them.

The safe adaptation pattern: add your weights as a new version alongside KKU's rather than editing theirs in place. You keep the ability to merge upstream changes to the formula's *structure* while owning its *parameters*.

**Before changing anything cross-module, read `docs/evaluation-pipeline.md`.** It maps how health, lifecycle, risk, the KKU matrix, and BCG scoring interact with 22 AI prompts and a set of cross-joins. Changing a weight in isolation can move a programme across a BCG quadrant boundary in a way you did not intend.

### Cost allocation is unfinished — at KKU too

`docs/methodologies/cost-allocation.md` is a **v0 draft** pending Finance Committee approval. It lays out five cost pools and an activity-based formula, and the connectors populate its raw inputs, but no per-programme cost figure is Council-facing. If financial sustainability analysis is a priority for you, this is genuine unfinished work you inherit, not a configuration step.

---

## 13. The AI layer

### Everything routes through `AiService`

`packages/shared/src/ai/` is the abstraction. Modules never import `@google/genai` or `@anthropic-ai/sdk` directly. Provider selection is `AI_PROVIDER`:

| Value | Status |
|---|---|
| `google` | Gemini — the default, and what the programme pipeline is tuned for |
| `anthropic` | Claude — **required for the AI Analyst module**, which uses native tool-use |
| `stub` | Deterministic placeholders; works with no API key. Useful for local development |
| `openrouter` | Any model through OpenRouter's OpenAI-compatible API. Embeddings and transient-error fallback go to Google when `GOOGLE_AI_API_KEY` is set. See [Running on OpenRouter](#running-on-openrouter) before digesting long PDFs |
| `intelsphere` | Stub that throws at call time — deliberately loud, not silent fallback |

Gemini has embeddings and Claude does not, so when `AI_PROVIDER=anthropic` the factory transparently delegates `embed()` to Google. Set both keys if you use Claude.

### Running on OpenRouter

OpenRouter works, but a whole-curriculum digest of a long PDF hits four problems, which show up one after another. The full table, with settings, is in [AI governance](../ai-governance.md#running-on-openrouter). In short:

1. **The request times out after 2 minutes.** Set `AI_OPENROUTER_TIMEOUT_MS=600000`.
2. **The Google fallback then fails with 429 `RESOURCE_EXHAUSTED`.** A 300-page curriculum is about 360k input tokens, and a free-tier Google key allows 250k a minute. Fix the timeout rather than relying on the fallback.
3. **"no json found" with an empty answer.** A reasoning model spent the whole output budget thinking. Structured extraction now asks OpenRouter for minimal reasoning, which fixed it on `z-ai/glm-5.3` (73 s, USD 0.08 for the digest).
4. **HTTP 402 "You requested up to 50000 tokens, but can only afford …".** OpenRouter checks your balance against the *requested* output cap, not actual use. Top up; the digest and `skills:normalise` both request 50,000.

### Prompts are versioned code

`packages/shared/src/ai/prompts/` holds 30-odd prompt modules. Each exports a version constant, a Zod output schema, and a message builder. The rule is absolute: **behaviour change means a new version; never edit a published version in place.** `AiExtraction.methodVersion` records which version produced each row, so old outputs stay distinguishable and re-runs are auditable.

Every prompt must conform to `docs/prompt-standard.md`, adopted 2026-08-16 and **enforced by a ratchet test** at `packages/shared/test/prompt-standard-conformance.test.ts` (files not yet rewritten sit on an explicit allowlist, which only shrinks). The standard's key rules:

- **All free-text analysis output is English-only.** This reversed an earlier Thai-primary strategy. Thai survives only on a finalised exemption list — `recruitmentSummaryTh` in `program-digest` (it is marketing copy, not analysis), `nameTh`-class extraction fields, and the whole of `evaluation-question-translate`.
- **Grounding:** numbers in the output must be traceable to the input snapshot handed to the model in that call. Never a number the model "knows" about your university or Thai higher education generally.
- **Missing input is never guessed** — render "data not available" or an explicit `null`, never a plausible-sounding placeholder and never zero standing in for unknown.

### Governance

`@AiCall()` on every AI-invoking endpoint writes an `AiInference` row. `@AuditLog()` on every mutation writes an `AuditLog` row. Both decorators are in `apps/api/src/common/decorators.ts`. Cost is tracked per call (`AiInference.costEstimateUsd`) and there is a per-user daily USD quota guard (`AiQuotaGuard`), configurable via `AI_QUOTA_*_USD`, that fails *open* on database error — quotas are governance, not security.

There is a 25-question gold-set evaluation suite (`pnpm ai:eval`) and an accuracy harness (`pnpm ai:eval-accuracy`) with labels under `gold-labels/`. Read `docs/ai-governance.md` for the full policy, including the model-fallback rule (transient errors only — 429/5xx/timeout; deterministic failures re-throw) and the output scrubber that redacts Thai citizen IDs, phone numbers, and non-institutional emails from model responses.

---

## 14. Traps that will cost you days

These are hard-won. Each one caused real defects in this repository.

### Trap 1: The Tailwind spacing scale is HALF Tailwind's, and missing keys emit nothing

`packages/design/src/tokens/spacing.ts` **replaces** Tailwind's spacing scale, and its `1` is **2px, not 4px**. Read the file — its header comment is the best explanation you will get.

Two independent consequences:

- **Every spacing utility is half what a Tailwind-fluent developer expects.** `h-4 w-4` on a lucide icon renders at **8px**, not 16px.
- **A utility whose key is not in the scale emits NO CSS AT ALL.** Not a fallback — nothing. `pl-9` is zero padding. `gap-1.5` was silently zero gap until `1.5` was added. `h-3.5 w-3.5` emits nothing, so those icons fall back to the SVG's intrinsic 24×24.

`3.5` is **deliberately absent and must not be "completed"**. 333 of its 338 uses are `h-3.5 w-3.5` on icons; defining it would shrink ~167 elements to 7×7 in a single commit.

The remedy for icons is the separate `iconSize` scale in `packages/design/src/tokens/icon.ts`, exposed as one-class utilities `size-icon-xs` … `size-icon-xl` (12/14/16/20/24px). **Use `size-icon-*` on icons; use the spacing scale only on layout boxes.**

Two more things about the preset:

- **It does not hot-reload.** Changing a token means restarting the dev server.
- **Next caches compiled CSS in `.next/cache/webpack` across restarts.** If a token change appears to have no effect, clear that directory before you debug anything else. You will otherwise chase a phantom for an afternoon.

### Trap 2: `realDataWhere()` — empty sections with rows in the database

`packages/db/src/data-quality.ts` exports `realDataWhere()`, currently `data-quality.v2` in **STRICT** mode. A metric row counts as real if and only if its linked `IngestionRun`'s `DataSource` has `mocked = false`. Rows with `ingestion_run_id IS NULL` are treated as suspect and **excluded**.

So a UI section renders empty despite visible SQL rows for either of two independent reasons:

1. `data_sources.mocked = true` — and note that `mocked` is a **separate column from `status`**. `status='real'` does not imply `mocked=false`. Flip both, always, atomically.
2. `ingestion_run_id IS NULL` — a write path forgot to thread `ctx.runId` through.

Triage SQL:

```sql
SELECT COUNT(*) FILTER (WHERE t.ingestion_run_id IS NOT NULL) AS tagged,
       COUNT(*) FILTER (WHERE ds.mocked = false)              AS pass
  FROM <table> t
  LEFT JOIN ingestion_runs ir ON ir.id = t.ingestion_run_id
  LEFT JOIN data_sources  ds ON ds.id = ir.data_source_id
 WHERE t.program_id = '...';
```

`pnpm provenance:backfill` (dry-run by default) reports orphan counts per table. `pnpm data-sources:audit` catches the `status`/`mocked` drift. Run both after every connector flip and every database reset.

### Trap 3: Oracle accounts lock on connection storms

KKU's registrar Oracle account locks the user when a script opens a connection per call in a loop. Use one session per run — the codebase has `OracleSession` for exactly this, and `apps/ingestion/src/lib/oracle-client.ts` wraps the lifecycle. Do not use `withConnection` inside a loop.

This generalises: every institutional database you touch will have a connection-rate policy you find out about by violating it. Batch first, ask later is the wrong order here — a locked service account is a conversation with an infrastructure team, not a retry.

### Trap 4: Per-app `.env` files and the silent Edge-middleware failure

Next.js loads `.env` from `apps/web/`, **never** from the monorepo root. When it is missing, the Edge-runtime middleware bundle compiles with `NEXTAUTH_SECRET` undefined and **every protected route 307s back to `/signin`** — while the Node runtime, where sign-in itself runs, works fine. The symptom looks like an auth bug. It is an env-loading bug.

Fix: `pnpm link-env`. Re-run it after every root `.env` edit on Windows, where it copies rather than symlinks.

Related architectural constraint: `apps/web/middleware.ts` verifies the session cookie with `jose` directly and **must not import `@/lib/auth`** (which pulls in Prisma and is Node-only). Adding a Prisma call to middleware breaks the Edge build.

### Trap 5: A score of 0 does not mean zero

In the DQ export a module score of `0` means **the module was not taken**. Treat it as a real zero
and every module mean is dragged toward the floor by students who never sat that module, which looks
exactly like a genuine competency problem and will survive review because the number is plausible.

The codebase defends against this with a single exported predicate, `dqScoreWasTaken()`, precisely
so that consumers cannot each write `> 0` until one of them eventually writes `>= 0`. Zeros are
excluded from both `scoreSum` and `takenCount`.

The general lesson, which is not specific to DQ: whenever a source encodes a *status* inside a
*measure*, convert it at the boundary and export one predicate for the rest of the system to share.
Do not let the encoding travel.

Two related reporting rules ride along with it — cells below **6 scored students** are suppressed,
and only bachelor-level programmes are in scope. A blank cell means "too few students to report";
an absent postgraduate row is not a data gap. Both will be read as defects by someone unless the UI
says otherwise, so say it in the UI.

### Trap 6: The `@kku/shared` barrel leaks `node:crypto`

`packages/shared/src/index.ts` re-exports subpaths that import `node:crypto` (`pdf/hash.ts`, `ingestion/kmitl-token.ts`, `ai/providers/google-ai.ts`). A **client component must use `import type` only** from `@kku/shared`; a runtime import crashes the build.

If you need a runtime value in a client component, import it from the specific subpath rather than the barrel, or move it to a client-safe module.

### Trap 7: Stale dev servers, twice over

Two distinct staleness bugs with an identical symptom — "a `tsx` script works but the running app does not":

- **`next dev` keeps the OLD Prisma client after a schema change.** If a fresh `pnpm tsx` query succeeds and the dev route fails, restart the dev server. Do not keep debugging.
- **`nest start --watch` only watches `apps/api/src`.** Edits to `packages/db`, `packages/shared`, etc. do not trigger a reload. Restart the API.

In both cases the instinct to keep investigating is what costs the time.

### Trap 8: Non-root container images and volume ownership

Production MinIO runs as UID 65532 (Chainguard rebuild — upstream `minio/minio` is EOL). The data volume must be chowned to 65532 **on the host**, because a compose-run `chown` hits EPERM under `cap_drop`; the file-based secrets must be mode 0644 or MinIO crash-loops with "Invalid credentials". Dev never reproduces this because dev uses env-var credentials and an already-correct volume. `scripts/deploy.sh` handles both — read it before you write your own deploy path.

Separately, the ingestion container runs as UID **1010**, while web and api run as 1001. Any compose-level `user:` directive for ingestion must say `1010:1010`.

---

## 15. Testing and CI

### Running tests

| Command | Scope |
|---|---|
| `pnpm test` | Vitest across all workspaces — 118 test files, ~1,400 cases |
| `pnpm e2e` | Playwright (`apps/web/e2e/`) — needs `npx playwright install` first |
| `pnpm lint` | ESLint across `apps/**` and `packages/**` |
| `pnpm typecheck` | `tsc --noEmit` across workspaces |
| `pnpm check` | lint + typecheck + test. **Run before every commit** |
| `pnpm ai:eval` | 25 gold-question AI evaluation suite |

A full `pnpm test` reports a higher case count than the ~1,400 above because of `.each` expansions.

### What the tests are actually protecting

The test suite is unusually weighted toward **pure functions with policy content** rather than integration coverage: status-transition graphs and role gating, health-score null handling, connector transform mappings, the rank-mapping prefix-ordering edge cases, the prompt-standard conformance ratchet, AUN-QA criteria structure, safety-refusal patterns. That is a deliberate choice — these are the places where a silent regression changes what the Council is told.

When you write your own connectors, follow the existing pattern: a fixture under `apps/ingestion/test/fixtures/<slug>/`, and a transform test that asserts every code in the fixture has a mapping. The `kku-registry` status-mapping coverage test is the model — it guards against the registrar quietly adding a new status code.

### CI

`.github/workflows/` has four workflows: `pr.yml`, `release.yml`, `e2e.yml`, `load.yml`.

`pr.yml` runs a migration linter for destructive DDL, lints **changed files only**, typechecks, runs Prisma generate, spins up Postgres with pgvector, applies migrations against a test database, and runs tests.

**Known state you inherit:** `PR checks` is green end-to-end. `Release bundle` (on tag push) runs a full repo-wide `pnpm lint` and is **red on a pre-existing lint backlog** — not on any individual change. The local pack-and-ship tarball is the real release artifact. You may want to clear that backlog early so a red CI badge means something in your fork.

---

## 16. Deployment and infrastructure sizing

### The model: pack-and-ship

Production servers **never pull from a registry**. You build images on a development machine, bundle them into a single tarball, transfer it, and `docker load` on the server.

```bash
# On the dev machine (inside WSL2 if on Windows)
pnpm build:release <version>
# → dist/program-landscape-<version>.tar.gz  (~2.5 GB)
# → dist/program-landscape-<version>.tar.gz.sha256
```

The bundle contains `images.tar` (4 images, all `linux/amd64`), the compose file, the nginx config, the deployment scripts, the systemd units, and the env template. Nothing else needs to travel.

**All production images are `linux/amd64`.** If your dev machine is an ARM Mac, builds must pass `--platform linux/amd64`.

**One build-process gotcha:** `docker buildx` runs each image's `COPY` when that stage executes, so a commit landing mid-build makes it into some images and not others. If a fix must be in the bundle, kill the build, prune, and restart.

On the server, `scripts/deploy.sh` is idempotent and does an atomic symlink swap (`/opt/program-landscape/current → releases/<ver>`) as its point of no return; anything before that is rolled back automatically on failure. Migrations run in a **disposable container** (`docker compose run --rm --entrypoint "" api node node_modules/.bin/prisma migrate deploy`) rather than from the long-lived API container, which would race with ingestion on startup.

Companion scripts: `rollback.sh`, `backup.sh`, `restore.sh`, `smoke-test.sh`, `pre-deploy-snapshot.mjs`, `generate-self-signed-cert.sh`.

Rollback is **code-only by default**; `rollback.sh` asks whether to restore the pre-deploy database snapshot and the usual answer is no, because migrations are forward-only and the code rollback is schema-compatible.

### TLS topology

KKU's arrangement, which most Thai universities can mirror:

```
public → university reverse proxy (terminates public cert)
       → re-encrypts, forwards to our host on :8443 (self-signed)
       → our internal nginx (TLS + path routing)
       → web / api over plain HTTP inside the docker network
```

The upstream proxy is configured with `proxy_ssl_verify off` (or SHA-256 certificate pinning). One nginx detail that will bite you if you rebuild the config: `next-auth` lives at `/api/auth/*` on the web app while the NestJS prefix is `/api/v1` — you need an explicit `location /api/auth/` → web rule, or auth 404s against the Nest router.

Security headers are set at the **application layer**, not in nginx, so they are correct regardless of which proxy path a request takes.

`DEPLOYMENT.md` is the runbook. `docs/deployment/kku-network-integration.md` is what you hand to your network team.

### Sizing

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

---

## 17. PDPA and governance

**This system holds student and staff personal data.** Not aggregates — individual records: hashed citizen IDs, names, birth years, employment history, education qualifications, course evaluations.

### KKU's approval does not transfer to you

The PDPA postures documented throughout this codebase — the column projections in each connector, the hashing at the boundary, the `HAVING COUNT(*) >= 5` small-cell suppression, the legal-basis analysis in `docs/pdpa.md` — were approved by **KKU's** Data Protection Officer for **KKU's** processing. Your institution is a separate data controller under the PDPA. You need your own DPO sign-off, on your own data inventory, before you process anything.

`docs/pdpa.md` and `docs/dsar-workflow.md` are your **starting posture**, not a transferable approval. Read them as "here is a design that a Thai university's DPO has already found acceptable, and here is the reasoning" — then have your own DPO review it against what you are actually doing.

### What the documents contain

`docs/pdpa.md`: roles (controller/processor), a personal-data inventory, legal-basis analysis per data category, how each data-subject right under §30–36 is served, cross-border transfer analysis (relevant because AI calls leave Thailand), audit-log retention, data-minimisation checkpoints, incident response, annual review.

`docs/dsar-workflow.md`: the operational workflow for access requests — intake, admin export flow, identity verification, rectification, erasure, objection to automated decision-making, and record-keeping.

### Design decisions that carry the PDPA weight

Preserve these when you write your own connectors:

- **Aggregate at source.** The SQL `GROUP BY` and `HAVING` clauses run on the source server; per-person rows never cross the wire.
- **Hash at the boundary.** `hashCitizenId()` runs in `transform()`; raw citizen IDs never persist.
- **Downcast dates.** Birth dates become birth years.
- **Explicit projections.** Every connector lists its columns; nothing is `SELECT *`. The projection *is* the trust boundary, and each connector's header comment says so.
- **Read-only service accounts**, never superusers.

Cross-border transfer deserves specific attention: every AI call sends data outside Thailand: to Google or Anthropic, or through OpenRouter to whichever vendor serves the model you chose. `docs/pdpa.md` § *Cross-border data transfer* covers KKU's analysis. Your DPO may reach a different conclusion, and if they require in-country inference the `AiService` abstraction is where you would swap the provider — OpenRouter is a working provider but routes abroad too; the in-country option (`intelsphere`) is still a stub that throws, so that would be real work.

### The readiness gates

`docs/readiness-checklist.md` defines twelve gates that any output must clear before it is Council-facing. A gate failure blocks the affected output and surfaces an in-app banner rather than silently shipping a caveated number. **Gate 11** is the one adopters most often skip: a real connector needs **30 days of green history** before it can drive a Council number. Plan for that delay rather than discovering it the week before your first Council presentation.

---

## 18. Extending the platform with Claude Code

This codebase was built with Claude Code, and that fact shapes how you should extend it. If you use an AI assistant here, the setup below is what makes its output consistent with the existing code rather than a plausible-looking mess.

### `CLAUDE.md` is the contract

`CLAUDE.md` at the repository root is read at the start of every Claude Code session. It is why the AI produces consistent code in this repository: it encodes the strategic questions, the module list, the language strategy, the coding conventions, the Council-readiness rules, the deployment model, and a long decision log explaining *why* things are the way they are.

**Fork it and rewrite the institution-specific parts before your first session.** Specifically:

| Section | Action |
|---|---|
| Project description, audience | Rewrite for your institution |
| The eight strategic questions | Rewrite — these are KKU Council's questions, and they are the framing that shapes every analytical decision downstream |
| The eight modules | Keep, unless you are dropping one |
| Language strategy | Review — English-only UI and English-only analysis output, with a narrow Thai exemption list |
| Faculty names, programme counts | Replace |
| Current status / decision log | **Truncate to a pointer at KKU's history, then start your own.** Do not carry 170 KB of KKU's session log; it will crowd out your own context |
| Coding conventions, What NOT to do | Keep verbatim — this is the part that makes AI output consistent |
| Run/test/lint, Platform | Update paths and hostnames |

`prompts/CLAUDE.md.template` is the original template the file was generated from and is a cleaner starting point than the current 170 KB file.

A word on the decision log: KKU's `CLAUDE.md` contains a self-flagged drift note admitting the log jumps from v1.1.3 to v1.6.1 and that the v1.2–v1.6 work was shipped but never logged. Treat it as best-effort, and treat `apps/web/app/changelog/page.tsx` as the authoritative release history.

### `prompts/` is the original build manual

The `prompts/` directory contains the sequenced prompts that built the platform — prompt 00 (bootstrap) through prompt 13b (deployment), plus the ongoing prompt 14 (real-data integration). You are unlikely to re-run them, but they are the best available explanation of *why* each subsystem is shaped as it is. Read the one matching whatever you are about to change.

`prompts/14-integration-session-template.md` is the live, per-connector session template and you should use it for every connector you write. `prompts/GLOBAL-UPDATES.md` carries cross-cutting requirements; `prompts/TROUBLESHOOTING.md` collects known failure modes.

### The house rules that keep AI output consistent

These are in `CLAUDE.md` and they are what an AI assistant will follow if you leave them in place, and quietly violate if you delete them:

- TypeScript strict; **no `any`**
- Zod validation at every I/O boundary — request, response, ingestion, AI extraction
- Design tokens only; never hardcoded colours, fonts, or spacing (ESLint enforces)
- `@AuditLog()` on every mutation; `@AiCall()` on every AI call
- Server components by default; client components only for interactivity
- Conventional commits (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, `test:`)
- `pnpm check` before committing
- Methodology versioning on every metric
- No raw SQL except via Prisma's `$queryRaw` with Zod-validated results
- Cross-platform tooling only — no Makefile, no `rm -rf` (use `rimraf`), no string-concatenated paths (use `path.join()`)

### A starting set of prompts

These are written to be pasted and run, in this order, as separate sessions. Each states what "done" looks like. Replace `<YOUR UNIVERSITY>` and the bracketed specifics.

---

**Prompt 1 — Orient in the codebase**

> Read `CLAUDE.md`, `docs/architecture.md`, and `docs/evaluation-pipeline.md`. Then produce a written orientation for a new developer at `<YOUR UNIVERSITY>` covering: (a) the data flow from an ingestion connector through to a number rendered on the Portfolio Overview Cockpit, naming the specific files at each hop; (b) which of the eight modules can render anything useful with zero institutional data wired, and which are completely empty until a specific connector runs — name the connector for each; (c) the five files a developer will touch most often, with one sentence each on what lives there.
>
> Do not change any code. Write the orientation to `docs/adopters/orientation-<ouruni>.md`.
>
> **Done when:** the document exists, every file path in it resolves, and I can trace one number end-to-end from SQL through to a React component by following it.

---

**Prompt 2 — Fork `CLAUDE.md` for our institution**

> Rewrite `CLAUDE.md` for `<YOUR UNIVERSITY>`. Keep verbatim: the coding conventions, the "What NOT to do" list, the Council-readiness rules, the multi-level analytical scope rules, the folder conventions, and the run/test/lint commands. Rewrite: the project description and audience, the eight strategic questions (I will give you ours below), the faculty names, and the platform/deployment section (our production host is `<HOST>`, install path `<PATH>`). Replace the entire "Current status" decision log with a single paragraph pointing at KKU's upstream history plus an empty section for ours to accumulate in.
>
> Our strategic questions are: [list yours, or say "keep KKU's eight for now and flag that we must revisit them with our Council"].
>
> **Done when:** `CLAUDE.md` contains no reference to Khon Kaen University except the explicit attribution paragraph, is under 20 KB, and a fresh session reading only that file would follow our conventions rather than KKU's.

---

**Prompt 3 — Rebrand**

> Rebrand the application from KKU to `<YOUR UNIVERSITY>`. Work in this order and stop for my review between each step:
>
> 1. Inventory every reference. Grep `apps/web` for "KKU" and "Khon Kaen" (case-insensitive) across `.ts`/`.tsx`, plus `packages/pdf-templates` and `packages/shared/src/ai/prompts`. Give me a categorised list: user-facing copy, PDF template text, AI prompt text, comments, identifiers. Roughly 101 files in `apps/web` alone — do not try to fix them in one pass.
> 2. Rename the brand colour token from `brand-cardinal` to `brand-primary` across `packages/design`, `packages/ui`, and `apps/web`. Keep the OKLCH values unchanged for now so the diff is purely a rename.
> 3. Change the `brand-primary` token values in `packages/design/src/tokens/color.ts` to `<YOUR COLOURS>` for both light and dark mode, and verify both modes still pass WCAG AA for text on surface.
> 4. Replace the logo files at `apps/web/public/brand/` and rebuild the favicon with `pnpm tsx scripts/build-favicon.ts`.
> 5. Fix user-facing copy, PDF templates, and AI prompt text — in that order, one commit each.
>
> Constraints: never hardcode a colour; use tokens only. Do not add tokens to the spacing scale — read `packages/design/src/tokens/spacing.ts` before touching anything spacing-related. Restart the dev server and clear `.next/cache/webpack` after any token change, because the preset does not hot-reload.
>
> **Done when:** `pnpm check` passes, no user-facing surface says "KKU", and both light and dark mode render correctly with our colours.

---

**Prompt 4 — Load our faculties, departments, and programmes**

You may not need Claude Code for this. The three backbone datasets are spreadsheet uploads at `/admin/data-setup`: download each template, fill it in, upload it. Use the prompt below when your source is a messy export that needs reshaping into the templates first.

> Turn our organisation data into the Program Landscape import templates. Do not edit any code or seed file.
>
> Read `docs/data-import.md` and the declarations in `packages/db/src/import/datasets/faculties.ts`, `departments.ts` and `programmes.ts` — those declare the exact columns, required fields and validation rules. Our faculties, departments and programmes are in [file], with columns [list them].
>
> Produce three workbooks matching the downloaded templates. Carry the MHESI curriculum code into the programmes sheet's *Official Code* column: `Program.mhesiCode` is how the UniCon DS1001 and DS2004 connectors resolve `CURR_ID` to a programme. Thai faculty names must be spelled the way TCAS writes them. List any row you could not map rather than guessing.
>
> **Done when:** all three workbooks upload at `/admin/data-setup` without a validation error, and `/admin/programs` lists our programmes with correct faculty and department attribution.

---

**Prompt 5 — Wire our first UniCon connector (DS2001, staff master)**

> Follow `prompts/14-integration-session-template.md` for the slug `unicon-ds2001`. One connector only.
>
> Read `apps/ingestion/src/connectors/sources/unicon-ds2001/connector.ts` in full before changing anything — particularly the PII projection in `fetch()`, the `EMPTY_DATA` guard, and the snapshot-replace semantics in `load()`.
>
> Our DS2001 lives at [host/port/database]. Credentials are in `.env` under `UNICON_DS2001_DB_*` — note that key is documented in `.env.prod.example` but missing from `.env.example`; add it to both.
>
> Steps:
> 1. Write a read-only discovery script following the pattern of the existing `probe-*` scripts in `apps/ingestion/src/scripts/`. Report row count, distinct values per reference column, and which columns are NULL-heavy. Refuse to sample any column matching the PII guard pattern. Commit the aggregate output as a fixture under `apps/ingestion/test/fixtures/unicon-ds2001/`.
> 2. Diff our schema against the projection in the existing connector. Report every difference before changing code — I want to see it, not have it fixed silently.
> 3. Adapt the connector minimally. Preserve the column projection, the citizen-ID hashing, the birth-year downcast, the `EMPTY_DATA` guard, and the `ingestionRunId: ctx.runId` stamp on every inserted row.
> 4. Adapt `buildDeptCodeToFacultyMap()` to our organisational codes.
> 5. Add a transform unit test asserting every reference code in the fixture has a mapping.
>
> Then run `pnpm connector:run unicon-ds2001` until we have three consecutive successful runs with identical record counts. Update `data_sources` so `status` and `mocked` are set atomically, and run `pnpm data-sources:audit` to confirm no drift.
>
> **Done when:** three green runs are visible at `/admin/data-sources/unicon-ds2001`, `staff_master_record` rows all carry a non-null `ingestion_run_id`, the faculty-resolution rate is reported, and `pnpm check` passes. Do not touch any other connector or any UI file.

---

**Prompt 6 — Write the second UniCon connector by analogy (DS2004)**

> Now do `unicon-ds2004` — academic staff per programme. Same template, same one-connector discipline.
>
> This one is different from DS2001 in three ways I want you to handle explicitly: (a) the source table name encodes academic year and semester (`ds2004_<YYSEM>`, BE last-two-digits plus semester) and the connector resolves `MAX(suffix)` at runtime — check whether our registrar uses the same convention and adapt if not; (b) it reads all three `TEACH_TYPE_ID` values (1 regular faculty, 2 curriculum lecturer, 3 responsible lecturer), not just type 3, so do not copy the documented view that filters to type 3 only; (c) `CURR_ID` resolves to `Program.mhesiCode` with a `ProgramMhesiAlias` fallback, and unmatched rows must persist with `programId = NULL` and the raw `mhesiCurrId` for analyst follow-up — never dropped.
>
> Before writing code, tell me what you expect to differ between our DS2004 and KKU's, based on our discovery output.
>
> **Done when:** three green runs, the programme-resolution rate is reported in `LoadResult.metadata`, unmatched rows are visible and countable rather than silently discarded, and the DS2001 faculty-resolution rate has improved now that the bridge table is populated.

---

**Prompt 7 — Adapt the health-score methodology to our weights**

> Read `docs/methodologies/health-score.md` and `packages/db/src/health-score.ts` (currently `health-score.v4.0`), and `docs/evaluation-pipeline.md` for how the score feeds lifecycle, risk, and BCG classification.
>
> Produce a written analysis first — no code — covering: every dimension and driver, where each driver's data comes from, which drivers return null for us today given which connectors we have wired, and which weights encode a KKU Council judgement rather than a general principle. Flag anything you are unsure about rather than guessing.
>
> Then, and only after I have approved the analysis, implement our variant: a new version constant, our weights, our methodology document at `docs/methodologies/health-score.md` updated in the same commit, and tests covering the null-handling rule (a missing metric is excluded from the average, never substituted with 0 or 50) and our specific weight changes.
>
> **Done when:** the analysis document exists and I have approved it; the version constant is bumped; the doc and code agree; `dataCompletenessPct` is still computed and surfaced; and existing scored rows carrying the old version still render with their original version stamp.

---

**Prompt 8 — Run the programme document pipeline**

> Set up and run the curriculum-PDF ingestion pipeline for our programmes.
>
> 1. Read `docs/pdf-ingestion.md` and the header of `apps/ingestion/src/scripts/programs-pipeline.ts`.
> 2. Build a JSONL manifest for `pnpm pdf:bulk-load` from our PDFs at [path], keyed on programme code. Dry-run first and show me the match rate and the unmatched list before committing anything. Do not build a fuzzy filename matcher — KKU retired theirs after it mislinked about 30 programmes; unmatched PDFs get attached by hand through `/admin/programs/[id]?tab=files`.
> 3. Run `pnpm programs:digest` on three programmes of different levels. Show me the extracted digest for each, and specifically: does `program-digest.v1` handle our curriculum document format, or does it assume KKU's layout? Report any prompt changes you would need — but do not edit a published prompt version in place; a behaviour change means a new version constant.
> 4. Once I approve the sample, run `pnpm programs:digest-bulk` and report cost, failure count, and per-failure reason.
> 5. Build the skill taxonomy as `docs/adopters/README.md` § *Building your skill taxonomy* describes. Run `pnpm skills:normalise --source=program_digest --auto-promote`, re-apply the sampled digests with `pnpm programs:digest <code> --force`, and report how many skills each programme now matches versus how many proposals stayed `NEW_PROPOSED` below the 0.9 auto-promote threshold. (`pnpm programs:approve-pending` will usually find nothing: digests are auto-approved by default, and on an empty taxonomy every skill is unmatched.)
>
> Then run `pnpm programs:pipeline <code> --skip=phase4` on one programme end-to-end (skipping phase 4 because our registrar connectors are not wired yet) and show me the resulting Deep-Dive page.
>
> **Done when:** every programme with an available PDF has an approved digest; the `PROPOSED_SKILL` queue count is reported as an analyst worklist; and one programme's Deep-Dive renders with real extracted content rather than empty states.

---

### Where AI assistance goes wrong here — be specific about this

An AI assistant is genuinely good at the mechanical work in this codebase: writing a connector by analogy to an existing one, sweeping a rename across a hundred files, writing transform tests from a fixture, drafting documentation. Use it for those.

It is **unreliable, confidently, on exactly the things this guide flags as traps**:

- **The spacing scale.** An AI trained on Tailwind will write `h-4 w-4` on an icon and `pl-9` for padding without hesitation. Both are wrong here in ways that produce no error — just wrong-sized output. Two separate defects in this repository came from precisely this. Instruct it to read `packages/design/src/tokens/spacing.ts` and `icon.ts` before touching any spacing or sizing utility.
- **Provenance stamping.** `ingestionRunId: ctx.runId` on every inserted row is easy to omit and produces a silently empty UI rather than an error. Make it an explicit acceptance criterion on every connector prompt.
- **Schema decisions.** Whether a new field is a column, a JSONB blob, or a new table; whether a migration is additive or destructive; how a unique constraint interacts with Postgres's NULL semantics — these need a human. The codebase already has hard-won answers here (manual `findFirst → update | create` upserts where a compound unique key carries NULL, for instance) that an AI will not reinvent.
- **Methodology weights.** These encode institutional value judgements about which programmes matter and why. An AI will produce plausible weights instantly. Plausible is exactly wrong for a number that closes a programme.
- **PDPA posture.** An AI will happily write `SELECT *`. Every projection is a trust boundary and needs human sign-off, and your DPO's, not the model's.
- **"Fixing" deliberate omissions.** The absent `3.5` spacing step, the null-not-zero rule, the deprecated-but-retained catalog entries — all look like bugs and are not. The code comments explain why; make sure the AI reads them.

A practical rule: let the AI write, and read what it wrote in the six categories above yourself, every time.

---

## 19. What you are NOT getting

Be clear-eyed about this before you plan. You are receiving source code and documentation. You are not receiving:

| Not included | Consequence |
|---|---|
| **KKU's data** | No student, staff, financial, research, evaluation, or outcome records. Every analytical surface starts empty |
| **Credentials** | No database passwords, API keys, SSO client secrets, or service accounts. The `.env.example` values are placeholders |
| **The 297-programme master sheet** | KKU's curated programme list, with MHESI codes and sequence numbers. You must build your own equivalent |
| **KKU's curriculum PDFs** | 228 documents. Yours to source |
| **TH Sarabun New font files** | Deliberately excluded from git for licensing hygiene. See `infra/gotenberg/README.md` for where to get them. **The Docker build fails without them** |
| **KMITL Skill Mapping credentials** | You must request your own client ID and secret key from KMITL |
| **Scopus / Elsevier API keys** | Institutional subscription; via your library |
| **Ranking subscriptions** | THE, QS, SCImago, IMD |
| **KKU's DPO approval** | Not transferable. See [chapter 17](#17-pdpa-and-governance) |
| **Council-specific methodology weightings** | The health-score weights encode KKU Council positions. See [chapter 12](#12-methodologies--adapting-the-scoring-to-your-institution) |
| **KKU's trademarks and visual identity** | The name, crest, and logos are reserved, not licensed. You must rebrand. See [chapter 2](#2-licence--cc-by-nc-sa-40) and [chapter 11](#11-branding-and-ui-adaptation) |
| **A ruling on what "NonCommercial" permits you** | KKU has not published an interpretation. Get your intended use confirmed in writing. See [chapter 2](#2-licence--cc-by-nc-sa-40) |

### Things in the repository that are unfinished, and you inherit as unfinished

Honesty here is worth more than a clean-looking feature list:

- **The AUN-QA criteria list is unverified.** `packages/shared/src/aunqa/criteria.ts` carries an explicit provenance warning in its own header: the criteria were written from an AI assistant's knowledge of AUN-QA v4, **no AUN-QA guide exists in the repository**, and nothing has been checked against the published document. Two of the criteria (Student Support Services, Facilities & Infrastructure) have no data in the platform at all and are listed separately so a reader cannot mistake six criteria for the whole framework. Further: of three KKU curricula sampled, the QA framework each declares is WFME or TQF — **none names AUN-QA**. Organising evidence along AUN-QA is an analytical overlay, not a claim the source documents make. **Verify against the official guide before this touches any accreditation submission.**
- **Cost allocation is v0** and no per-programme cost figure is Council-facing. See [chapter 12](#12-methodologies--adapting-the-scoring-to-your-institution).
- **`kku-alumni` has no real connector**, so graduate outcomes and province-level supply are not wired at KKU either. The regional gap analysis renders with an explicit deferred note on the supply side.
- **The Thailand map is schematic, not a true choropleth** — six regional blocks with intensity colouring, because per-province graduate data does not exist yet.
- **`Release bundle` CI is red** on a pre-existing repo-wide lint backlog.
- **Five catalog entries are deprecated** (`kku-tcas-funnel`, `jobthai`, `jobsdb`, `scopus`, `openalex`) and retained only so historical `IngestionRun` rows do not orphan. Do not wire them.
- **Storybook is configured but has no stories.** `/styleguide` in the web app serves the visual-contract purpose instead.
- **A per-template export-reason dialog** — the `@RequireExportReason` decorator and `DataExportGuard` are scaffolded but no live route uses them (gate 8 of the readiness checklist is satisfied at the infrastructure level, not the UI level).

---

## 20. Suggested order of work, with effort estimates

Estimates assume one or two competent full-stack developers who have not seen this codebase, and include the time spent waiting for access to institutional systems — which is usually the critical path.

| Phase | Work | Estimate |
|---|---|---|
| 0 | **Confirm your intended use is within CC BY-NC-SA's NonCommercial term, in writing from KKU.** Blocking if your use is anywhere near commercial | Days to weeks, not yours to control |
| 1 | Local instance running; fork configured with upstream; read `CLAUDE.md`, `architecture.md`, `evaluation-pipeline.md` | 3–5 days |
| 2 | Rebrand; fork `CLAUDE.md`; claim `/setup`; upload your faculties and departments | 1 week |
| 3 | Upload your programme list with MHESI codes, then whichever metric spreadsheets you already hold (enrolment, finance, staff, programme teaching staff, publications) | 1–2 weeks (data-gathering, not code) |
| 4 | Start institutional access requests for **everything** in parallel — registrar, HR, finance, UniCon, evaluations | Start on day one; expect 4–12 weeks to resolve |
| 5 | First UniCon connector (DS2001 or DS2004) | 1–3 days once access exists |
| 6 | Remaining three UniCon connectors | 1 week |
| 7 | Tier 2 external sources — KMITL, TCAS, World Bank, policy report feeds | 1–2 weeks, credential-bound |
| 8 | Programme PDF acquisition and the digest pipeline | 2–4 weeks; document acquisition dominates |
| 9 | First Tier 3 rewrite (registrar — highest leverage), replacing the matching spreadsheet uploads | 2–4 weeks |
| 10 | Remaining Tier 3 connectors as priority dictates | 2–4 weeks each |
| 11 | Methodology adaptation with your Council or equivalent body | 2–4 weeks, mostly institutional not technical |
| 12 | SSO integration; production deployment; network team engagement | 2–3 weeks |
| 13 | DPO review and sign-off | Parallel with everything; start early |
| 14 | 30-day green-history window per connector before Council-facing use | 30 days, unavoidable, plan for it |

**A realistic first-useful-output milestone is four to six months if you go connector-first**, dominated by data access and document acquisition rather than engineering. **With spreadsheet uploads it is weeks**: phases 2–3 give you a populated cockpit and deep-dive from data your offices can already export, and phases 4–10 then replace manual uploads with automation rather than standing between you and a first result. The engineering is largely done; what you are buying with this codebase is those months, not the ones after.

**Sequencing advice that matters more than the estimates:** start every access request in week one, before you write any code. A connector is one to three days of work and eight weeks of waiting for a service account. Order the queue by that fact.

---

## 21. Appendix — documentation map

Read these when the situation calls for it, not front to back.

Everything below is also browsable and searchable offline as the developer manual site: run `pnpm docs:dev` from the repository root.

### Start here

| Doc | When |
|---|---|
| `CLAUDE.md` | Before anything. Project contract plus a long decision log |
| `README.md` | Quick command reference |
| `docs/architecture.md` | Understanding the system shape |
| `docs/evaluation-pipeline.md` | **Before any cross-module change.** How health/lifecycle/risk/BCG scoring and the AI prompts interlock |

### Data

| Doc | When |
|---|---|
| `docs/data-sources.md` | The ingestion framework overview |
| `docs/data-sources/README.md` | Status dashboard for all sources; the canonical "adding a source" and "flipping mocked to real" procedures |
| `docs/data-sources/<slug>.md` | Per-source specs. Note: no specs exist for the four UniCon connectors — read their code |
| `docs/data-sources/_template.md` | Template for your own source specs |
| `prompts/14-integration-session-template.md` | **The per-connector playbook. Use it every time** |
| `docs/db-indexes.md` | Index review |
| `docs/migration-policy.md` | Before writing a migration |

### PDFs

| Doc | When |
|---|---|
| `docs/pdf-ingestion.md` | Intake pipeline — classification, extraction, review queue |
| `docs/pdf-generation.md` | Output pipeline — Gotenberg, templates, Thai gotchas |
| `infra/gotenberg/README.md` | **Before your first Docker build.** Font sourcing |
| `docs/markitdown.md` | Document conversion service |

### AI

| Doc | When |
|---|---|
| `docs/ai-governance.md` | Policies, prompt versioning, cost, bias monitoring |
| `docs/prompt-standard.md` | **Before writing or editing any prompt.** Enforced by a ratchet test |
| `docs/methodologies/ai-extraction-accuracy.md` | Measuring extraction quality |

### Methodologies

`docs/methodologies/README.md` plus: `health-score.md`, the in-app methodology paper (`apps/web/app/docs/methodology/content-{en,th}.tsx`), `risk-scoring.md`, `risk-management.md`, `forecasting.md`, `scenario-engine.md`, `cost-allocation.md` (v0), `evaluations.md`, `class-gpa.md`, `cross-scope-consistency.md`, `verdict-stability.md`.

### UI

| Doc | When |
|---|---|
| `docs/design-system.md` | Visual direction and token reference |
| `packages/design/src/tokens/spacing.ts` | **Before any spacing or sizing change.** Read the header comment |
| `packages/design/src/tokens/icon.ts` | Icon sizing |

### Operations

| Doc | When |
|---|---|
| `DEPLOYMENT.md` | The production runbook |
| `docs/deployment/kku-network-integration.md` | Hand to your network team |
| `docs/production-infrastructure.md` | Hardware, network, and egress requirements |
| `docs/backup-dr.md` | Backup and disaster recovery |
| `docs/security-review.md` | Security posture; living document |
| `docs/readiness-checklist.md` | The twelve Council-readiness gates |
| `docs/rollout-plan.md` | KKU's phased rollout, as a template |

### Governance

| Doc | When |
|---|---|
| `LICENSE` | **Before you redistribute anything.** CC BY-NC-SA 4.0 plus KKU's trademark, third-party and data reservations |
| `docs/licensing.md` | The briefing note for your legal office on releasing software under a content licence |
| `docs/pdpa.md` | **Before processing any personal data.** Starting posture, not approval |
| `docs/dsar-workflow.md` | Data-subject request handling |
| `docs/auth/kku-sso.md` | OIDC configuration, as a worked example |

### End users

`docs/user-manual.md`, plus role guides at `docs/guides/`: `executive.md`, `analyst.md`, `admin-runbook.md`, `council-th.md`. These are worth reading even as a developer — they tell you what the platform is supposed to feel like to the people it is for.

### Development environment

`prompts/WINDOWS-DEV.md`, `prompts/TROUBLESHOOTING.md`, `prompts/GLOBAL-UPDATES.md`, `prompts/README.md`.

---

## Attribution

Program Landscape was built at Khon Kaen University as a decision-support platform for the University Council. This adopter guide describes the codebase as of 2026-08-27 on the `main` branch.

If you adopt it, KKU would benefit from knowing what broke, what you had to rewrite, and what turned out to transfer better or worse than this guide predicted — particularly on the UniCon connectors, where every Thai university's experience is directly comparable.
