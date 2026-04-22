# Program Landscape

Strategic decision-support platform for **Khon Kaen University Council**.
Analyzes 297 academic programs against future trends, financial
sustainability, and labor market demand.

Internal codename: *Curriculum Compass* / *ทักษทัศน์*.

**Status:** under construction — see `CLAUDE.md` → *Current status* for the
checklist of prompts completed.

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

- `CLAUDE.md` — project conventions (read at every Claude Code session start)
- `prompts/README.md` — build plan, prompt sequence, cadence
- `prompts/GLOBAL-UPDATES.md` — cross-cutting requirements
- `prompts/SKILLS.md` — which Claude skills to invoke per session
- `prompts/WINDOWS-DEV.md` — Windows/WSL2 dev setup
- `docs/design-system.md` — aesthetic direction (expanded in prompt 02b)
- `docs/auth/kku-sso.md` — KKU SSO configuration
- `docs/methodologies/` — per-metric methodology (versioned)

## Platform

- **Dev:** Windows via WSL2 (Ubuntu 24.04); also works on macOS / Linux.
- **Prod:** on-prem Ubuntu on KKU's internal network, Docker Compose v2.
- Public URL: `https://program-landscape.kku.ac.th` (KKU reverse proxy +
  internal nginx; end-to-end TLS). Pack-and-ship deploy — see prompt 13b.
