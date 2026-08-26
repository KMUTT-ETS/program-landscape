# Teaching & Learning analysis (AUN-QA v4) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new top-level `Teaching & Learning` section: a faculty readiness overview, and a per-programme analysis organised along the AUN-QA v4 criteria, with an on-demand AI self-assessment draft per criterion.

**Architecture:** The criteria and their evidence bindings are ONE DATA TABLE in `@kku/shared`. A resolver layer in `packages/db` turns a binding into `{available, value, sourceLabel, freshness}` for a programme. The API composes criteria + evidence + completeness; the pages render them. Adding a future data source is a registry entry plus one resolver — never a page change.

**Tech Stack:** TypeScript strict (`noUncheckedIndexedAccess`, no `any`), Prisma, NestJS, Next.js 14, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-26-teaching-learning-aunqa-design.md` — read it before Task 1, including the caveat at its top.

---

## Read this before writing any code

**The criteria list is unverified.** It comes from the assistant's knowledge of AUN-QA v4, not from any document in this repository. Encode it as data with a header comment saying exactly that, so a later correction against the official guide is an edit to one table. Do not spread criterion names or numbering into component code, prompt text, or database columns.

**Two criteria have no data and are omitted from the body** — 6 (Student Support Services) and 7 (Facilities & Infrastructure). The page states once that they are outside the platform's data. A QA officer must not infer that six criteria are all there are.

**Measured coverage today:** C1 281/301 programmes · C2 285 · C3 **13** (see Task 1) · C4 123,329 class offerings · C5 3,839 staff · C8 239 graduate-outcome / 81 DQ / 11,804 alumni rows.

---

## Task 1: Restore criterion 3 — the pedagogy re-run

**Files:** none changed. This task VERIFIES and then hands a command to the operator.

Criterion 3's evidence is `program_pedagogy_assessments`, which covers 13 programmes: **8 at the stale `program-pedagogy.v1`** and **5 at the current `v1.1`**. The cause was a schema bug in v1.0 — `min(5)` on method names rejected the 3–4-character acronyms real disciplines use (PBL, OSCE, EBM, Lab), so most medical and science programmes failed validation. It was fixed in v1.1 and never re-run. **280 programmes have a curriculum document**, so the ceiling is ~275 new assessments.

- [ ] **Step 1: Confirm the diagnosis on real programmes**

Run the generator for THREE programmes that currently have no assessment and whose disciplines were the ones v1.0 failed on — pick a medical, a science and a humanities programme:

```bash
docker exec program-landscape-postgres psql -U kku -d program_landscape -c "
SELECT p.code, p.name_en, f.name_th
FROM programs p JOIN faculties f ON f.id = p.faculty_id
JOIN program_documents d ON d.program_id = p.id
LEFT JOIN program_pedagogy_assessments a ON a.program_id = p.id
WHERE a.id IS NULL AND p.level='BACHELOR'
GROUP BY p.code, p.name_en, f.name_th LIMIT 20;"

pnpm programs:pedagogy <code>      # one at a time, three times
```

Report for each: whether it succeeded, its `disciplineFitScore` / `qaScore`, which QA framework the PDF names (the prompt detects `TQF | AUN_QA | EdPEx | ABET | CDIO | WFME | NONE_DESCRIBED | OTHER`), and whether the method names it extracted include short acronyms — that last one is the direct evidence the v1.0 bug is gone.

- [ ] **Step 2: Cost the bulk run and STOP**

Compute the estimate from the three runs' actual token cost (`ai_inferences.cost_estimate_usd` for those rows) × ~275.

**Do NOT run `--all`.** Bulk AI generation on this project is the operator's decision, not the implementer's. Report the per-programme cost, the estimated total, and hand over the exact command:

```bash
pnpm programs:pedagogy --all --resume
```

(`--resume` skips programmes already at `v1.1` and re-runs the 8 stale `v1` rows, because the runner's skip test is `methodVersion === PROGRAM_PEDAGOGY_VERSION`.)

The rest of this plan does not block on that run. Criterion 3 will show 13 programmes until it happens and roughly 285 after; the registry and pages handle both without change.

---

## Task 2: The criteria registry

**Files:** Create `packages/shared/src/aunqa/criteria.ts`, `packages/shared/test/aunqa-criteria.test.ts`; modify `packages/shared/src/index.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import {
  AUNQA_CRITERIA,
  AUNQA_UNEVIDENCED_CRITERIA,
  allEvidenceBindings,
  criterionById,
} from '../src/aunqa/criteria';

describe('AUNQA_CRITERIA', () => {
  it('carries the six criteria the platform can evidence', () => {
    expect(AUNQA_CRITERIA.map((c) => c.id)).toEqual(['1', '2', '3', '4', '5', '8']);
  });

  it('names the two it cannot, so a reader is not misled that six is all there are', () => {
    expect(AUNQA_UNEVIDENCED_CRITERIA.map((c) => c.id)).toEqual(['6', '7']);
    for (const c of AUNQA_UNEVIDENCED_CRITERIA) {
      expect(c.title.length).toBeGreaterThan(0);
      expect(c.whyAbsent.length).toBeGreaterThan(0);
    }
  });

  it('gives every criterion at least one sub-criterion', () => {
    for (const c of AUNQA_CRITERIA) expect(c.subCriteria.length).toBeGreaterThan(0);
  });

  it('gives every sub-criterion an id of the form <criterion>.<n>', () => {
    for (const c of AUNQA_CRITERIA) {
      for (const s of c.subCriteria) expect(s.id).toMatch(new RegExp(`^${c.id}\\.\\d+$`));
    }
  });

  it('binds every sub-criterion to at least one piece of evidence', () => {
    // A sub-criterion with no binding could never be evidenced, so it
    // would render as a permanent blank — worse than omitting it.
    for (const c of AUNQA_CRITERIA) {
      for (const s of c.subCriteria) expect(s.evidence.length).toBeGreaterThan(0);
    }
  });

  it('uses only binding kinds a resolver exists for', () => {
    const known = new Set([
      'evaluation-theme', 'dq-module-profile', 'dq-program-score', 'graduate-outcome',
      'class-gpa-distribution', 'staff-metric', 'curriculum', 'pedagogy-assessment',
      'peer-review',
    ]);
    for (const b of allEvidenceBindings()) expect(known.has(b.kind)).toBe(true);
  });

  it('references only evaluation themes that exist in the instrument', () => {
    // Measured from evaluation_questions on 2026-08-26.
    const themes = new Set([
      'content-design', 'english-skills', 'active-learning', 'assessment', 'feedback', 'ethics',
    ]);
    for (const b of allEvidenceBindings()) {
      if (b.kind === 'evaluation-theme') expect(themes.has(b.theme)).toBe(true);
    }
  });

  it('looks a criterion up by id', () => {
    expect(criterionById('3')?.title).toContain('Teaching');
    expect(criterionById('6')).toBeUndefined(); // unevidenced ones are a separate list
  });
});
```

- [ ] **Step 2: Run it, watch it fail**

`pnpm --filter @kku/shared exec vitest run test/aunqa-criteria.test.ts`

- [ ] **Step 3: Implement the registry**

Create `packages/shared/src/aunqa/criteria.ts`. Start it with this header, verbatim:

```ts
/**
 * AUN-QA v4 programme-level criteria, and what this platform can
 * evidence for each.
 *
 * ── PROVENANCE WARNING ────────────────────────────────────────────────
 * This criteria list was written from the assistant's own knowledge of
 * AUN-QA v4. NO AUN-QA guide exists in this repository, and nothing here
 * has been checked against the official document. Before this feeds any
 * real accreditation submission, verify the criteria, their numbering
 * and their sub-criteria against the published v4 guide.
 *
 * It is deliberately DATA, not code: correcting a title, renumbering, or
 * adding a sub-criterion is an edit to this table and nothing else. No
 * criterion name or number may be duplicated into component code, prompt
 * text, or a database column.
 * ──────────────────────────────────────────────────────────────────────
 *
 * Criteria 6 (Student Support Services) and 7 (Facilities &
 * Infrastructure) have no data in the platform and are listed separately
 * in AUNQA_UNEVIDENCED_CRITERIA — named rather than hidden, so a reader
 * cannot infer that six criteria are the whole framework.
 */
```

Then the types and the table. The sub-criteria below are the assistant's reading of v4; keep each `title` short and factual:

- **1 Expected Learning Outcomes** — 1.1 programme ELOs defined; 1.2 ELOs reflect stakeholder needs; 1.3 generic and subject-specific outcomes; 1.4 alignment with institutional vision.
  Bindings: `curriculum:skills`, `curriculum:credits`, `evaluation-theme:ethics`, `evaluation-theme:english-skills`, `dq-program-score` (digital competency as an institution-wide ELO).
- **2 Programme Structure and Content** — 2.1 constructive alignment of curriculum design; 2.2 structure, sequence and integration; 2.3 content current.
  Bindings: `curriculum:courses`, `evaluation-theme:content-design`, `peer-review:contentModernity`, `peer-review:contentGaps`.
- **3 Teaching and Learning Approach** — 3.1 educational philosophy stated; 3.2 activities aligned to ELOs; 3.3 activities foster lifelong learning.
  Bindings: `pedagogy-assessment:disciplineFit`, `pedagogy-assessment:qaSystem`, `pedagogy-assessment:gaps`, `evaluation-theme:active-learning`.
- **4 Student Assessment** — 4.1 assessment aligned to ELOs; 4.2 timely feedback to students; 4.3 methods valid, reliable and transparent.
  Bindings: `evaluation-theme:assessment`, `evaluation-theme:feedback`, `class-gpa-distribution`.
- **5 Academic Staff** — 5.1 staff planning and workload; 5.2 competences; 5.3 recruitment and promotion; 5.4 development; 5.5 performance management.
  Bindings: `staff-metric:studentFacultyRatio`, `staff-metric:rankMix`, `staff-metric:workload`, `staff-metric:research`.
- **8 Output and Outcomes** — 8.1 pass and dropout rates; 8.2 time to graduate; 8.3 employability; 8.4 research output; 8.5 stakeholder satisfaction.
  Bindings: `graduate-outcome:employmentRate`, `graduate-outcome:jobRelevance`, `graduate-outcome:furtherStudy`, `graduate-outcome:salary`, `dq-module-profile`, `staff-metric:research`.

Sub-criteria whose evidence the platform genuinely cannot supply (5.3 recruitment/promotion, 5.5 performance management) should NOT be invented a binding — instead omit them from the table with a one-line comment saying why. **The test requires every listed sub-criterion to have a binding; that constraint exists precisely to stop a permanent blank row being shipped.**

- [ ] **Step 4: Run the tests — expect 8 passing.** Export from the barrel; `pnpm --filter @kku/shared typecheck`.

- [ ] **Step 5: Commit** — `feat(shared): AUN-QA v4 criteria registry with evidence bindings`

---

## Task 3: The evidence resolvers

**Files:** Create `packages/db/src/aunqa-evidence.ts` + its test; modify `packages/db/src/index.ts`.

- [ ] **Step 1: Implement one resolver per binding kind**

```ts
export interface ResolvedEvidence {
  binding: EvidenceBinding;
  available: boolean;
  /** Shape depends on the kind — a number, a distribution, a profile. */
  value: unknown;
  /** Human-readable source, for the provenance drawer. */
  sourceLabel: string;
  freshness: Date | null;
}

export async function resolveEvidenceForProgram(
  programId: string,
  bindings: EvidenceBinding[],
): Promise<ResolvedEvidence[]>;
```

Reuse the existing helpers rather than writing new SQL wherever one exists — `packages/db/src/program-deep-dive.ts` already has programme-scope readers for skills, courses, outcomes, faculty and DQ; `packages/db/src/student-dq.ts` has `dqCompetencyByScope` and `dqRadar`; evaluation themes come from `evaluation_response_summaries` joined to `evaluation_questions.theme_tag` at programme scope (the same join `/education/satisfaction` uses — **note it goes through `program_courses`**, so a programme with unmapped courses will legitimately have no evaluation evidence; that is a real finding, not a bug, and must resolve to `available: false`).

**Every resolver must return `available: false` rather than a zero, an empty array presented as a value, or a thrown error.** "No evidence for 4.2" is the single most useful output this feature produces; a zero would read as "assessed and scored nothing".

- [ ] **Step 2: Test**

Pure where possible; against the live database for the SQL paths. Cover: a binding with data; a binding with none; a programme whose courses are unmapped (evaluation themes unavailable); and that no resolver ever returns `available: true` with a null value.

- [ ] **Step 3: Verify against live data**

Scratch script (scratchpad, not the repo): resolve every binding for three programmes — one well-evidenced, one thin, one with no evaluation data — and print the available/unavailable split per criterion. Report the numbers. Delete the script.

- [ ] **Step 4: Commit** — `feat(db): AUN-QA evidence resolvers`

---

## Task 4: Readiness computation and API

**Files:** Create `packages/db/src/aunqa-readiness.ts`, `apps/api/src/aunqa/aunqa.{service,controller,module}.ts`; modify `apps/api/src/app.module.ts`.

- [ ] **Step 1: Readiness**

```ts
export type ReadinessBand = 'well-evidenced' | 'partly-evidenced' | 'no-evidence';

export interface CriterionReadiness {
  criterionId: string;
  subCriteriaTotal: number;
  subCriteriaWithEvidence: number;
  band: ReadinessBand;
  evidence: ResolvedEvidence[];
}
```

Band boundaries are a judgement — pin them in a test and state them in one comment: `no-evidence` when 0 sub-criteria have evidence; `well-evidenced` at ≥ two-thirds; `partly-evidenced` between. **These describe OUR DATA, not the programme** — the comment must say so, because that distinction is the reason this feature reports completeness rather than an AUN-QA rating.

- [ ] **Step 2: Endpoints**

`@Controller('/aunqa')`, all `@Authorized('institution:read:dashboard')`, scope-clamped exactly as the education dashboards are (`assertCanSeeFacultyDashboards` + `clampFacultyNameFilter`, `null` → `['__none__']` sentinel):

- `GET /aunqa/program/:programId` → criteria + resolved evidence + readiness, plus the unevidenced-criteria list.
- `GET /aunqa/faculty-overview` → per-programme completeness across the caller's scope.

Use `assertProgramAccessible` on the programme route, as the deep-dive controller does.

- [ ] **Step 3: Verify** — typecheck; unauthenticated curl returns `UNAUTHORIZED` (404 = unregistered); then fetch both routes with a minted session and report the criterion bands for the three programmes from Task 3.

- [ ] **Step 4: Commit** — `feat(api): AUN-QA readiness endpoints`

---

## Task 5: The self-assessment narrative prompt

**Files:** Create `packages/shared/src/ai/prompts/aunqa-criterion-narrative.ts`, migration for `aunqa_criterion_narratives`, a runner, and a `POST /aunqa/program/:programId/criterion/:criterionId/narrative` route.

- [ ] **Step 1: The prompt**

Must conform to `docs/prompt-standard.md` — the repo's conformance ratchet test will enforce this automatically once the file lands, and its allowlist only shrinks. That means: English output, the confidence rubric verbatim, the banned-phrase list, a `// CHANNEL MANIFEST` naming every input channel, and an explicit instruction that **a channel with no data is described as "not available", never inferred**.

Content: a short self-assessment paragraph for ONE criterion, grounded strictly in the resolved evidence passed to it. It must not assert practice the data does not show — the failure mode here is prose that sounds like a submission and cites evidence nobody has.

- [ ] **Step 2: Storage**

One additive migration: `aunqa_criterion_narratives` keyed `(program_id, criterion_id, method_version)` — so a prompt-version bump shadows old drafts rather than overwriting them, the pattern `program_pedagogy_assessments` and `user_expertise_narratives` already use. Generate the migration with `prisma migrate diff` and **hand-curate it to contain only this table** — a raw diff in this repo emits unrelated drift (see the `feedback_prisma_migrate_diff_drift` memory).

- [ ] **Step 3: The runner and route**

On-demand, one criterion at a time. Wrap the call in `extractStructuredWithParseRetry` and run `lintBannedTells` on the output, as the narrative and expertise runners do. `@AiCall({ module: 'aunqa' })` for the inference log.

**No bulk generation, and no `--all` script.** 301 programmes × 6 criteria has no reader and a real cost.

- [ ] **Step 4: Verify**

Generate for ONE well-evidenced programme and ONE thin one. Read both outputs yourself and report: does the thin one honestly say what is missing, or does it pad? Padding is the failure this task must catch — quote the actual text in your report.

- [ ] **Step 5: Commit** — `feat(ai): AUN-QA criterion self-assessment draft`

---

## Task 6: The programme analysis page

**Files:** Create `apps/web/app/teaching-learning/[programId]/{page,client}.tsx`.

- [ ] Criterion by criterion in registry order. Each shows its evidence rendered as it is elsewhere in the platform (evaluation theme breakdown, the DQ module radar via `RadarChartSmall` with the shared `dqRadarDomain` helper, class-GPA distribution, staff ratios, graduate outcomes), its completeness ("4 of 6 sub-criteria have data"), and its band.
- Unavailable evidence renders as **"no evidence"**, never 0 or an empty chart.
- A criterion with no evidence at all for this programme is omitted, per the operator's instruction — and the single line naming criteria 6 and 7 (and any omitted criterion) appears once at the foot.
- The narrative draft is behind a generate action, rendered with `<ConfidenceBadge>`, sources, "show reasoning" and the disagreement capture, and labelled **a draft to edit, not a submission**.

Class traps: bare `rounded` emits nothing (use `rounded-md`); semantic families use the bare class (`text-warning`); `mapColor` families take `-default`; it is `border-subtle`; `import type` only from `@kku/shared` in a client component.

- [ ] Verify by rendering three programmes (well-evidenced / thin / no evaluation data) and report what each showed. Typecheck + eslint clean.
- [ ] Commit — `feat(web): AUN-QA programme analysis page`

---

## Task 7: Faculty overview and the nav entry

**Files:** Create `apps/web/app/teaching-learning/{page,client}.tsx`; modify `apps/web/src/lib/app-nav.tsx`.

- [ ] A table of the caller's programmes against the six evidenced criteria, showing each programme's completeness and band, sortable, so a dean can sequence which programmes to put forward. Reuse `DrillDownPivot` if it fits; otherwise a plain table — do not invent a third table component.
- [ ] Nav: add `Teaching & Learning` to the faculty-aware dashboards section in `app-nav.tsx`, beside Education and Staff, following their `NavItem` shape exactly.
- [ ] Verify: render as a university-wide user and as a `FACULTY_USER`, confirming the clamp. Report both.
- [ ] Commit — `feat(web): AUN-QA faculty readiness overview + nav entry`

---

## Task 8: Changelog and verification

- [ ] Changelog entry, house voice, from measured figures: the new section; that it reports evidence completeness rather than an AUN-QA rating, and why; that criteria 6 and 7 have no data; that the narrative is a draft to edit; and the criterion-3 coverage as it actually stands when you write it.
- [ ] `pnpm typecheck` (8/8) and `pnpm test`; report the total. `pnpm lint` is repo-wide with a known backlog — only failures in files this plan touched are yours, and CI lints changed files, so a pre-existing error in a file you touch becomes yours to fix.
- [ ] **Do not run `pnpm build:release`.** Report and stop.

---

## Done criteria

- [ ] The criteria list exists in exactly one place, carrying its provenance warning.
- [ ] Every sub-criterion shown has at least one binding; no permanent blank rows.
- [ ] Unavailable evidence renders as "no evidence", never as 0.
- [ ] Criteria 6 and 7 are named once as outside the platform's data.
- [ ] No AUN-QA 1–7 rating is produced anywhere.
- [ ] The narrative is on-demand only, marked as a draft, and honest about missing evidence on a thin programme — verified by reading its actual output.
- [ ] The faculty overview is scope-clamped like its sibling dashboards.
