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
- **Monorepo:** pnpm workspaces — `apps/web`, `apps/api`, `apps/ingestion`, `packages/shared`, `packages/db`, `packages/ui`, `packages/design`
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
- `docs/ai-governance.md` — AI usage policies, prompt versioning, bias monitoring
- `docs/auth/kku-sso.md` — KKU SSO configuration
- `docs/methodologies/` — per-metric methodology with versions

## Current status

> **Update this section after every major session.** This is how Claude Code knows where the project stands when you return.

- [x] Prompt 00: Bootstrap  *(completed 2026-04-22)*
- [x] Prompt 01: Data model  *(completed 2026-04-22)*
- [x] Prompt 02: Auth & API core  *(completed 2026-04-22)*
- [x] Prompt 02b: Design system  *(completed 2026-04-22; Storybook deferred)*
- [ ] Prompt 02c: PDF generation (Gotenberg + TH Sarabun New)
- [ ] Prompt 03: Ingestion framework
- [ ] Prompt 03b: PDF intake
- [ ] Prompt 04: Skills & AI
- [ ] Prompt 05: Cockpit
- [ ] Prompt 06: Deep-Dive
- [ ] Prompt 07: Trends Radar
- [ ] Prompt 08: Gap Analyzer
- [ ] Prompt 09: Scenario Planner
- [ ] Prompt 10: Benchmarking
- [ ] Prompt 11: AI Analyst
- [ ] Prompt 12: Decision Workspace
- [ ] Prompt 13: Hardening
- [ ] Prompt 13b: Deployment (Ubuntu server, pack-and-ship)
- [ ] Prompt 14: Real data integration

**Recent decisions worth knowing about:**

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
