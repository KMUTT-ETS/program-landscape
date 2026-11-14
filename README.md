# Program Landscape

Strategic decision-support platform for a university's council and top
management. It analyses a university's academic programmes against future
trends, financial sustainability and labour-market demand, at university,
faculty, department and programme scope.

> **This repository is a fork of Khon Kaen University's Program Landscape.**
> The platform was designed and built by and for **Khon Kaen University
> (KKU)**, where it runs in production for the KKU Council under its canonical
> name *Program Landscape — KKU Curriculum Intelligence Platform* (upstream:
> [`khon-kaen-university/program-landscape`](https://github.com/khon-kaen-university/program-landscape)).
>
> This fork branched from upstream at **v2.1.4** (2026-10-10). It prepares the
> code and docs for **other universities that adopt the platform**, in
> particular for the [adopter workshop](./docs/workshop/README.md). Some parts
> have been made institution-neutral — the default seed, the first-run setup,
> data loading and the adopter docs — so an adopter can run the app on its own
> data without any KKU data. KKU-specific pieces (KKU connectors, the KKU demo
> seed, KKU's production deployment notes) are still in the tree, are marked
> as such below, and are not needed for an adopter installation.
>
> Copyright in the original work remains with Khon Kaen University. See
> [Licence and attribution](#licence-and-attribution).

**Status of this fork:** all 8 modules from upstream are present. Added here
for adopters: XLSX data import (26 datasets), API dataset connectors
(`pnpm connector:new`, `pnpm connector:verify`), the first-run `/setup`
wizard, the adopter docs site (English + Thai) and the workshop materials. See
`CLAUDE.md` → *Current status* for the full checklist.

<p align="left">
  <a href="./LICENSE"><img alt="License: CC BY-NC-SA 4.0" src="https://img.shields.io/badge/license-CC%20BY--NC--SA%204.0-lightgrey" /></a>
</p>

## For workshop participants

Start at **[`docs/workshop/README.md`](docs/workshop/README.md)**
(ภาษาไทย: [`docs/th/workshop/README.md`](docs/th/workshop/README.md)).
In short:

1. Work through [Before the day](docs/workshop/00-before-the-day.md): install
   the prerequisites, start the app once and pick your data path.
2. Load **your own university's** data: real exports, real exports with
   generated gaps, or a mock set from `pnpm workshop:mock`. No KKU data is
   needed. Remove personal data (national ID numbers, birth dates) first.
3. On a fresh installation, the first visitor to `/setup` claims the
   `SUPER_ADMIN` account.
4. Run `pnpm adopter:fresh-check` to confirm the installation holds no KKU
   sample data and schedules nothing.

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

`pnpm setup` loads only the generic reference seed, so a new installation
starts empty of institution data. Load yours with the XLSX import
(`/admin/data-setup`, see [`docs/data-import.md`](docs/data-import.md)) or an
API dataset connector (see
[`docs/tutorials/load-data-from-an-api.md`](docs/tutorials/load-data-from-an-api.md)).

## Scripts (all `pnpm`, no Makefile — the primary dev machine is Windows)

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
| `pnpm connector:new` | scaffold an API dataset connector for your own institution's API |
| `pnpm connector:verify <slug>` | read-only check that a connector is done (no FAIL lines) |
| `pnpm link-env` | link the root env file into each app |
| `pnpm db:seed` | load the generic reference data (policy sectors, neutral cost methodology, external AI sources); same as `pnpm db:seed:reference` |
| `pnpm adopter:fresh-check` | read-only check that an installation holds no KKU sample data and schedules nothing |
| `pnpm workshop:templates [--out DIR]` | write every XLSX import template to a folder, no app or DB needed |
| `pnpm workshop:mock <input.json>` | generate mock import spreadsheets for a workshop participant's university |
| `pnpm workshop:mock-api` | serve a mock HTTP/JSON API to practise writing a connector against |
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
| `pnpm db:seed:kku` | *KKU only* — load KKU's demo faculties, users and reference data; adopters do not need it |

This table covers the everyday commands. `package.json` holds about 130 more
for data capture, the program pipeline (`programs:*`), AI evals and connector
maintenance; those are documented on the page for the area they belong to.
Connectors named `kku-*` read KKU's internal systems and are useful to an
adopter only as examples to copy (see
[`docs/tutorials/adapt-the-registrar-connector.md`](docs/tutorials/adapt-the-registrar-connector.md)).

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
prompts/        Session-by-session build manual (from upstream)
```

## Documentation

**Adopting the platform**
- [`docs/adopters/README.md`](./docs/adopters/README.md) — adopter guide hub
- [`docs/workshop/README.md`](./docs/workshop/README.md) — adopter workshop
- [`docs/data-import.md`](./docs/data-import.md) — XLSX data import
- [`docs/guides/write-a-connector.md`](./docs/guides/write-a-connector.md) — write a connector for your own systems
- [`docs/guides/rebrand.md`](./docs/guides/rebrand.md) — replace KKU's marks and colours with your own
- [`docs/guides/upstream-fixes.md`](./docs/guides/upstream-fixes.md) — keep a fork mergeable with upstream fixes

**Guides**
- [`docs/guides/executive.md`](./docs/guides/executive.md) — VPs + Deans
- [`docs/guides/analyst.md`](./docs/guides/analyst.md) — daily cadence + runbook
- [`docs/guides/council-th.md`](./docs/guides/council-th.md) — Council (Thai)
- [`docs/guides/deploy.md`](./docs/guides/deploy.md) — deploy on your own server

**AI + compliance**
- [`docs/ai-governance.md`](./docs/ai-governance.md) — model policy, eval, bias monitoring
- [`docs/pdpa.md`](./docs/pdpa.md) — personal-data inventory
- [`docs/dsar-workflow.md`](./docs/dsar-workflow.md) — data-subject request workflow

**Operations**
- [`docs/backup-dr.md`](./docs/backup-dr.md) — backup classes + restore drill
- [`docs/migration-policy.md`](./docs/migration-policy.md) — forward-only schema policy
- [`docs/security-review.md`](./docs/security-review.md) — endpoint authz + dep audit snapshot

**Reference**
- [`CLAUDE.md`](./CLAUDE.md) — project conventions
- [`SECURITY.md`](./SECURITY.md) — vulnerability reporting
- [`docs/methodologies/README.md`](./docs/methodologies/README.md) — versioned metric formulas
- [`docs/licensing.md`](./docs/licensing.md) — what CC BY-NC-SA 4.0 means for this project
- [`prompts/`](./prompts) — session-by-session build manual (GLOBAL-UPDATES, SKILLS, per-prompt)

**KKU-only (kept from upstream, not needed by adopters)**
- [`DEPLOYMENT.md`](./DEPLOYMENT.md) — KKU's production deploy runbook (pack-and-ship)
- [`docs/deployment/kku-network-integration.md`](./docs/deployment/kku-network-integration.md) — KKU reverse-proxy handshake
- [`docs/guides/admin-runbook.md`](./docs/guides/admin-runbook.md) — KKU IT ops

## Build, release and platform

- **Dev:** Windows via WSL2 (Ubuntu 24.04); also works on macOS / Linux.
- **Node:** ≥ 24.22.1 on every machine; `zstd` on both build and server
  machines.
- **Release bundle:** `pnpm build:release <version>` packs every
  `linux/amd64` image into `dist/program-landscape-<version>.tar.zst`
  (+ `.sha256`). On the server, `./deploy.sh` from the unpacked bundle loads
  the images (no registry pulls) and runs Docker Compose v2.
- **Your own deployment:** see [`docs/guides/deploy.md`](./docs/guides/deploy.md).
  The reference deployment is KKU's — on-prem Ubuntu behind the university
  reverse proxy with end-to-end TLS, documented in `DEPLOYMENT.md`.

## Licence and attribution

Program Landscape is © 2026 Khon Kaen University and is licensed under
[CC BY-NC-SA 4.0](./LICENSE). This fork is a derivative work under the same
licence: it credits KKU as the original author, records that changes were made
(see the fork notice above and the git history after v2.1.4), and may not be
used commercially. Anyone who adopts it must keep this attribution, release
their own changes under the same licence, and replace KKU's marks with their
own ([`docs/guides/rebrand.md`](./docs/guides/rebrand.md)).
