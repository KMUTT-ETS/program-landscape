# Adopter Plan 4 — Public and external data

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An adopting Thai university can fill the deep-dive's population, peer-ranking, publication, skill-demand and TCAS inputs from real public sources (pulled by a connector the operator switches on) or, where no public source is usable, from a spreadsheet — with every needed credential listed in `.env.example`.

**Architecture:** New connectors follow the existing connector contract (`apps/ingestion/src/connectors/`, catalogue entry `mocked: false`, `scheduleEnabled: false`, run via "Run now" or a schedule the operator enables). New spreadsheets follow the import framework (`packages/db/src/import/`). Two reference tables gain a nullable `ingestion_run_id` so uploads can be started over. Readers that must choose between several sources use one shared picker.

**Tech Stack:** TypeScript strict, Prisma (hand-written additive migrations), Node streams (gzip CSV), fetch, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-03-adopter-ready-deep-dive-design.md` (§7.3, O2, O3, D6). Plans 1–3 are done.

**Verified facts (web check 2026-11-03):**
- UN WPP 2024 bulk CSV, no credential: `https://population.un.org/wpp/assets/Excel%20Files/1_Indicator%20(Standard)/CSV_FILES/WPP2024_Population1JanuaryBySingleAgeSex_Medium_2024-2100.csv.gz` (~68 MB gz, UTF-8 BOM, columns `…,ISO3_code,…,Time,…,AgeGrp,AgeGrpStart,…,PopTotal`; population in thousands; filter `ISO3_code = THA`). The Data Portal API needs a bearer token (process unverified) — not used.
- SCImago returns 403 to automated clients; QS/THE publish no data → rankings come from a spreadsheet.
- TCAS69 round-3 file: `https://assets.mytcas.com/69/TCAS69-R3-MinMax-10June26.xlsx`; file names are not uniform; the list page is `https://www.mytcas.com/stat` (loads with a browser user-agent).
- OpenAlex: `https://api.openalex.org/works?filter=authorships.institutions.id:<id>&per-page=200&cursor=*`; a free API key (`api_key=`) is required for cursor paging past the first page; without one the budget is tiny. KMUTT's institution id is `I60837268` (confirm per adopter via ROR).
- The OpenAlex connector was deleted in commit `59838994`; recover with `git show 59838994^:apps/ingestion/src/connectors/sources/kku-research/connector.openalex.ts` (and `transforms.openalex.ts`).

## Global Constraints

- No `any`; Zod at I/O; `@AuditLog()` on mutations; cross-platform Node code (no shell-outs).
- New connectors: catalogue entry with `mocked: false`, `scheduleEnabled: false`, neutral `ownerContact`, not `kkuExample`; registered in `apps/ingestion/src/connectors/registry.ts` with a real factory (mock = same class or a stub that writes nothing); every written row stamped with the run's `ingestionRunId`; outbound requests use `outboundUserAgent()` (`packages/shared/src/institution.ts`) unless the site refuses bot user-agents, in which case follow the existing browser-UA precedent and say so in a comment.
- Credentials and settings go in `.env.example` (commented, with how to obtain each), and the env-example test from plan 1 stays green (no active `REPLACE_ME`).
- New spreadsheets: declaration + `xlsx-<slug>` catalogue entry + raw-view fetcher/title/link + docs section, as in plan 3; `clear` deletes only rows of the dataset's own runs.
- KKU unchanged: with KKU's data (NESDC source, its seeded rankings, its connectors), every reader returns what it returns today.
- Methodology/prompt versioning per CLAUDE.md and `docs/prompt-standard.md` when a formula or prompt changes.
- DB-backed tests only on the scratch DB via `on-scratch-db.cjs`; network is never hit in tests (fixtures + mocked fetch).
- Docs per task: `docs/data-sources/<slug>.md` for each new connector (follow `docs/data-sources/_template.md`), `docs/data-import.md` for each new spreadsheet, `docs/data-sources/README.md` status table. `pnpm docs:build` passes.

## Review Focus

1. **Two population sources present** (KKU's NESDC rows and a UN or spreadsheet series): every reader uses the same picked source; the scenarios/analyst readers stop mixing duplicates → Task 1 test.
2. **Organisation region with no regional series in the chosen source** (UN is national only): the health driver stays null with its existing reason, the outlook still shows national figures → Task 1 test.
3. **OpenAlex author matching on a common Thai name**: exact matches only; a name shared by two staff is not attributed to either (left unmatched) → Task 3 test.
4. **An OpenAlex paper already uploaded via the publications spreadsheet** (same author + DOI): no duplicate row → Task 3 test.
5. **mytcas.com/stat unreachable or changed**: the connector falls back to the built-in list (now including TCAS69) and reports which list it used → Task 5 test.

---

### Task 1: Population projections — source picker, spreadsheet, UN pull

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (`DemographicProjection.ingestionRunId String? @map("ingestion_run_id")`, SetNull relation, index); Create migration `packages/db/prisma/migrations/20261104090000_demographic_projection_run/migration.sql`
- Create: `packages/db/src/projection-source.ts` — `pickProjectionSource(opts: { cohort: string; needRegion?: string; client?: PrismaClient }): Promise<string | null>`
- Modify readers: `packages/db/src/health-score.ts` (~2318 `DEMOGRAPHIC_PROJECTION_SOURCE`, `computeRequiredShareAt10Y`), `packages/db/src/program-deep-dive.ts` (~2672 `CANONICAL_SOURCE`), `apps/api/src/scenarios/scenarios.service.ts:~462`, `apps/api/src/analyst/tool-executor.service.ts:~366`
- Create: `packages/db/src/import/datasets/population-projections.ts` (slug `population-projections`, title "Population Projections")
- Create: `apps/ingestion/src/connectors/sources/un-wpp/connector.ts` + `transforms.ts` (slug `un-wpp`, name "UN World Population Prospects 2024")
- Modify: catalogue, registry (import + connector), `.env.example` (`UN_WPP_CSV_URL` commented with the default above, `UN_WPP_COUNTRY_ISO3` commented default `THA`), docs
- Tests: `packages/db/test/projection-source.test.ts`, `packages/db/test/import-datasets-population-projections.test.ts`, `apps/ingestion/test/un-wpp/transforms.test.ts` (small gz fixture built in the test from a few CSV lines incl. BOM and a non-THA row)

**Interfaces:**
- Source preference, exact: spreadsheet sources (`source` starting `xlsx:`) > `UN-WPP2024` > `NESDC-PopProj-2010-2040` > anything else; within the preference, a source is eligible only if it has a `TH` row for the cohort at the current year; with `needRegion`, only sources that also have that region for the cohort. `null` when none.
- Health driver: `pickProjectionSource({ cohort, needRegion: resolvedRegion })`; unchanged null reasons. Deep-dive outlook: national block from `pickProjectionSource({ cohort })`, regional comparator from `pickProjectionSource({ cohort, needRegion })` (may differ; the response's `source` names the national one, add `comparatorSource`). Scenarios/analyst: filter by `pickProjectionSource({ cohort: '18-22' })`.
- Spreadsheet: `Region` (text; `TH` = national; guide: must match the organisation profile region exactly to drive the score), `Year` (CE, 2000–2100), `Age Group` (`15-17` / `18-22` / `23-29`), `Population` (persons, integer > 0), `Source Name` (required free text, e.g. "NESDC 2023 edition"; stored as `xlsx:<name>`). Upsert on (Region, Year, Age Group, Source Name); `freshnessDate` = upload date.
- UN connector: stream-gunzip the CSV, parse line by line (handle the BOM and quoted fields), keep `ISO3_code = UN_WPP_COUNTRY_ISO3`, `Variant = Medium`, `Time` from current year to current year + 25; sum single ages into `15-17`, `18-22`, `23-29`; `population = round(PopTotal × 1000)`; write region `TH`, source `UN-WPP2024`, upsert on the unique key. Snapshot semantics: re-running replaces its own rows only.

- [ ] **Step 1: Failing tests** — picker: `prefers spreadsheet over UN over NESDC`, `skips a source without the national current-year row`, `needRegion excludes UN (national only)`, `KKU data → NESDC`; dataset: `refuses BE year`, `refuses unknown age group`, `stores source as xlsx:<name>`, `clear only deletes this dataset's runs`; UN transforms: `aggregates single ages into cohorts`, `multiplies thousands`, `ignores other countries and BOM`; reader wiring: `outlook national from UN while comparator from NESDC` (scratch DB).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**; `pnpm db:generate`; apply migration on scratch DB via wrapper. **Step 4: Run** → PASS; typecheck db/api/ingestion; docs build.
- [ ] **Step 5: Commit** `feat(demographics): source picker, population spreadsheet and UN WPP pull`.

### Task 2: University rankings spreadsheet (peer benchmarking)

**Files:**
- Modify: `schema.prisma` (`RankedUniversity.ingestionRunId String?`, SetNull, index); migration `20261104091000_ranked_university_run`
- Create: `packages/db/src/import/datasets/ranked-universities.ts` (slug `ranked-universities`, title "University Rankings") with `prefill` = the starter list
- Move the curated list from `apps/ingestion/src/scripts/seed-ranked-universities.ts` into `packages/db/src/ranked-universities-starter.ts` (exported constant; the seed script imports it); remove KKU-relative wording ("at or above KKU's rank") from comments and data notes
- Modify: `packages/shared/src/ai/prompts/program-peer-selection.ts` line ~133 "Thai universities ranked at or above ${inst.shortNameEn}" → "Thai universities in the candidate list (this institution is excluded)"; bump `PROGRAM_PEER_SELECTION_VERSION` v2 → v3 with history comment + bookkeeping (method-catalog, docs, bundle tests)
- Modify: catalogue entries `the-rankings`, `qs-rankings`, `scimago` → `deprecated: true` with a note pointing to the spreadsheet (they have no connector)
- Docs, registry, catalogue, raw view
- Test: `packages/db/test/import-datasets-ranked-universities.test.ts`

**Interfaces:**
- Sheet: `University` (required; must equal the English name the institution uses — the own institution's row is excluded from peers only when this equals the organisation profile `nameEn`), `Country` (required), `Region` (World / Asia / Southeast Asia / Thailand — exact values `TIER_BY_REGION` expects in `apps/ingestion/src/program-peers/select.ts:~46`), `Ranking Year` (CE), `QS World Rank`, `THE World Rank`, `QS Asia Rank`, `THE Asia Rank` (optional positive integers), `Website`. Upsert on (University, Ranking Year). The template download is pre-filled with the starter list (current QS/THE 2025 values) so an adopter edits rather than types.
- Guide note: SCImago Institutions Rankings (scimagoir.com, country filter `?country=THA`) is a free source to copy Thai ranks from; QS/THE figures are copied from their public tables.

- [ ] **Step 1: Failing tests** — `refuses an unknown region naming allowed values`; `prefill returns the starter list`; `starter list contains no KKU-relative text`; `peer selection excludes the own institution by profile nameEn` (pure: candidate filter); `clear only deletes this dataset's runs`.
- [ ] **Step 2–4:** run → FAIL, implement (migration on scratch DB), run → PASS, typecheck, docs build.
- [ ] **Step 5: Commit** `feat(peers): university rankings spreadsheet with a starter list`.

### Task 3: OpenAlex publications pull

**Files:**
- Modify: `OrganizationProfile` (`openalexInstitutionId String? @map("openalex_institution_id")`), migration `20261104092000_org_openalex_id`; `packages/shared/src/organization/schema.ts` (input schema: optional, pattern `^I\d+$`), `packages/shared/src/institution.ts` (`Institution.openalexInstitutionId: string | null`), `packages/db/src/organization.ts`, the API organization controller/service, `apps/web/app/admin/organization/client.tsx` (field "OpenAlex institution ID" with help text: find it at openalex.org by searching your university, e.g. KMUTT `I60837268`)
- Create: `apps/ingestion/src/connectors/sources/openalex-works/connector.ts` + `transforms.ts` (slug `openalex-works`, name "OpenAlex publications"), revived from `59838994^` with these changes: institution id from `getInstitution().openalexInstitutionId` (skip with a clear reason when unset); `api_key` from `OPENALEX_API_KEY` (required — skip with reason when unset); `OPENALEX_YEAR_FROM` (default 2015); `per-page=200`; no KKU strings
- Modify: catalogue, registry, `.env.example` (`OPENALEX_API_KEY` commented, "free key: https://openalex.org/settings/api"; `OPENALEX_YEAR_FROM`), docs (`docs/data-sources/openalex-works.md`)
- Test: `apps/ingestion/test/openalex-works/transforms.test.ts`, `.../load.test.ts` (scratch DB)

**Interfaces:**
- Author match, exact only, in order: ORCID → `openalexAuthorId` → `nameEn` (lower-cased, trimmed) → `nameTh`; a name that matches more than one staff member is left unmatched. Name matches write ORCID/OpenAlex id back to `faculty_members` only when the target column is null and no other member holds that id (the columns are unique).
- Rows: one `research_outputs` row per (work, matched author), `source = 'openalex'`, `openalexId`, `doi` (normalised as the spreadsheet does), `title`, `venue`, `year`, `type` (JOURNAL / CONFERENCE / PATENT / BOOK collapse from v1), `citations`, `ingestionRunId`. Unmatched institution authors: one row with `facultyMemberId = null` and `kkuAuthorName` = display name (existing column, keep name).
- Dedupe with the spreadsheet: before creating, find an existing row for the same `facultyMemberId` and normalised `doi` (any source); if found, set `openalexId` and raise `citations` (never lower), keep its provenance; otherwise upsert on (`openalexId`, `facultyMemberId`).

- [ ] **Step 1: Failing tests** — `skips without institution id` / `without api key` with reasons; `ambiguous name stays unmatched`; `ORCID beats name`; `existing spreadsheet row with same DOI is enriched, not duplicated`; `cursor pagination follows next_cursor` (mocked fetch); org profile `rejects a malformed OpenAlex id`.
- [ ] **Step 2–4:** run → FAIL, implement, run → PASS (web tests for the form if any), typecheck all touched packages, docs build.
- [ ] **Step 5: Commit** `feat(research): OpenAlex publications pull by institution id`.

### Task 4: Career skill-demand spreadsheet (fallback for the KMITL API)

**Files:**
- Create: `packages/db/src/import/datasets/career-skill-demand.ts` (slug `career-skill-demand`, title "Career Skill Demand")
- Modify: registry (after `programme-courses`), catalogue, raw view, docs; `.env.example` KMITL block comment: how to request credentials from KMITL (direct contact) and that the spreadsheet is the fallback
- Test: `packages/db/test/import-datasets-career-skill-demand.test.ts`

**Interfaces:**
- Writes `kmitl_careers` and `kmitl_career_skill_demands` (readers: `computeKmitlProgramAlignment` health-score.ts ~2269 — rows with `percentage >= 5` and a resolved `skillId`; `strategic_sector_alignment` ~2142 — `groupName` in `STRATEGIC_KMITL_GROUPS` ~2028; pipeline phase 3 `apps/ingestion/src/program-careers/map.ts` picks `kmitlCareerId`s from `kmitl_careers`).
- Sheet: `Career Group` (required; guide lists the strategic names `IT`, `Engineer`, `Health Science`, `Smart Farmer`, `New S Curve`, `Food` and says other names are allowed but score as non-strategic), `Career Sub-group`, `Career` (required), `Skill` (required; English or Thai skill name), `Scope` (Thailand / Global), `Data Source` (Job postings / Profiles), `Share of Postings (%)` (0–100, same unit the readers compare with 5 — confirm from the connector transform and state it).
- Loader: careers upserted by (Career Group, Career Sub-group, Career) with synthetic `kmitlCareerId` allocated as the next value below the current minimum negative id (KMITL's ids are positive); group/sub-group ids likewise negative; skill resolved with the connector's `buildSkillLookup`/`resolveSkillId` (`apps/ingestion/src/connectors/sources/kmitl-skill-mapping/transforms.ts:~189` — move the pure resolver to `packages/db` or `packages/shared` so both use it) — unresolved skills are stored with `skillId = null` and counted in the upload result; the guide says to upload after the programme pipeline has built skills, and to re-upload to resolve more.
- Strategy: `upsert` on (Career Group, Career Sub-group, Career, Skill, Scope, Data Source). `clear` deletes demand rows then careers of this dataset's runs.
- KMITL connector coexistence: check its load for a whole-table delete; if it has one, scope it to rows not stamped by `xlsx-career-skill-demand` with a mocked test (same pattern as plan 3).

- [ ] **Step 1: Failing tests** — `refuses a percentage above 100`; `allocates negative career ids, stable on re-upload`; `resolves skills by English and Thai name`; `labour_market_alignment reads an imported row` (scratch DB: programme skill + demand ≥ 5 → value not null); `clear only deletes this dataset's runs`.
- [ ] **Step 2–4:** run → FAIL, implement, run → PASS, typecheck, docs build.
- [ ] **Step 5: Commit** `feat(import): career skill-demand spreadsheet as the KMITL fallback`.

### Task 5: TCAS file discovery and job-108 identity

**Files:**
- Modify: `apps/ingestion/src/connectors/sources/tcas/connector.ts` (add `https://assets.mytcas.com/69/TCAS69-R3-MinMax-10June26.xlsx` to `TCAS3_FILES` with its year; add `discoverTcasFiles(html: string): TcasFile[]` that reads `https://www.mytcas.com/stat` and keeps `.xlsx` links under `assets.mytcas.com` whose name marks round 3 max/min — `maxmin`, `MinMax`, `r3` case-insensitive — deriving the BE year from the path segment or `TCAS6x`; merge with the built-in list, de-duplicated; on fetch/parse failure use the built-in list; record `fileListSource: 'discovered' | 'built-in'` in run metadata; rename `findKkuMatch` → `findOwnProgrammeMatch` and `kkuUnmatched` metadata keys → `ownUnmatched` keeping behaviour)
- Modify: job-108 connector and catalogue notes — user-agent from `outboundUserAgent('job-108')`, no KKU strings
- Docs: `docs/data-sources/tcas.md` (adding a year; organisation Thai name must equal the TCAS สถาบัน spelling; campus not distinguished), `docs/data-sources/job-108.md` (opt-in: switch the schedule on in /admin/data-sources)
- Test: `apps/ingestion/test/tcas/discover.test.ts` (fixture HTML with the 62–69 links and noise links), existing TCAS tests stay green

- [ ] **Step 1: Failing tests** — `discovers round-3 files and years from the stat page`; `ignores non-round-3 and non-xlsx links`; `falls back to the built-in list on failure and reports it`; `built-in list includes TCAS69`; job-108 `uses the organisation user-agent`.
- [ ] **Step 2–4:** run → FAIL, implement, run → PASS, typecheck, docs build.
- [ ] **Step 5: Commit** `feat(tcas): discover yearly files; organisation identity for job-108`.
