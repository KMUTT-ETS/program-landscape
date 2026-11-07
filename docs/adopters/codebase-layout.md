# How the codebase is laid out

> **ภาษาไทย:** [ฉบับภาษาไทย](../th/adopters/codebase-layout.md)

**Outcome.** You know where each part of the code lives and which rules every change must keep.

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
  design/      Design tokens (OKLCH) + the Tailwind preset. See guides/rebrand.md.
  pdf-templates/  React components rendered to HTML, then to PDF by Gotenberg.

docs/          See the appendix for the full map.
prompts/       The original Claude Code build manual. See guides/extend-with-claude-code.md.
infra/         Docker build contexts — postgres (with extensions), gotenberg,
               nginx, systemd units.
scripts/       Release build, deploy, backup, restore, rollback, smoke test,
               env linking, migration linting.
```

## Two orientation rules that save time

**`packages/db/src/` is the analytical heart, not `apps/api/`.** The API layer is thin. Health scoring, risk scoring, gap analysis, benchmarking, the deep-dive queries, the data-quality provenance filter — all of it is in `packages/db/src/*.ts` as explicitly-typed exported functions. When you want to know "how is this number computed", start there, not in a controller.

**`packages/shared/` must never import `packages/db/`.** The dependency runs one way (`db` depends on `shared`). If you need a Prisma-backed implementation of a `shared` interface, the concrete class lives in `db` and is injected — `packages/db/src/ai-inference-recorder.ts` is the canonical example of this pattern.

## The Council-readiness rules

Six rules apply to every module, endpoint, and UI surface. They are listed in `CLAUDE.md` and audited by the twelve gates in `docs/readiness-checklist.md`:

1. `<ProvenanceButton>` on every chart — opens a drawer with sources, freshness, calculation method, methodology version, caveats.
2. `<ConfidenceBadge>` plus clickable sources plus a "disagree" affordance on every AI output.
3. `<FreshnessBadge>` on every data point.
4. `@AuditLog()` on every mutation (`apps/api/src/common/decorators.ts`).
5. `@AiCall()` on every AI call (same file).
6. Every metric carries a `methodologyVersion`, and the methodology doc is versioned in git under `docs/methodologies/`.

If you are adding a surface and it does not have these, it is not finished. This is what makes the output defensible in a Council meeting, and it is the part of the codebase most tempting to skip and most expensive to retrofit.

## Next step

Continue with [Getting started](../tutorials/getting-started.md).
