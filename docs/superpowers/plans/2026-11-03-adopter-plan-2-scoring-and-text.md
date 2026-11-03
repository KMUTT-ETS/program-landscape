# Adopter Plan 2 — Scoring hard-codes and KKU text on the deep-dive path

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The health score and the deep-dive read the adopting university's own region and faculty teaching modes instead of KKU's, and no user-facing text on the deep-dive path (deep-dive, its print page, sign-in, data-setup, programme admin, programme list) says "KKU" — with KKU's own scores unchanged.

**Architecture:** Region comes from `getInstitution().regionEn` (the organisation profile), resolved against the regions present in `demographic_projections`, falling back to national `'TH'`. The student:staff-ratio band becomes a nullable `Faculty.sfrBand` column, filled for KKU by a migration that runs only when the installation is KKU, and set by adopters through a new optional column in the faculties spreadsheet. Text uses the organisation short name passed down from server components.

**Tech Stack:** TypeScript strict, Prisma migrations (hand-written SQL), Next.js server/client components, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-03-adopter-ready-deep-dive-design.md` (§7.1 "Hard-coded KKU behaviour in scoring" and "Text", D3, D4). Plan 1 (`docs/superpowers/plans/2026-11-03-adopter-plan-1-fresh-install.md`) is done.

**Scope notes (decided while planning):**
- The Thai rankings tier is already institution-aware in code (`apps/ingestion/src/program-peers/select.ts:80` excludes the own institution by name; the prompt reads `getInstitution()`); the KKU-relative part lives only in the seeded data, which plan 4's rankings dataset replaces. No code change here.
- `jobThaiCoverage()` (`packages/db/src/jobthai.ts:52`) has no reader anywhere; its Khon Kaen count is dead code. Not touched.

## Global Constraints

- No `any`; Zod at I/O; design tokens only; English UI labels (CLAUDE.md).
- KKU's scores must not move (D3): with KKU's organisation profile (`regionEn: 'Northeast'`) and KKU's faculty codes, every driver value is identical to before.
- Methodology versioning: one bump for this plan, `HEALTH_SCORE_VERSION` `health-score.v5.4` → `health-score.v5.5`; update `docs/methodologies/health-score.md` (revision row: "region and teaching-mode band read from organisation data; no change for KKU") and follow whatever `packages/db/src/methodology-bundle.ts` requires when a stamped version changes (bundle tag/fingerprint and its tests).
- New enum name, exact: `SfrBand` with values `CLINICAL`, `STEM_LAB`, `STUDIO`, `PROFESSIONAL`, `HUMANITIES`. New column: `faculties.sfr_band` (`Faculty.sfrBand SfrBand?`).
- Faculties spreadsheet column, exact header: `Teaching Mode`; accepted values (case-insensitive) `Clinical`, `Lab-based`, `Studio`, `Professional`, `Humanities`; blank allowed.
- Never write a real person's name or email into code, docs or commit messages (the sign-in page currently hard-codes a staff member's mailto — replace it, never copy it).
- No PII from `kmutt-data/`. Never touch the owner's dev DB beyond running `prisma migrate deploy`-style additive migrations on the scratch DB `program_landscape_adopter_test`.
- Docs impact checked per task; `pnpm docs:build` when `docs/` changes.

## Review Focus

1. **KKU installation after upgrade:** the migration fills `sfr_band` for KKU's existing faculties so scores don't move; an adopter install with a faculty coded `EN` must NOT get KKU's band → Task 2 tests `backfill applies only when the profile is KKU` (SQL condition) and `band falls back to PROFESSIONAL`.
2. **Region typed differently from the projection data** (`"northeast"`, `"Bangkok"`, `"ภาคตะวันออกเฉียงเหนือ"`): must fall back to national, not to null → Task 1 test cases.
3. **Organisation profile not yet set** when a score is computed (fresh install before `/admin/organization`): `getInstitution()` throws `OrganizationNotConfiguredError` → region resolution must treat that as unset and use `'TH'` → Task 1 test.
4. **A faculties upload with an unknown teaching mode** (`"Lab"`, `"Engineering"`): refused, naming the row and the allowed values → Task 2 validation test.
5. **The guard test over-matching** route paths and env names (`/api/auth/kku-sso`, `KKU_SSO_*`, `@kku/` imports): allowed; a literal "KKU" in rendered copy fails → Task 3 allowlist cases.

---

### Task 1: Region-aware demographic resilience and outlook

**Files:**
- Create: `packages/db/src/projection-region.ts` — `resolveProjectionRegion(regionEn: string | null | undefined, availableRegions: readonly string[]): string` and `projectionRegionForInstitution(availableRegions: readonly string[]): string`
- Modify: `packages/db/src/health-score.ts:2340-2355` (`computeRequiredShareAt10Y`), `packages/db/src/program-deep-dive.ts` (~2482-2750, the comparator region and the `catchmentRegion` type)
- Modify: `packages/db/src/health-score.ts:225` (version), `docs/methodologies/health-score.md`, methodology-bundle files as required
- Test: `packages/db/test/projection-region.test.ts`

**Interfaces:**
- Produces: `resolveProjectionRegion` — exact match first, then case-insensitive trimmed match against `availableRegions`; anything else (null, empty, no match) → `'TH'`. `projectionRegionForInstitution` reads `getInstitution().regionEn`, catching `OrganizationNotConfiguredError` and `OrganizationNotLoadedError` as unset. The deep-dive comparator field `catchmentRegion: string` (was `'Northeast' | 'TH'`); its label in the UI reads the region name (Task 3 owns UI copy).
- `computeRequiredShareAt10Y` queries the distinct `region` values for its `source` once (cache per call is fine) and uses the resolved region instead of `'Northeast'`.

- [ ] **Step 1: Write the failing tests** — `exact match`: (`'Northeast'`, `['TH','Northeast','Central']`) → `'Northeast'`; `case-insensitive`: (`' northeast '`) → `'Northeast'`; `unknown region falls back to TH`: (`'Bangkok'`) → `'TH'`; `null falls back to TH`; `profile not configured → TH` (stub `getInstitution` to throw `OrganizationNotConfiguredError` via `setOrganizationForTest(undefined)` or the shared test helper used elsewhere); `KKU reference profile → Northeast` (`setOrganizationForTest(KKU_REFERENCE_ORGANIZATION)`).
- [ ] **Step 2: Run** `pnpm --filter @kku/db exec vitest run test/projection-region.test.ts` → FAIL.
- [ ] **Step 3: Implement** the module and wire both call sites; bump the version; update the methodology doc and bundle.
- [ ] **Step 4: Run** the new test and every `packages/db` test that does not need live data and mentions `health-score`, `methodology-bundle` or `demographic` → PASS; `pnpm --filter @kku/db typecheck` clean.
- [ ] **Step 5: Commit** `feat(health-score): demographic region comes from the organisation profile (v5.5)`.

### Task 2: Teaching-mode band stored on the faculty

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (enum `SfrBand`, `Faculty.sfrBand SfrBand? @map("sfr_band")`)
- Create: `packages/db/prisma/migrations/20261103120000_faculty_sfr_band/migration.sql` — create enum, add nullable column, then backfill KKU's map **only when** `EXISTS (SELECT 1 FROM organization_profile WHERE name_en = 'Khon Kaen University')`, `WHERE sfr_band IS NULL`, using the exact code→band pairs currently in `SFR_BAND_BY_FACULTY` (`packages/db/src/health-score.ts:~1535`). Check the exact `name_en` KKU's profile carries in `packages/shared/src/organization/kku-reference.ts` and use that string.
- Modify: `packages/db/src/health-score.ts` — delete `SFR_BAND_BY_FACULTY`; band = `faculty.sfrBand ?? 'PROFESSIONAL'` (export a pure `sfrBandFor(sfrBand: SfrBand | null): SfrBand`); ensure the query that loads the programme's faculty selects `sfrBand`.
- Modify: `packages/db/src/import/datasets/faculties.ts` — optional column `Teaching Mode` → `sfrBand` (mapping: Clinical→CLINICAL, Lab-based→STEM_LAB, Studio→STUDIO, Professional→PROFESSIONAL, Humanities→HUMANITIES); the guide sheet text explains it in one sentence each; blank leaves the stored value untouched on update and null on insert.
- Docs: `docs/data-import.md` (faculties columns), `docs/methodologies/health-score.md` (the band now comes from the faculty's teaching mode; default Professional).
- Test: `packages/db/test/sfr-band.test.ts` (pure: `sfrBandFor`), the faculties dataset's existing test file (find it under `packages/db/test/import-*`) extended with the column cases; a migration SQL test asserting the backfill statement is guarded by the KKU profile condition (read the file text).

**Interfaces:**
- Consumes: Task 1's version bump (same `health-score.v5.5`; do not bump again).
- Produces: `Faculty.sfrBand`, `sfrBandFor`.

- [ ] **Step 1: Write the failing tests** — `band falls back to PROFESSIONAL` (`sfrBandFor(null)`); `stored band wins` (`sfrBandFor('CLINICAL')`); faculties dataset: `accepts Teaching Mode values case-insensitively`, `refuses an unknown teaching mode naming row and allowed values` (`'Lab'` → error message contains `Clinical, Lab-based, Studio, Professional, Humanities`), `blank teaching mode is allowed`; `backfill applies only when the profile is KKU` (migration text contains the `EXISTS (SELECT 1 FROM organization_profile` guard and every code from the old map).
- [ ] **Step 2: Run** the three test files → FAIL.
- [ ] **Step 3: Implement** schema, migration (hand-written; do not use `prisma migrate dev`), reader, dataset column, docs. Run `pnpm db:generate`.
- [ ] **Step 4: Apply on the scratch DB only** — with `DATABASE_URL` pointed at `program_landscape_adopter_test` (assert `current_database()` first; never print the URL), run `pnpm db:migrate` → applies cleanly; confirm `faculties.sfr_band` exists and is null (no KKU profile there).
- [ ] **Step 5: Run** the tests → PASS; typecheck `@kku/db` and `api` clean (the import parser lives in `apps/api/src/import/`; run its tests for the faculties template if any).
- [ ] **Step 6: Commit** `feat(health-score): student:staff band from the faculty's teaching mode`.

### Task 3: Organisation name on the deep-dive and its print page

**Files:**
- Modify: `apps/web/app/programs/[id]/page.tsx` (breadcrumb ~149-150; pass `orgShortNameEn` and `orgShortNameTh` to the client), `apps/web/app/programs/[id]/client.tsx`, `apps/web/app/programs/[id]/overlap-section.tsx`, `apps/web/app/programs/[id]/print/page.tsx`
- Create: `apps/web/test/no-kku-copy.test.ts` — the guard test
- Test: the guard test

**Interfaces:**
- Consumes: `brandingForRequest()` (`apps/web/src/lib/branding.ts:49`) or `getOrganizationProfile()` from `@kku/db` for the short names; when no profile exists use the product defaults the chrome already falls back to (read `branding.ts` and reuse them, do not invent new ones).
- Produces: `assertNoKkuCopy(files: readonly string[]): { file: string; line: number; text: string }[]` exported from the test file's helper `apps/web/test/helpers/kku-copy.ts`, reused by Task 4. A hit is a line containing `KKU`, `มข.` or `Khon Kaen`/`ขอนแก่น` that is not a comment line (`//`, `*`, `{/*`) and does not match the allowlist: `@kku/`, `kku-sso`, `KKU_` (env names), `kkuExample`, `KKU-SEQ-` (programme codes in data, if any are rendered from data they are not literals).

Replacement rules (apply to every hit in these four files; earlier recon listed them at `client.tsx` 485, 1798, 1839, 1846, 2054, 2069, 2080, 2521, 3093, 3177, 3264, 3710, 3820, 3995, 4350, 4418, 4440, 4566, 4987, 5147, 5281; `overlap-section.tsx:115`; `page.tsx:149-150`; `print/page.tsx` 256-260, 649, 2680, 2692 — re-grep, line numbers drift):
- "KKU" as the university in prose/labels → `{orgShortNameEn}` ("Competition vs {org}", "{org} min score", "Same-level {org} programmes", "Where {org} leads"); Thai `มข.` → `{orgShortNameTh}`. Breadcrumb university crumb → `{orgShortNameTh} (ภาพรวม) / {orgShortNameEn}`.
- Empty states that name a KKU system ("KKU-Alumni connector", "KKU-HR cube", "KKU Publications mirror", "POWERBI.ADMISSION_STAT…", `kku-dq`, "KKU's Digital Intelligence test", `pnpm programs:link-financials`, `pnpm peers:select`) → name the spreadsheet dataset that fills the section and link to `/admin/data-setup` (use the dataset titles from `packages/db/src/import/datasets/*.ts`; for publications say "publication records (spreadsheet or OpenAlex)"; for digital competency say "digital competency results"; for peers say "Run the programme pipeline (peer benchmarking phase)").
- "KKU intake-floor policy" → "{org} intake-floor policy".
- Print page "KKU Program Landscape" / "internal KKU use" → "Program Landscape" / "internal {org} use".

- [ ] **Step 1: Write the guard test** over the four files plus allowlist unit cases (`'import { x } from "@kku/db"'` → no hit; `"href='/api/auth/kku-sso/start'"` → no hit; `'<span>KKU</span>'` → hit; `'// KKU note'` → no hit).
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run test/no-kku-copy.test.ts` → FAIL listing the hits.
- [ ] **Step 3: Replace** the copy per the rules; thread the org names as props.
- [ ] **Step 4: Run** the guard test → PASS; `pnpm --filter web typecheck` clean; `pnpm --filter web test` → no new failures.
- [ ] **Step 5: Commit** `feat(deep-dive): show the organisation's own name; empty states point to spreadsheets`.

### Task 4: Organisation name on sign-in, admin and programme list; leftover seed hints

**Files:**
- Modify: `apps/web/app/signin/sign-in-form.tsx` (no `admin@kku.ac.th`/`kku-dev` pre-fill even with `devHints`; the dev-account list shows nothing KKU — if it lists seeded accounts, show it only when a user with that email exists, or drop it; button label `Continue with {ssoLabel}` where `ssoLabel` = `{orgShortNameEn} SSO` when the profile exists else `single sign-on`; SSO error strings say "single sign-on"), `apps/web/app/signin/page.tsx` (contact link → `mailto:` the profile's `contactEmail`, hidden when null; tagline ~242 → organisation-neutral), `apps/web/app/admin/data-setup/page.tsx` (~218, 377, 403, 430: no "KKU", no "5 currently live (kku-registry…)", no "KKU Library"), `apps/web/app/admin/programs/page.tsx:~109`, `apps/web/app/programs/page.tsx:~62` ("of the N canonical {org} programs" with the real count, not 297), `apps/web/app/page.tsx` (~262, 292, 413), `apps/web/src/components/shell/role-switcher.tsx:~235` ("SSO roles"), `apps/web/src/components/data-source-mark.tsx:~38`.
- Modify (parked from plan 1): `apps/web/app/admin/dashboard-data-fetch/satisfaction-refresh-bar.tsx:~86`, `research-refresh-bar.tsx:~87`, `student-dq-refresh-bar.tsx:~93` ("run `pnpm db:seed`" → "run `pnpm data-sources:sync --apply`"); comments in `packages/db/test/aunqa-overview-mirror.test.ts:~34`, `apps/api/test/api.e2e.test.ts:~7,77,92`, `apps/ingestion/src/scripts/audit-data-sources.ts:~25`.
- Modify: `packages/shared/src/ingestion/catalog.ts` — `ownerContact` values naming KKU on entries that are NOT `kkuExample` (e.g. scimago "KKU Library", digital-transcript) → neutral role text ("Institution library", "Registrar") — leave `kkuExample` entries alone.
- Test: extend `apps/web/test/no-kku-copy.test.ts` with every web file above; extend `packages/shared/test/catalog-kku-examples.test.ts`: `no non-example ownerContact mentions KKU`.

**Interfaces:**
- Consumes: Task 3's `assertNoKkuCopy` helper and the org short-name source.

- [ ] **Step 1: Extend the tests** → run → FAIL.
- [ ] **Step 2: Replace** the copy; keep KKU's own experience sensible (KKU's profile short name is "KKU", so KKU still sees "KKU SSO").
- [ ] **Step 3: Run** the guard test, the catalog test, `pnpm --filter web test`, `pnpm --filter web typecheck`, `pnpm --filter @kku/shared test` → no new failures.
- [ ] **Step 4: Commit** `feat(web): organisation-neutral sign-in, admin and list copy`.
