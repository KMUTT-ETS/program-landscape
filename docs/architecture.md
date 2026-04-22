# Architecture

Placeholder. Filled in as the system evolves (prompts 01 → 13b).

## Monorepo layout

```
apps/
  web/         Next.js 14 (App Router) — user-facing UI
  api/         NestJS — main API surface
  ingestion/   NestJS standalone — PDF intake, connectors, BullMQ workers

packages/
  shared/      Zod schemas, types, decorators, AI service wrapper, RBAC
  db/          Prisma schema, migrations, scope-aware query helpers
  ui/          shadcn-extended component library + Storybook
  design/      Design tokens (light + dark) + Tailwind preset

infra/
  postgres/    Custom postgres image (postgis + pgvector + pg_trgm)

docs/          This folder
prompts/       Session-by-session build manual
```

## Deployment topology (high level)

- **Dev:** WSL2 Ubuntu, docker-compose, ports exposed locally.
- **Prod:** On-prem Ubuntu server on KKU's internal network.
  - KKU university reverse proxy terminates public TLS for
    `program-landscape.kku.ac.th`, re-encrypts to us on `:8443` (self-signed).
  - Internal nginx handles path routing (`/api/*` → api, `/*` → web).
  - Images never pulled from Docker Hub — shipped as a tarball via the
    pack-and-ship workflow (prompt 13b).

## Non-negotiables (see CLAUDE.md for the full list)

- Multi-level scope (university / faculty / department / program) baked into
  every API and every view.
- Provenance, confidence, freshness, audit, AI logging on every output.
- Methodology versioning on every metric.
