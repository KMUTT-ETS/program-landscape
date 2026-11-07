# Testing and CI

> **ภาษาไทย:** [ฉบับภาษาไทย](../th/guides/testing-and-ci.md)

**Outcome.** You can run the test suites, know what they protect, and keep CI green on your fork.

## Running tests

| Command | Scope |
|---|---|
| `pnpm test` | Vitest across all workspaces — 118 test files, ~1,400 cases |
| `pnpm e2e` | Playwright (`apps/web/e2e/`) — needs `npx playwright install` first |
| `pnpm lint` | ESLint across `apps/**` and `packages/**` |
| `pnpm typecheck` | `tsc --noEmit` across workspaces |
| `pnpm check` | lint + typecheck + test. **Run before every commit** |
| `pnpm ai:eval` | 25 gold-question AI evaluation suite |

A full `pnpm test` reports a higher case count than the ~1,400 above because of `.each` expansions.

## What the tests are actually protecting

The test suite is unusually weighted toward **pure functions with policy content** rather than integration coverage: status-transition graphs and role gating, health-score null handling, connector transform mappings, the rank-mapping prefix-ordering edge cases, the prompt-standard conformance ratchet, AUN-QA criteria structure, safety-refusal patterns. That is a deliberate choice — these are the places where a silent regression changes what the Council is told.

When you write your own connectors, follow the existing pattern: a fixture under `apps/ingestion/test/fixtures/<slug>/`, and a transform test that asserts every code in the fixture has a mapping. The `kku-registry` status-mapping coverage test is the model — it guards against the registrar quietly adding a new status code.

## CI

`.github/workflows/` has four workflows: `pr.yml`, `release.yml`, `e2e.yml`, `load.yml`.

`pr.yml` runs a migration linter for destructive DDL, lints **changed files only**, typechecks, runs Prisma generate, spins up Postgres with pgvector, applies migrations against a test database, and runs tests.

**Known state you inherit:** `PR checks` is green end-to-end. `Release bundle` (on tag push) runs a full repo-wide `pnpm lint` and is **red on a pre-existing lint backlog** — not on any individual change. The local pack-and-ship tarball is the real release artifact. You may want to clear that backlog early so a red CI badge means something in your fork.

## Next step

Continue with [Deploy and size the infrastructure](./deploy.md).
