# Program Landscape

Strategic decision-support platform for **Khon Kaen University Council**.
Analyzes 297 academic programs against future trends, financial
sustainability, and labor market demand.

Internal codename: *Curriculum Compass* / *ทักษทัศน์*.

**Status:** hardened + production-shippable. 8 modules functional; security
+ observability + AI governance pass complete (prompt 13); pack-and-ship
deployment pipeline ready (prompt 13b). Real-data connectors land with
prompt 14. See `CLAUDE.md` → *Current status* for the full checklist.

<p align="left">
  <a href="https://github.com/khon-kaen-university/program-landscape/actions/workflows/pr.yml"><img alt="CI" src="https://github.com/khon-kaen-university/program-landscape/actions/workflows/pr.yml/badge.svg" /></a>
  <a href="https://github.com/khon-kaen-university/program-landscape/actions/workflows/release.yml"><img alt="Release" src="https://github.com/khon-kaen-university/program-landscape/actions/workflows/release.yml/badge.svg" /></a>
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-internal-lightgrey" /></a>
</p>

## Getting started (dev — WSL2 / macOS / Linux)

```bash
cp .env.example .env
pnpm setup          # install deps, start infra, migrate, seed
pnpm dev            # run web + api + ingestion in parallel
```

Then open:

- `http://localhost:3000` — web (Next.js)
- `http://localhost:4000/healthz` — api (NestJS)
- `http://localhost:9001` — MinIO console
- `http://localhost:3001` — Gotenberg (PDF generation)

## Scripts (all `pnpm`, no Makefile — primary dev machine is Windows)

| Command | Purpose |
|---|---|
| `pnpm setup` | install deps, start infra, migrate, seed |
| `pnpm dev` | run web + api + ingestion in parallel |
| `pnpm db:up` | start postgres + redis + minio + gotenberg |
| `pnpm db:down` | stop the infra containers |
| `pnpm db:reset` | drop volumes + migrate + seed (dev only) |
| `pnpm db:migrate` | apply pending Prisma migrations |
| `pnpm db:seed` | seed without dropping |
| `pnpm test` | run unit + integration tests across workspaces |
| `pnpm e2e` | Playwright end-to-end |
| `pnpm lint` | ESLint across workspaces |
| `pnpm typecheck` | `tsc --noEmit` across workspaces |
| `pnpm format` | Prettier write |
| `pnpm check` | lint + typecheck + test — run before committing |
| `pnpm storybook` | shadcn/ui component Storybook |
| `pnpm clean` | remove `node_modules` / `dist` / `.next` / `coverage` |

## Layout

```
apps/
  web/         Next.js 14 (App Router)
  api/         NestJS
  ingestion/   NestJS standalone workers

packages/
  shared/      Zod schemas, types, AI service, RBAC, decorators
  db/          Prisma schema, migrations, seed
  ui/          shadcn-extended component library
  design/      Tokens (light + dark) + Tailwind preset

infra/
  postgres/    Custom Postgres image (postgis + pgvector + pg_trgm)

docs/          Architecture, data sources, methodologies, design system
prompts/       Session-by-session build manual
```

## Documentation

**Deployment + ops**
- [`DEPLOYMENT.md`](./DEPLOYMENT.md) — production deploy runbook (pack-and-ship)
- [`docs/deployment/kku-network-integration.md`](./docs/deployment/kku-network-integration.md) — KKU reverse-proxy handshake
- [`docs/backup-dr.md`](./docs/backup-dr.md) — backup classes + restore drill
- [`docs/migration-policy.md`](./docs/migration-policy.md) — forward-only schema policy
- [`docs/security-review.md`](./docs/security-review.md) — endpoint authz + dep audit snapshot

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
- `pnpm build:release 1.0.0` — pack the release into `dist/program-landscape-1.0.0.tar.gz`
- `ssh kku-prod ./deploy.sh` — deploy on the prod server

## Platform

- **Dev:** Windows via WSL2 (Ubuntu 24.04); also works on macOS / Linux.
- **Prod:** on-prem Ubuntu on KKU's internal network, Docker Compose v2.
- Public URL: `https://program-landscape.kku.ac.th` (KKU reverse proxy +
  internal nginx; end-to-end TLS). Pack-and-ship deploy — see prompt 13b.
