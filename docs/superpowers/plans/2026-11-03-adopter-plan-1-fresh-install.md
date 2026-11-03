# Adopter Plan 1 — A fresh install runs nothing KKU-specific

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After `pnpm setup` on an empty database, nothing is scheduled, no mock connector can record a run, no KKU or mock row is seeded, and pipeline phase 4 skips cleanly when KKU's databases are not configured — while KKU's existing installs keep their schedules.

**Architecture:** Schedules become operator-owned (the catalog sync sets `scheduleEnabled` only when it creates a row, and creates it off). The scheduler and the runner both refuse mock implementations unless `ALLOW_MOCK_CONNECTOR_RUNS=true`. `prisma/seed.ts` stays as the KKU dev seed; a new generic reference seed is what setup runs.

**Tech Stack:** TypeScript strict, Prisma, BullMQ, Vitest, pnpm scripts.

**Spec:** `docs/superpowers/specs/2026-11-03-adopter-ready-deep-dive-design.md` (§7.1, §7.1b, D1, D2, D9). Plans 2–6 follow this one: 2 scoring hard-codes + KKU text, 3 new XLSX datasets, 4 public pulls, 5 curriculum PDF formats, 6 checklist + docs + KMUTT verification.

## Global Constraints

- No `any`; Zod at I/O; `@AuditLog()` on mutations (CLAUDE.md).
- Cross-platform scripts: no POSIX shell in pnpm scripts outside Docker, `path.join()`, `rimraf`.
- Never weaken the dev-safety guard; never run `db:reset`/`migrate reset` against the dev DB.
- No PII from `kmutt-data/` in code, tests, fixtures, docs or commit messages.
- KKU behaviour preserved (D1): an existing row's `scheduleEnabled` is never changed by sync except to force a deprecated source off.
- Env flag name, exact: `ALLOW_MOCK_CONNECTOR_RUNS` (`'true'` enables; anything else disables).
- Run skip code, exact: `MOCK_NOT_ALLOWED`.
- New pnpm scripts, exact names: `db:seed:reference`, `db:seed:kku`, `skills:tag-sectors`, `adopter:fresh-check`.
- Docs impact checked per task; `pnpm docs:build` when `docs/` changes.

## Review Focus

1. **KKU prod upgrade:** a `data_sources` row that is `scheduleEnabled=true` today must still be true after `data-sources:sync --apply` → Task 2 test `keeps an existing row's scheduleEnabled`.
2. **A brand-new connector added to the catalog later** lands with schedule off on every install, including KKU's → Task 2 test `creates new rows with schedule off`; release note in Task 7.
3. **Operator clicks "Run now" on a KKU example on an adopter box:** gets a clear SKIPPED run naming what to configure, `lastSyncedAt` untouched → Task 4 test.
4. **Re-running `db:seed:reference` on an install the operator already tuned** (sector multipliers, cost methodology text) must not overwrite it → Task 5 test `is idempotent and never overwrites`.
5. **Pipeline "Run" for a programme on an adopter box** must not mark the run failed because of phase 4 → Task 6 test.

---

### Task 1: Mark KKU examples in the catalog

**Files:**
- Modify: `packages/shared/src/ingestion/types.ts` (`SourceCatalogEntry`)
- Modify: `packages/shared/src/ingestion/catalog.ts`
- Test: `packages/shared/test/catalog-kku-examples.test.ts`

**Interfaces:**
- Produces: `SourceCatalogEntry.kkuExample?: boolean` — true for connectors that only work against KKU's internal systems. `isKkuExample(slug: string): boolean` exported from `catalog.ts`.

- [ ] **Step 1: Write the failing test** — `every kku-* and unicon-* slug is a KKU example`; `no xlsx-* slug and none of tcas, job-108, kmitl-skill-mapping, world-bank, openalex is a KKU example`; `jobthai ownerContact does not mention KKU` (`expect(entry.ownerContact ?? '').not.toMatch(/KKU/)`).
- [ ] **Step 2: Run** `pnpm --filter @kku/shared test catalog-kku-examples` → FAIL.
- [ ] **Step 3: Implement** the field, `isKkuExample`, set `kkuExample: true` on every `kku-*` and `unicon-*` entry, and neutralise `jobthai.ownerContact` to `'JobThai data delivery (operator-uploaded files)'`.
- [ ] **Step 4: Run** the test → PASS; `pnpm --filter @kku/shared typecheck` → clean.
- [ ] **Step 5: Commit** `feat(ingestion): mark KKU-internal connectors as KKU examples in the catalog`.

### Task 2: Catalog sync owns `scheduleEnabled` only on create

**Files:**
- Modify: `packages/db/src/data-source-sync.ts` (`SYNCED_COLUMNS`, `desiredRow`, `syncDataSourcesFromCatalog`)
- Test: `packages/db/test/data-source-sync-schedule.test.ts` (fake `dataSource` client, no live DB)

**Interfaces:**
- Consumes: Task 1 catalog.
- Produces: unchanged signature `syncDataSourcesFromCatalog(client?)`; behaviour: create → `scheduleEnabled: false`; update never touches `scheduleEnabled` unless `entry.deprecated` and the row is true (then sets false and reports `'scheduleEnabled'` in `changes`).

- [ ] **Step 1: Write the failing tests** — `creates new rows with schedule off` (every `create` call has `data.scheduleEnabled === false`, for every catalog entry); `keeps an existing row's scheduleEnabled` (existing row `{...desired, scheduleEnabled: true}` for `kku-registry` → no update call, counted `unchanged`); `forces a deprecated source off` (existing `kku-tcas-funnel` row true → update with `scheduleEnabled: false`).
- [ ] **Step 2: Run** `pnpm --filter @kku/db test data-source-sync-schedule` → FAIL.
- [ ] **Step 3: Implement.** Remove `scheduleEnabled` from the compared columns; add it to `create` as `false`; add the deprecated-force rule. Update the file's header comment to state the new ownership rule and why (D1).
- [ ] **Step 4: Run** the tests → PASS; also existing `packages/db/test/*data-source*` tests → PASS (adjust any that asserted the old overwrite, with a comment pointing at D1).
- [ ] **Step 5: Commit** `feat(data-sources): schedules are operator-owned; fresh rows start off`.

### Task 3: Scheduler skips unregistered and mock-only sources

**Files:**
- Modify: `apps/ingestion/src/queue/scheduler.ts`
- Modify: `apps/ingestion/src/ingestion.service.ts:102` (pass the registry)
- Create: `packages/shared/src/ingestion/mock-runs.ts` (+ export from the package index)
- Test: `apps/ingestion/test/scheduler.test.ts` (extend)

**Interfaces:**
- Produces: `mockRunsAllowed(env?: NodeJS.ProcessEnv): boolean` in `@kku/shared` (true only when `ALLOW_MOCK_CONNECTOR_RUNS === 'true'`). `new IngestionScheduler(queue, registry: Map<string, Connector>, env?: NodeJS.ProcessEnv)`. `registerSchedules()` returns `{ registered: number; skipped: number; skippedSlugs: { slug: string; reason: 'unregistered' | 'mock-only' }[] }`.

- [ ] **Step 1: Write the failing tests** — `skips a slug with no registered connector` (`the-rankings` → `reason: 'unregistered'`, no `add`); `skips a mock connector unless ALLOW_MOCK_CONNECTOR_RUNS=true` (registry entry `{ mocked: true }` → skipped `'mock-only'`; with env flag → registered); existing tests updated to pass a registry of real (`mocked: false`) fakes.
- [ ] **Step 2: Run** `pnpm --filter ingestion test scheduler` → FAIL.
- [ ] **Step 3: Implement** both skips; log one warn line per skipped slug with its reason.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(ingestion): never schedule unregistered or mock-only sources`.

### Task 4: Runner refuses mock implementations

**Files:**
- Modify: `apps/ingestion/src/connectors/runner.ts` (`run`, start of method; also fix the "Run `pnpm db:seed`" message to "Run `pnpm data-sources:sync --apply`")
- Test: `apps/ingestion/test/connector-lifecycle.test.ts` (extend, reuse its prisma mocks)

**Interfaces:**
- Consumes: `mockRunsAllowed` (Task 3).
- Produces: when `connector.mocked && !mockRunsAllowed()`: one `ingestionRun.create` with `status: 'SKIPPED'`, `errorCode: 'MOCK_NOT_ALLOWED'`, `completedAt` set, `errorMessage` = `This source has no real connection configured. Set CONNECTOR_<SLUG>_MODE=real and its connection settings, or load the matching spreadsheet dataset.` (with the real env key substituted, via the existing `slugToEnvKey` logic — export it from `connector-mode.ts` as `connectorModeEnvKey(slug)`); returns `{ status: 'SKIPPED', recordsLoaded: 0, recordsFailed: 0, runId }`; never calls `dataSource.update` (so `lastSyncedAt` is untouched) and never calls `fetch`.

- [ ] **Step 1: Write the failing tests** — `skips a mock connector with MOCK_NOT_ALLOWED and leaves lastSyncedAt alone`; `runs a mock connector when ALLOW_MOCK_CONNECTOR_RUNS=true` (existing lifecycle assertions hold).
- [ ] **Step 2: Run** `pnpm --filter ingestion test connector-lifecycle` → FAIL.
- [ ] **Step 3: Implement.** Set `ALLOW_MOCK_CONNECTOR_RUNS=true` in the ingestion vitest setup only where existing tests exercise mocks (prefer per-test `vi.stubEnv`).
- [ ] **Step 4: Run** the whole ingestion suite `pnpm --filter ingestion test` → PASS.
- [ ] **Step 5: Commit** `feat(ingestion): mock connectors record SKIPPED unless explicitly allowed`.

### Task 5: Split seeds — generic reference seed vs KKU dev seed

**Files:**
- Create: `packages/db/src/seed-reference.ts` — `seedReference(client: PrismaClient): Promise<SeedReferenceResult>` and `tagSkillSectors(client: PrismaClient): Promise<{ tagged: number }>`
- Create: `packages/db/prisma/seed-reference.ts` (CLI entry calling `seedReference`)
- Create: `apps/ingestion/src/scripts/tag-skill-sectors.ts` (CLI for `tagSkillSectors`)
- Modify: `packages/db/prisma/seed.ts` — call `seedReference` + `tagSkillSectors` instead of its own sector/external-source/cost-methodology code; move `buildSkills()` (500 synthetic skills) and the `NESDC-v1` demographic loop under `if (SEED_MOCKS)`; header comment: "KKU development seed — never run on an adopter install".
- Modify: `packages/db/package.json` (`seed` → `tsx prisma/seed-reference.ts`, add `seed:kku`), root `package.json`
- Test: `packages/db/test/seed-reference.test.ts` (live test DB, as other `packages/db` tests do; scoped to its own rows)

**Interfaces:**
- Produces: `SeedReferenceResult = { sectors: number; costMethodology: 'created' | 'kept'; externalAiSources: number }`. Root scripts: `db:seed` and `db:seed:reference` → reference seed; `db:seed:kku` → `prisma/seed.ts`; `db:reset` unchanged text but now reference-only (because it calls `db:seed`); `setup` appends `&& pnpm db:seed:reference`; `skills:tag-sectors` → the new CLI.
- Reference content, exact: the 8 sectors as in `seed.ts:861-870` (codes, names, multipliers unchanged); cost methodology `v1` description `Placeholder cost-allocation methodology. Replace once your finance office has agreed a cost-allocation method (docs/methodologies/cost-allocation.md).`; the external AI source list moved verbatim. **No** academic-year setting (the code's computed fallback stands; plan 6 documents setting it).

- [ ] **Step 1: Write the failing tests** — `is idempotent and never overwrites` (run twice; change a sector's multiplier and the cost description between runs; second run leaves both changed values); `contains nothing KKU-named` (static: read `seed-reference.ts` source text and the seeded rows' text fields; `expect(text).not.toMatch(/KKU|kku\.ac\.th|ขอนแก่น|มข\./)`); `tagSkillSectors tags by keyword` (two temp skills `ztest-solar-…`/`ztest-nursing-…` → BCG-GREEN / SC-MED; clean up).
- [ ] **Step 2: Run** `pnpm --filter @kku/db test seed-reference` → FAIL.
- [ ] **Step 3: Implement** the module, the CLIs and the script wiring.
- [ ] **Step 4: Verify** — tests PASS; `pnpm --filter @kku/db typecheck` clean; `node -e "const p=require('./package.json');process.exit(/db:seed:kku/.test(p.scripts.setup)?1:0)"` exits 0.
- [ ] **Step 5: Commit** `feat(db): generic reference seed for setup; KKU seed is opt-in`.

### Task 6: Phase 4 skips when KKU databases are not configured

**Files:**
- Create: `apps/ingestion/src/lib/kku-linkage-config.ts` — `kkuLinkageConfigured(env?: NodeJS.ProcessEnv): { ok: boolean; missing: string[] }`
- Modify: `apps/ingestion/src/scripts/programs-pipeline.ts:522-540`
- Test: `apps/ingestion/test/kku-linkage-config.test.ts`

**Interfaces:**
- Produces: `ok` only when every `KKU_REGISTRY_DB_{HOST,PORT,SERVICE,USER,PASSWORD}` and `KKU_HR_DB_{HOST,USER,PASSWORD}` is set, non-empty and not containing `REPLACE_ME`. When not ok, phase 4 pushes `{ name: 'phase4 Oracle/MSSQL (parallel)', durationMs: 0, costUsd: 0, ok: true, notes: 'skipped — KKU registry/HR databases not configured; load student cohorts, alumni cohorts and finance from the spreadsheet datasets' }` and runs no child script.

- [ ] **Step 1: Write the failing tests** — empty env → `ok: false` and `missing` lists all eight keys; `REPLACE_ME` value counts as missing; all set → `ok: true`.
- [ ] **Step 2: Run** `pnpm --filter ingestion test kku-linkage-config` → FAIL.
- [ ] **Step 3: Implement** the helper and the pipeline branch.
- [ ] **Step 4: Run** → PASS; `pnpm --filter ingestion test programs-pipeline` (existing) → PASS.
- [ ] **Step 5: Commit** `feat(pipeline): phase 4 skips cleanly without KKU databases`.

### Task 7: `.env.example`, fresh-install check, docs

**Files:**
- Modify: `.env.example` — generic defaults (`POSTGRES_USER=landscape`, `POSTGRES_PASSWORD=landscape_dev_password`, matching `DATABASE_URL`, `DEV_AUTH_PASSWORD=change-me-dev`); add `ALLOW_MOCK_CONNECTOR_RUNS=false` with a comment; move every `KKU_*`, `UNICON_*`, `DQ_API_BASE_URL`, `KKU_API_BASE_URL` block under one header `# ── KKU example connectors (off; only for Khon Kaen University's own systems) ──` with values `REPLACE_ME`; replace the stale `KKU_SSO_ISSUER/CLIENT_ID/...` keys with the keys the code reads (`apps/web/src/lib/auth.ts:25-28`, `apps/web/app/signin/page.tsx:40-45`), commented out.
- Create: `apps/ingestion/src/scripts/adopter-fresh-check.ts` (`pnpm adopter:fresh-check`) — read-only; prints counts of: `data_sources` with `scheduleEnabled=true`; users with `@kku.ac.th`; faculties; skills whose code starts with the synthetic prefix used by `buildSkills()`; `demographic_projections` with source `NESDC-v1`; `ingestion_runs` whose source is mocked and status SUCCEEDED. Exit 1 if any is non-zero (faculties excluded — an adopter may have imported theirs); allowlist the one `recruitment_program_overrides` KKU row and report it as "inert".
- Test: `packages/shared/test/env-example.test.ts` — `ALLOW_MOCK_CONNECTOR_RUNS=false` present; no `kku.ac.th` and no `KKU_SSO_ISSUER` outside the KKU-example section; every `KKU_*=` line sits below the KKU-example header.
- Docs: `README.md` (seed lines), `docs/data-sources.md` (lines 6, 108: rows come from `data-sources:sync`; fresh installs schedule nothing; how to switch a source on), `docs/migration-policy.md:20`, `DEPLOYMENT.md` upgrade note ("schedules are no longer changed by deploy; a connector added in a future release starts off — switch it on in /admin/data-sources"), `docs/guides/fresh-checkout-setup.md` seed mention.

- [ ] **Step 0: Check** `docker-compose.yml` reads `POSTGRES_USER/PASSWORD` from env (not literals) before changing their defaults; if it hard-codes `kku`, change both together and note in `docs/guides/fresh-checkout-setup.md` that existing dev volumes keep their old credentials.
- [ ] **Step 1: Write the failing env test** → run `pnpm --filter @kku/shared test env-example` → FAIL.
- [ ] **Step 2: Edit `.env.example`** → test PASS.
- [ ] **Step 3: Implement the check script.**
- [ ] **Step 4: Verify on a scratch database** — create `program_landscape_adopter_test` (createdb via the postgres container, not a reset), point `DATABASE_URL` at it in a shell-local env, run `pnpm db:migrate`, `pnpm data-sources:sync --apply`, `pnpm db:seed:reference`, then `pnpm adopter:fresh-check` → exit 0. Leave the database for plan 6.
- [ ] **Step 5: Docs** — edit the listed pages; `pnpm docs:build` → passes.
- [ ] **Step 6: Run** `pnpm check` → green (record pre-existing failures listed in CLAUDE.md separately, do not fix them here).
- [ ] **Step 7: Commit** `feat(adopter): generic .env.example, fresh-install check, docs`.
