# Workshop Session 5 — Retention and Completion Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the facilitator-held reference solution for a new Program Deep-Dive section, *Retention and completion*, and write the Session 5 workshop pages (EN + TH) that walk adopter IT teams through building the same section with an AI assistant.

**Architecture:** Two deliverables on two branches. (A) The reference solution — one query in `packages/db`, one endpoint, one type, one fetch, one section — is built on a local branch `workshop/session5-reference` cut from `feat/api-dataset-connectors`, exported with `git format-patch`, and **never merged or pushed** (participants must not find it in the repo; CLAUDE.md: "reference solution (instructor-held, outside the repo)"). (B) The workshop pages land on `feat/api-dataset-connectors`.

**Tech Stack:** Prisma, NestJS, Next.js 14 App Router, `@kku/ui` (`ChartFrame`, `TrendLine`), Vitest, VitePress docs site.

**Spec:** Claude doc "Workshop Session 5 Plan: Retention and Completion Chart" — https://claude.ai/artifact/TUtUAWV5t7u4wqu8HjBXUy (decided 2026-11-11). Context: `docs/superpowers/specs/2026-11-07-aiui-it-track-outline-design.md` (line 125) and `docs/superpowers/specs/2026-11-07-adopter-workshop-docs-design.md` (line 168, "Open: the coding storyline" — this plan settles it).

## Global Constraints

- Methodology version string: `retention-completion.v1`.
- Endpoint path: `GET /programs/:programId/retention-completion`.
- Default threshold: year-2 retention **80%**, a named exported constant (`RETENTION_THRESHOLD_DEFAULT = 0.8`) teams edit on Day 2.
- Rates by **reporting year** (`EnrollmentMetric.academicYear`, CE), denominators all `enrolled`:
  retention = `retainedYear2 / enrolled`, on-time = `graduatedOnTime / enrolled`, dropout = `dropouts / enrolled`.
- A year with `enrolled = 0` is omitted, never drawn as 0 (health-score null rule).
- Query must spread `realDataWhere()`.
- Programme scope only (Deep-Dive has no `?scope=`); access via `assertProgramAccessible`.
- UI English-only; colours via tokens only; chart through `ChartFrame` (no new chart library).
- No new tables or migrations.
- Workshop pages: `**Outcome.**` line in first 20 lines, `## Next step` section; Thai twin at `docs/th/workshop/` mirrors `##`/`###` headings and code blocks, linked both ways near the top; listed in `BILINGUAL_PAGES`.
- Never write the retired product names. No PII in pages or fixtures.

## Review Focus

1. **Programme with no enrolment rows** — section shows the import note for `enrollment-metrics`, not a blank chart (Task 3 empty-state check; Task 1 test `returns empty years`).
2. **A year with `enrolled = 0`** — year omitted, not a 0% point (Task 1 test).
3. **Rows from a mocked source** — excluded by `realDataWhere()` (Task 1 test asserts the `where` clause).
4. **API restarted stale after editing `packages/db`** — the page's troubleshooting entry tells teams to restart `pnpm dev` (Task 5).
5. **Ratios above 1 from dirty data** (e.g. `retainedYear2 > enrolled`) — reported as-is, not clamped; the methodology page says so (Task 1 test `does not clamp`, Task 4 doc).

---

## Part A — Reference solution (branch `workshop/session5-reference`, never pushed)

### Task 0: Cut the reference branch

- [ ] **Step 1:** `git switch -c workshop/session5-reference feat/api-dataset-connectors`
- [ ] **Step 2:** Confirm: `git branch --show-current` → `workshop/session5-reference`. Do **not** set an upstream.

### Task 1: Query `programRetentionCompletion`

**Files:**
- Create: `packages/db/src/retention-completion.ts`
- Modify: `packages/db/src/index.ts` (add `export * from './retention-completion';` beside line 27)
- Test: `packages/db/test/retention-completion.test.ts` (mock `prisma` the way `packages/db/test/program-deep-dive.test.ts:7-19` does)

**Interfaces:**
- Produces:
  ```ts
  export const RETENTION_COMPLETION_VERSION = 'retention-completion.v1';
  export const RETENTION_THRESHOLD_DEFAULT = 0.8;
  export interface RetentionCompletionYear {
    academicYear: number;        // CE, as stored
    enrolled: number;
    retentionRate: number;       // 0..1 (not clamped)
    onTimeGraduationRate: number;
    dropoutRate: number;
  }
  export interface ProgramRetentionCompletion {
    years: RetentionCompletionYear[];          // ascending academicYear
    threshold: number;                          // RETENTION_THRESHOLD_DEFAULT
    methodologyVersion: typeof RETENTION_COMPLETION_VERSION;
    freshnessDate: string | null;               // ISO, max EnrollmentMetric.freshnessDate
  }
  export function computeRetentionYears(rows: Pick<EnrollmentMetric,'academicYear'|'enrolled'|'retainedYear2'|'graduatedOnTime'|'dropouts'>[]): RetentionCompletionYear[];
  export async function programRetentionCompletion(programId: string): Promise<ProgramRetentionCompletion>;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
describe('computeRetentionYears', () => {
  it('computes the three rates over enrolled', () => {
    expect(computeRetentionYears([{ academicYear: 2023, enrolled: 200, retainedYear2: 170, graduatedOnTime: 120, dropouts: 30 }]))
      .toEqual([{ academicYear: 2023, enrolled: 200, retentionRate: 0.85, onTimeGraduationRate: 0.6, dropoutRate: 0.15 }]);
  });
  it('omits a year with enrolled = 0', () => {
    expect(computeRetentionYears([{ academicYear: 2022, enrolled: 0, retainedYear2: 0, graduatedOnTime: 0, dropouts: 0 }])).toEqual([]);
  });
  it('does not clamp ratios above 1', () => {
    expect(computeRetentionYears([{ academicYear: 2024, enrolled: 10, retainedYear2: 12, graduatedOnTime: 0, dropouts: 0 }])[0].retentionRate).toBe(1.2);
  });
  it('sorts ascending by academicYear', () => { /* input 2024, 2022 → output years [2022, 2024] */ });
});
describe('programRetentionCompletion', () => {
  it('filters with realDataWhere and the programme id', async () => {
    // mocks.enrollmentMetricFindMany resolves []
    await programRetentionCompletion('p-1');
    expect(mocks.enrollmentMetricFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { programId: 'p-1', ...realDataWhere() },
    }));
  });
  it('returns empty years, the default threshold, the version and null freshness when no rows', async () => {
    expect(await programRetentionCompletion('p-1')).toEqual({ years: [], threshold: 0.8, methodologyVersion: 'retention-completion.v1', freshnessDate: null });
  });
  it('freshnessDate is the newest row freshnessDate as ISO', async () => { /* rows 2024-03-01 and 2025-06-30 → '2025-06-30T00:00:00.000Z' */ });
});
```

- [ ] **Step 2:** `pnpm --filter @kku/db exec vitest run test/retention-completion.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement** in `retention-completion.ts`. `programRetentionCompletion` calls `prisma.enrollmentMetric.findMany({ where: { programId, ...realDataWhere() }, select: { academicYear, enrolled, retainedYear2, graduatedOnTime, dropouts, freshnessDate } })` then `computeRetentionYears`. Keep the file short and commented for teaching — it is what teams compare their AI's output against.
- [ ] **Step 4:** Same command → PASS (7 tests). Check the count: a narrowed include silently drops tests.
- [ ] **Step 5:** `git commit` — `feat(db): retention and completion query (workshop reference)`.

### Task 2: API endpoint

**Files:**
- Modify: `apps/api/src/programs/deep-dive.controller.ts` (import beside `programStudentCohorts` ~line 30; new handler after `student-cohorts` ~line 177)

**Interfaces:**
- Consumes: `programRetentionCompletion`, `RETENTION_COMPLETION_VERSION` from `@kku/db` (Task 1).
- Produces: `GET /programs/:programId/retention-completion` → envelope `{ data: ProgramRetentionCompletion, meta: { freshnessDate, sources, methodologyVersion } }`.

- [ ] **Step 1: Add the handler**, shaped like `overlap` (lines 276-286): `@Get('retention-completion')`, `@Authorized('programs:read:all')`, `@Provenance({ sources: [{ id: 'xlsx-enrollment-metrics', name: 'Enrolment metrics' }], methodologyVersion: RETENTION_COMPLETION_VERSION })`, `await assertProgramAccessible(programId, user)`, return `{ data, meta: { freshnessDate: data.freshnessDate } }`. Confirm the source id against the catalogue in `packages/shared/src/ingestion/catalog.ts`.
- [ ] **Step 2: Restart the API** (`nest --watch` ignores `packages/*`), then verify while signed in: `curl -s -b <cookie> http://localhost:<api-port>/api/v1/programs/<id>/retention-completion | jq '.data.years[0], .meta.methodologyVersion'` → a year object and `"retention-completion.v1"`. For an id with no rows → `years: []`.
- [ ] **Step 3:** `pnpm --filter api typecheck` → clean. Commit `feat(api): retention-completion endpoint (workshop reference)`.

### Task 3: Web section

**Files:**
- Modify: `apps/web/app/programs/[id]/types.ts` (add `DeepDiveRetentionCompletion` next to `DeepDiveStudentCohorts`, line ~397 — same fields as `ProgramRetentionCompletion`)
- Modify: `apps/web/app/programs/[id]/page.tsx` (add `apiFetchEnvelope<DeepDiveRetentionCompletion>(\`/programs/${id}/retention-completion\`).catch(() => null)` to the `Promise.all`; pass `retentionCompletion` + `retentionCompletionMeta` props)
- Create: `apps/web/app/programs/[id]/retention-completion-section.tsx`
- Modify: `apps/web/app/programs/[id]/client.tsx` (Props ~line 125; `SECTIONS` sub-entry `{ href: '#retention', label: 'Retention and completion' }` after `#cohorts` at line 251; render call after `<StudentCohortsSection>` ~line 441)

**Interfaces:**
- Consumes: the Task 2 envelope.
- Produces: `export function RetentionCompletionSection(props: { data: DeepDiveRetentionCompletion | null; meta: ApiMeta | null; canOpenDataSources: boolean }): JSX.Element`.

- [ ] **Step 1: Build the section.** `<Section id="retention" title="Retention and completion">` with `FreshnessBadge` + `ProvenanceButton` in `actions` (provenance fallback pattern: `overlap-section.tsx:107-121`). Body: `ChartFrame` with `chart={<TrendLine data series yTickFormatter={(v) => \`${v}%\`} ariaLabel=... />}` and a `dataTable` listing year, enrolled and the three rates. Series keys, in order: `Year-2 retention`, `On-time graduation`, `Dropout`, `Retention threshold (80%)` — the threshold is a flat series (value `threshold × 100` at every x); `TrendLine` has no reference-line prop and extending `@kku/ui` would add a sixth file to the exercise *(my call)*. Values are percentages rounded to 1 decimal. x = `academicYear + 543` (BE) to match the rest of the Deep-Dive *(my call — check `StudentCohortsSection` labels)*.
- [ ] **Step 2: Empty state.** `data == null || data.years.length === 0` → reuse `CohortImportNote` (client.tsx:1379) with `datasets={[{ slug: 'enrollment-metrics' }]}` (export it from client.tsx or move it to a shared file if needed — prefer exporting).
- [ ] **Step 3:** `pnpm --filter web typecheck && pnpm lint` → clean (lint catches hardcoded colours).
- [ ] **Step 4: See it.** Open `/programs/<id>#retention` for a programme with mock data: four lines, rail entry present, provenance drawer opens showing `retention-completion.v1`, "Show data" table matches `curl` output. A programme without rows shows the import note. Screenshot both for the facilitator guide.
- [ ] **Step 5:** Commit `feat(web): retention and completion section (workshop reference)`.

### Task 4: Methodology page and patch export

**Files:**
- Create: `docs/methodologies/retention-completion.md` (version table at top: `v1 · 2026-11-11`; formulas from Global Constraints; reporting-year basis and "entry-cohort basis is a later improvement"; ratios not clamped; `enrolled = 0` omitted; source `enrollment-metrics`)
- Modify: `docs/methodologies/README.md` (Implemented table row: `retention-completion` · Deep-Dive · `retention-completion.v1` · link)

- [ ] **Step 1:** Write both, commit `docs(methodology): retention-completion.v1 (workshop reference)`.
- [ ] **Step 2:** `pnpm check` on the branch → only the known pre-existing failures listed in CLAUDE.md.
- [ ] **Step 3: Export.** `git format-patch feat/api-dataset-connectors..workshop/session5-reference -o <outside-repo>/session5-reference/` → 4 patch files. Record the path in the facilitator handoff (not in the repo).
- [ ] **Step 4: Expected values.** For the reference mock set, hand-compute one year's three rates from the enrolment workbook and save them with the patches (`expected-values.md`). These feed Session 6.
- [ ] **Step 5:** `git switch feat/api-dataset-connectors`. Verify `git log origin/feat/api-dataset-connectors..workshop/session5-reference` is never pushed.

---

## Part B — Workshop pages (branch `feat/api-dataset-connectors`)

### Task 5: English Session 5 page and wiring

**Files:**
- Create: `docs/workshop/05-curriculum-analytics.md`
- Modify: `apps/docs-site/src/manifest.ts` (add `'workshop/05-curriculum-analytics.md'` beside line 47), `apps/docs-site/.vitepress/sidebar.ts` (EN entry after line 85), `docs/workshop/README.md` (schedule row: drop "page coming soon" for session 5; Pages table row; the "Sessions 4 and 5 are still in preparation" sentence becomes session 4 only), `docs/workshop/facilitator.md` (session 5 link + rescue: apply the patch at 15:45 with `git am`), `docs/workshop/troubleshooting.md` (two entries below), `docs/workshop/03-university-data.md` ("Next step" points to session 5 while 4 is pending — or to 4 if it exists by then)

**Page outline** (headings are the contract the Thai twin mirrors):
- `# Session 5: AI-assisted curriculum analytics` · Thai link · `**Outcome.** Your programme's Deep-Dive shows a new *Retention and completion* chart, built by you with an AI assistant, with its provenance drawer working.`
- `## What you are building` — the chart, the three formulas, the 80% threshold, screenshot from Task 3.
- `## The five files` — the ordered list from the spec doc (file path + one line each), framed as the checklist to review the AI's diff against; recall Session 2's Finance trace.
- `## Step 1: the query and the endpoint` — starter prompt (code block) naming `programStudentCohorts` as the pattern, `realDataWhere()`, the version string and the constant; restart the API; the `curl` check.
- `## Step 2: the section` — starter prompt naming `ChartFrame`, `TrendLine`, `overlap-section.tsx` for provenance, the empty state; browser check.
- `## Check one number by hand` — pick one year in your own enrolment workbook, compute retention, compare with "Show data"; write it down for Session 6.
- `## Stretch goals` — methodology page; Vitest for the query; faculty benchmark line.
- `## You are done when` — section visible for your programme; provenance drawer shows `retention-completion.v1`; one rate checked by hand.
- `## Next step` — Session 6.

**Troubleshooting entries:** "New endpoint returns 404 / old shape → API was not restarted after editing `packages/db`" and "Section shows the import note although data is loaded → rows came from a mocked source or have no ingestion run; see `realDataWhere()`".

- [ ] **Step 1:** Write the page and the wiring edits.
- [ ] **Step 2:** `pnpm docs:build` → passes (dead links, page shape, retired names).
- [ ] **Step 3:** Dry-read the page with the reference solution *not* applied: each starter prompt names every file and identifier a team needs. Commit `docs(workshop): session 5 — retention and completion chart`.

### Task 6: Thai twin

**Files:**
- Create: `docs/th/workshop/05-curriculum-analytics.md` (same `##` headings translated, same code blocks and prompts kept in English since the UI and code are English; `**ผลลัพธ์**` line; `## ขั้นต่อไป`)
- Modify: `apps/docs-site/src/manifest.ts` (`BILINGUAL_PAGES` entry), `apps/docs-site/.vitepress/sidebar.ts` (TH entry after line 195), `docs/th/workshop/README.md`, `docs/th/workshop/03-university-data.md` (Next step), `docs/th/workshop/troubleshooting.md` — mirror Task 5.

- [ ] **Step 1:** Write the twin and wiring; add the reciprocal language links near the top of both pages.
- [ ] **Step 2:** `pnpm docs:build` → passes.
- [ ] **Step 3:** Commit `docs(workshop): Thai twin of session 5`.

### Task 7: Status and spec bookkeeping

- [ ] **Step 1:** In `docs/superpowers/specs/2026-11-07-adopter-workshop-docs-design.md` "Open: the coding storyline", record the decision (enrolment metrics via the mock API → Retention and completion section) and that session 4's page must load `enrollment-metrics` through the API connector.
- [ ] **Step 2:** Update CLAUDE.md "Adopter workshop docs" line: session 5 page done; reference patch held outside repo. Add a decisions-log entry.
- [ ] **Step 3:** Commit `docs: record session 5 storyline decision`.
