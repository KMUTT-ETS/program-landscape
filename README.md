# Program Landscape

Strategic decision-support platform for **Khon Kaen University Council**.
Analyzes 297 academic programs against future trends, financial
sustainability, and labor market demand.

Canonical name: **Program Landscape — KKU Curriculum Intelligence Platform**.

**Status:** production runs **v2.1.4** at KKU. All 8 modules are built and
hardened (build prompts 00–13b). Real-data integration (prompt 14) is in
progress: the KKU registry, HR, finance, research and research-services
connectors are live, as is KMITL skill mapping. Work to let other universities
adopt the platform (XLSX import, first-run `/setup` wizard, adopter docs and
workshop) is in progress on feature branches. See `CLAUDE.md` → *Current
status* for the full checklist.

<p align="left">
  <a href="https://github.com/khon-kaen-university/program-landscape/actions/workflows/pr.yml"><img alt="CI" src="https://github.com/khon-kaen-university/program-landscape/actions/workflows/pr.yml/badge.svg" /></a>
  <a href="https://github.com/khon-kaen-university/program-landscape/actions/workflows/release.yml"><img alt="Release" src="https://github.com/khon-kaen-university/program-landscape/actions/workflows/release.yml/badge.svg" /></a>
  <a href="./LICENSE"><img alt="License: CC BY-NC-SA 4.0" src="https://img.shields.io/badge/license-CC%20BY--NC--SA%204.0-lightgrey" /></a>
</p>

## Getting started (dev — WSL2 / macOS / Linux)

```bash
cp .env.example .env
pnpm setup          # install deps, start infra, generate client, migrate, register data sources
pnpm dev            # run web + api + ingestion in parallel
```

Requires Node ≥ 24.22.1, pnpm and Docker. Full walkthrough, including what to do after a fresh `git clone`:
**[`docs/tutorials/getting-started.md`](docs/tutorials/getting-started.md)**.

Then open:

- `http://localhost:3000` — web (Next.js)
- `http://localhost:4000/api/v1/healthz` — api (NestJS)
- `http://localhost:9001` — MinIO console
- `http://localhost:3001` — Gotenberg (PDF generation)

On a brand-new installation with no admin yet, the first visitor to `/setup`
claims the `SUPER_ADMIN` account.

## Scripts (all `pnpm`, no Makefile — primary dev machine is Windows)

| Command | Purpose |
|---|---|
| `pnpm setup` | install deps, start infra, generate client, migrate, register data sources, load the generic reference seed |
| `pnpm dev` | run web + api + ingestion in parallel |
| `pnpm db:up` | start postgres + redis + minio + gotenberg |
| `pnpm db:down` | stop the infra containers |
| `pnpm db:reset` | drop volumes + generate + migrate + generic seed (dev only) |
| `pnpm db:generate` | regenerate the Prisma Client after schema changes |
| `pnpm db:migrate` | apply pending Prisma migrations |
| `pnpm db:migrate:safe` | take a pre-deploy snapshot, then apply migrations |
| `pnpm db:backup` | take a database snapshot only |
| `pnpm data-sources:sync --apply` | register / update the data-source catalogue in the DB (fixes "missing `xlsx-*` source" errors) |
| `pnpm connector:run` | run one ingestion connector by hand |
| `pnpm link-env` | link the root env file into each app |
| `pnpm db:seed` | load the generic reference data (policy sectors, neutral cost methodology, external AI sources); same as `pnpm db:seed:reference` |
| `pnpm db:seed:kku` | load KKU's demo faculties, users and reference data (KKU developers only) |
| `pnpm adopter:fresh-check` | read-only check that an installation holds no KKU sample data and schedules nothing |
| `pnpm workshop:templates [--out DIR]` | write every XLSX import template to a folder, no app or DB needed |
| `pnpm workshop:mock <input.json>` | generate mock import spreadsheets for a workshop participant's university |
| `pnpm secrets:scan` | gitleaks scan of the working tree |
| `pnpm test` | run unit + integration tests across workspaces |
| `pnpm e2e` | Playwright end-to-end |
| `pnpm lint` | ESLint across workspaces |
| `pnpm typecheck` | `tsc --noEmit` across workspaces |
| `pnpm format` | Prettier write |
| `pnpm check` | lint + typecheck + test — run before committing |
| `pnpm docs:dev` | developer manual site (adopter docs) at `http://localhost:5173` |
| `pnpm docs:build` | build the manual to `apps/docs-site/dist/` and run its checks |
| `pnpm docs:preview` | serve the built manual |
| `pnpm storybook` | component Storybook (deferred — `packages/ui` has no Storybook config yet) |
| `pnpm clean` | remove `node_modules` / `dist` / `.next` / `coverage` |

This table covers the everyday commands. `package.json` holds about 130 more
for data capture, the program pipeline (`programs:*`), AI evals and connector
maintenance; those are documented on the page for the area they belong to.

The manual site renders `docs/` in place. A new doc must be added to `apps/docs-site/.vitepress/sidebar.ts` (or to `EXCLUDED` in `apps/docs-site/src/manifest.ts`), or `pnpm docs:build` fails; per-source specs under `docs/data-sources/` are picked up automatically.

## Layout

```
apps/
  web/            Next.js 14 (App Router)
  api/            NestJS
  ingestion/      NestJS standalone workers + connectors
  docs-site/      VitePress manual that renders docs/ in place

packages/
  shared/         Zod schemas, types, AI service, RBAC, decorators
  db/             Prisma schema, migrations, seed, XLSX import datasets
  ui/             shadcn-extended component library
  design/         Tokens (light + dark) + Tailwind preset
  pdf-templates/  Council Pack / brief templates rendered via Gotenberg

infra/
  postgres/       Custom Postgres image (postgis + pgvector + pg_trgm)
  gotenberg/      Gotenberg image with TH Sarabun New
  markitdown/     Document-to-Markdown sidecar for ingestion
  nginx/          Internal TLS + path routing (prod)
  systemd/        Backup, retention and scheduled-job timers (prod)

docs/           Architecture, data sources, methodologies, adopter + workshop docs (Thai in docs/th/)
prompts/        Session-by-session build manual
```

## Documentation

**Deployment + ops**
- [`DEPLOYMENT.md`](./DEPLOYMENT.md) — production deploy runbook (pack-and-ship)
- [`docs/deployment/kku-network-integration.md`](./docs/deployment/kku-network-integration.md) — KKU reverse-proxy handshake
- [`docs/backup-dr.md`](./docs/backup-dr.md) — backup classes + restore drill
- [`docs/migration-policy.md`](./docs/migration-policy.md) — forward-only schema policy
- [`docs/security-review.md`](./docs/security-review.md) — endpoint authz + dep audit snapshot

**Adopting the platform (other universities)**
- [`docs/adopters/README.md`](./docs/adopters/README.md) — adopter guide hub
- [`docs/data-import.md`](./docs/data-import.md) — XLSX data import
- [`docs/workshop/README.md`](./docs/workshop/README.md) — adopter workshop

**Guides**
- [`docs/guides/council-th.md`](./docs/guides/council-th.md) — Council (Thai)
- [`docs/guides/executive.md`](./docs/guides/executive.md) — VPs + Deans
- [`docs/guides/analyst.md`](./docs/guides/analyst.md) — daily cadence + runbook
- [`docs/guides/admin-runbook.md`](./docs/guides/admin-runbook.md) — IT ops

**AI + compliance**
- [`docs/ai-governance.md`](./docs/ai-governance.md) — model policy, eval, bias monitoring
- [`docs/pdpa.md`](./docs/pdpa.md) — personal-data inventory
- [`docs/dsar-workflow.md`](./docs/dsar-workflow.md) — data-subject request workflow

**Reference**
- [`CLAUDE.md`](./CLAUDE.md) — project conventions
- [`SECURITY.md`](./SECURITY.md) — vulnerability reporting
- [`docs/methodologies/README.md`](./docs/methodologies/README.md) — versioned metric formulas
- [`prompts/`](./prompts) — session-by-session build manual (GLOBAL-UPDATES, SKILLS, per-prompt)

**Build + release**
- `pnpm build:release 2.1.4` — pack the release into `dist/program-landscape-2.1.4.tar.zst` (+ `.sha256`); needs `zstd`
- `./deploy.sh` (on the prod server, from the unpacked bundle) — deploy; see [`DEPLOYMENT.md`](./DEPLOYMENT.md)

## Platform

- **Dev:** Windows via WSL2 (Ubuntu 24.04); also works on macOS / Linux.
- **Prod:** on-prem Ubuntu on KKU's internal network, Docker Compose v2,
  `linux/amd64` images loaded from the bundle (no registry pulls).
- **Node:** ≥ 24.22.1 on every machine; `zstd` on both build and prod machines.
- Public URL: `https://program-landscape.kku.ac.th` (KKU reverse proxy +
  internal nginx; end-to-end TLS). Pack-and-ship deploy — see `DEPLOYMENT.md`.
