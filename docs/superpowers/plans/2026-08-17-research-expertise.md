# Program Research Expertise Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deep-dive section that presents each program's demonstrated research expertise from its roster's last-10-years publications, with grounded recommendations in three lanes (curriculum, positioning, research strategy).

**Architecture:** Pure data-assembly helper (dedup + score + stats) → a from-birth-conformant prompt → a runner with the deterministic confidence ceiling and banned-tell lint → own table → pipeline phase + ops script → fan-out endpoint + UI section → gated 3-program smoke before any bulk run. PDF section trails as the final task.

**Tech Stack:** TypeScript strict, Zod, Prisma (additive migration), Vitest, existing `AiService`/lint/clamp plumbing.

Spec: `docs/superpowers/specs/2026-08-17-research-expertise-design.md` — decisions there are settled.

---

## Constants this plan pins (the spec deferred them here)

**Paper score** (ordering is the contract; exact weights tunable later):

```ts
// recency: papers in the last 10y ramp 0.5 → 1.0 linearly; older would be
// excluded by the window anyway.
const recency = 0.5 + 0.5 * Math.max(0, (year - (currentYear - 10)) / 10);
const quartileBoost = quartile === 1 ? 1.3 : quartile === 2 ? 1.15 : 1; // null → 1 (never a penalty)
const score = recency * Math.log2(citations + 2) * quartileBoost;
// ties break toward the newer paper
```

**Confidence ceiling** (`researchExpertiseConfidenceCeiling(readiness, totalDistinct)`):

| condition | ceiling |
|---|---|
| `readiness === 'no-roster'` | **no generation at all** — runner skips, nothing stored |
| `readiness === 'thin'` (<10 distinct papers) | 0.49 |
| ok, 10–49 papers | 0.69 |
| ok, 50–149 papers | 0.89 |
| ok, ≥150 papers | 1.00 |

**Roster caveat constant** (exported; schema requires it verbatim in `caveats`):

```ts
export const ROSTER_PROVENANCE_CAVEAT =
  'Analysis covers publications of the curated program roster (AI-extracted, analyst-reviewed); roster gaps or errors propagate to these findings.';
```

---

## Task 1: Data assembly helper

**Files:**
- Create: `packages/db/src/program-research-expertise.ts`
- Test: `packages/db/test/program-research-expertise.test.ts`
- Modify: `packages/db/src/index.ts` (export)

- [ ] **Step 1: Write the failing tests.** The dedup/score/stats core must be a **pure function**
  over rows so it tests without a DB:

```ts
import { describe, expect, it } from 'vitest';
import {
  dedupAndScorePapers,
  buildExpertiseStats,
  readinessFor,
} from '../src/program-research-expertise';

const paper = (over: Partial<PaperRow>): PaperRow => ({
  title: 'Recycled aggregate concrete', venue: 'Constr Build Mater', year: 2024,
  citations: 10, quartile: null, doi: null, openalexId: null, scopusId: null,
  pmid: null, ...over,
});

describe('dedupAndScorePapers', () => {
  it('collapses the same paper carried by multiple roster authors', () => {
    const rows = [
      paper({ doi: '10.1/x', citations: 50 }),
      paper({ doi: '10.1/x', citations: 50 }),
      paper({ doi: '10.1/y', title: 'Other', citations: 5 }),
    ];
    const out = dedupAndScorePapers(rows, 2026);
    expect(out).toHaveLength(2);
    expect(out[0]!.contributingRosterCount).toBe(2); // the duplicated one, and it ranks first
  });

  it('falls back to normalised title when all external ids are null', () => {
    const rows = [paper({ title: 'Same Title ' }), paper({ title: 'same title' })];
    expect(dedupAndScorePapers(rows, 2026)).toHaveLength(1);
  });

  it('ranks a recent Q1 paper above an old uncited one, and null quartile is never a penalty vs Q3+', () => {
    const out = dedupAndScorePapers(
      [paper({ doi: 'a', year: 2017, citations: 0 }), paper({ doi: 'b', year: 2025, citations: 30, quartile: 1 })],
      2026,
    );
    expect(out[0]!.doi).toBe('b');
  });
});

describe('readinessFor', () => {
  it('is no-roster at 0 members, thin below 10 papers, ok otherwise', () => {
    expect(readinessFor(0, 999)).toBe('no-roster');
    expect(readinessFor(5, 9)).toBe('thin');
    expect(readinessFor(5, 10)).toBe('ok');
  });
});

describe('buildExpertiseStats', () => {
  it('reports papersPerYear, topVenues with counts, quartile mix, and notShownCount', () => {
    const papers = [/* ~5 hand-built papers across 3 years, 2 venues, one Q1 */];
    const stats = buildExpertiseStats(papers, 3 /* topN kept */, 11 /* rosterSize */);
    expect(stats.notShownCount).toBe(papers.length - 3);
    expect(stats.topVenues[0]).toEqual({ venue: expect.any(String), count: expect.any(Number) });
  });
});
```

  Fill the stats fixture concretely when writing (5 papers is enough); assert exact counts, not
  just shapes, for papersPerYear and quartile mix.

- [ ] **Step 2: Run — expect FAIL** (module not found).
  `pnpm --filter @kku/db test -- program-research-expertise`

- [ ] **Step 3: Implement.** Exports:

```ts
export type ExpertiseReadiness = 'ok' | 'thin' | 'no-roster';
export interface PaperRow { title: string; venue: string | null; year: number; citations: number;
  quartile: number | null; doi: string | null; openalexId: string | null; scopusId: string | null;
  pmid: string | null }
export interface ScoredPaper extends PaperRow { score: number; contributingRosterCount: number }
export interface ExpertiseStats { papersPerYear: Array<{ year: number; count: number }>;
  topVenues: Array<{ venue: string; count: number }>; quartileMix: { q1: number; q2: number;
  q3plus: number; unassessed: number }; totalDistinct: number; rosterSize: number;
  notShownCount: number }
export interface ResearchExpertiseInput { readiness: ExpertiseReadiness;
  topPapers: ScoredPaper[]; stats: ExpertiseStats; programNameEn: string; programLevel: string;
  facultyNameEn: string }

export function dedupAndScorePapers(rows: PaperRow[], currentYear: number): ScoredPaper[];
export function readinessFor(rosterSize: number, distinctPapers: number): ExpertiseReadiness;
export function buildExpertiseStats(papers: ScoredPaper[], keptN: number, rosterSize: number): ExpertiseStats;
export async function assembleResearchExpertiseInput(programId: string): Promise<ResearchExpertiseInput | null>;
```

  `assembleResearchExpertiseInput`: roster via `programFaculties` include `facultyMember`; papers via
  `researchOutput.findMany({ where: { facultyMemberId: { in: rosterIds }, year: { gte: currentYear - 10 }, ...realDataWhere() } })`;
  dedup key `doi ?? openalexId ?? scopusId ?? pmid ?? title.toLowerCase().trim()`; top **150**;
  the 10-year window from `new Date().getFullYear()`, not a literal. Returns null only when the
  program does not exist.

- [ ] **Step 4: Run — expect PASS.** Also `pnpm --filter @kku/db test` (96 before) and typecheck.

- [ ] **Step 5: Commit** — `feat(db): assemble deduped, scored research-expertise input per program`

---

## Task 2: The prompt — conformant from birth

**Files:**
- Create: `packages/shared/src/ai/prompts/program-research-expertise.ts`
- Modify: `packages/shared/src/ai/prompts/index.ts` (follow the barrel's existing pattern)
- Test: `packages/shared/test/program-research-expertise.test.ts`

The conformance ratchet accepts no new allowlist entries — this file must carry `CHANNEL MANIFEST`,
`CONFIDENCE RUBRIC` (verbatim from `docs/prompt-standard.md`), the `BANNED PHRASES` block, and the
English rule from its first commit, or CI fails.

- [ ] **Step 1: Failing tests.** Mirror the narrative-v2 test shape:
  version is `program-research-expertise.v1`; system prompt contains `Write in English`,
  `CONFIDENCE RUBRIC`, `BANNED PHRASES`, the verbatim-example-titles rule, the titles-only
  limitation statement, and the quartile-absence rule; user snapshot contains `TOP PAPERS`,
  `PUBLICATION STATS`, and — for a `thin` input — an explicit thinness warning; schema rejects a
  theme with 0 or 1 example titles and accepts 2–3; schema requires `caveats` to include
  `ROSTER_PROVENANCE_CAVEAT` (use `.refine`); fixture at
  `packages/shared/test/fixtures/research-expertise-input.ts` (synthetic, ~12 papers, no PII).

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement.** Zod schema per the spec's shape:

```ts
themes: z.array(z.object({
  name: z.string().min(3),
  paperCount: z.number().int().positive(),
  exampleTitles: z.array(z.string()).min(2).max(3),
  yearSpan: z.string(),                          // e.g. "2018–2026"
  trend: z.enum(['rising', 'steady', 'fading']),
  evidenceNote: z.string(),
})).min(1).max(6),
recommendations: z.object({
  curriculum: z.array(RecSchema).min(1).max(4),
  positioning: z.array(RecSchema).min(1).max(3),
  research: z.array(RecSchema).min(1).max(3),
}),
caveats: z.array(z.string()).min(1),
confidence: z.number().min(0).max(1),
// RecSchema: { action, rationale, horizonMonths: z.number().int().min(1).max(60), themeRefs: z.array(z.string()).min(1) }
```

  System-prompt grounding rules (beyond the standard blocks): themes only where the shown titles
  evidence them; example titles **verbatim from the input**; trends must follow the
  papers-per-year table; no findings/methods/quality claims beyond citations+quartile; quartile
  absence = "not assessed"; recommendations actionable by a university, horizon in months, citing
  `themeRefs`. Export `researchExpertiseConfidenceCeiling` (bands from this plan's header) and
  `ROSTER_PROVENANCE_CAVEAT` from this file, tested.

- [ ] **Step 4: Run — expect PASS**, including the conformance ratchet
  (`pnpm --filter @kku/shared test -- prompt-standard-conformance` — the new file must pass
  WITHOUT touching the allowlist).

- [ ] **Step 5: Commit** — `feat(ai): program-research-expertise.v1 prompt, conformant from birth`

---

## Task 3: Storage migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<ts>_program_research_expertise/migration.sql`

- [ ] **Step 1: Add the model** (follow `program_ai_readiness_assessments` naming/relations):

```prisma
model ProgramResearchExpertise {
  id             String   @id @default(cuid())
  programId      String   @map("program_id")
  payloadJson    Json     @map("payload_json")
  inputStatsJson Json     @map("input_stats_json")
  methodVersion  String   @map("method_version")
  aiInferenceId  String?  @map("ai_inference_id")
  generatedAt    DateTime @default(now()) @map("generated_at")
  program Program @relation(fields: [programId], references: [id], onDelete: Cascade)
  @@index([programId, generatedAt])
  @@map("program_research_expertise")
}
```

  (+ back-relation on `Program`.)

- [ ] **Step 2: Generate SQL non-interactively** (repo convention — no TTY):
  `pnpm --filter @kku/db exec prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script`
  — check the repo's actual prior migration workflow in CLAUDE.md prompt-01 notes and mirror it;
  strip the Prisma banner; apply with `prisma migrate deploy`; `prisma generate`.

- [ ] **Step 3: Verify** `pnpm --filter @kku/db test` + full typecheck.

- [ ] **Step 4: Commit** — `feat(db): ProgramResearchExpertise table (additive)`

---

## Task 4: The runner

**Files:**
- Create: `packages/db/src/program-research-expertise-run.ts`
- Modify: `packages/db/src/index.ts`
- Test: extend `packages/db/test/program-research-expertise.test.ts` (pure parts only)

- [ ] **Step 1: Read `program-strategic-narrative-run.ts` end to end** — this runner mirrors it:
  assemble input → `readiness === 'no-roster'` → return `{ skipped: 'no-roster' }` without any AI
  call → build messages → `ai.complete` → parse → `lintBannedTells` on the joined free-text fields
  (theme names, evidence notes, actions, rationales) → one corrective retry on violations →
  clamp `confidence = min(model, researchExpertiseConfidenceCeiling(readiness, stats.totalDistinct))`
  with a warn log when engaged → persist (insert new row; do not update old) with
  `methodVersion = PROGRAM_RESEARCH_EXPERTISE_VERSION`, `inputStatsJson = stats`,
  `aiInferenceId` from the recorder.
- [ ] **Step 2: Tests** for the lintable-text join helper and the skip path (pure); the AI path is
  covered by the gate, not mocked theater.
- [ ] **Step 3: Gates** — db tests, shared tests, full typecheck.
- [ ] **Step 4: Commit** — `feat(db): research-expertise runner with ceiling clamp and tell lint`

---

## Task 5: Ops script + pipeline phase

**Files:**
- Create: `apps/ingestion/src/scripts/generate-research-expertise.ts`
- Modify: root `package.json` (`"expertise:generate"`), `apps/ingestion/src/scripts/programs-pipeline.ts`

- [ ] **Step 1: Script** — copy the flag/selection/summary shape of
  `apps/ingestion/src/scripts/regenerate-narratives.ts` (it was built to be the template):
  `--only <code> | --limit N | --all`, refuses bare, sequential, per-row try/catch, summary with
  readiness counts (ok/thin/no-roster-skipped), confidence distribution, clamp engagements, lint
  retries, cost, wall time.
- [ ] **Step 2: Pipeline phase** — read how phase 7 (narrative) is registered in
  `programs-pipeline.ts` and add research expertise as a phase **after faculty extraction, before
  the narrative**, same skip-if-exists semantics the pipeline uses for other phases (generate when
  missing, not regenerate). **Also add the new script to the esbuild bundle list** in
  `apps/ingestion/scripts/bundle-pipeline-scripts.ts` if the pipeline spawns it as a child — read
  how phase 7 executes (in-process vs spawned) and match; the bundle list bites at prod deploy
  time if missed (v1.1.3 lesson).
- [ ] **Step 3: Smoke** — `pnpm expertise:generate --only KKU-SEQ-0065` (ONE live call, ~$0.03):
  verify a row lands with themes/recommendations/caveats, confidence ≤ ceiling, English.
- [ ] **Step 4: Commit** — `feat(ingestion): research-expertise generation script + pipeline phase`

---

## Task 6: API endpoint + deep-dive section

**Files:**
- Modify: `apps/api/src/programs/deep-dive.controller.ts` (new GET, `@Provenance` with the
  **version constant**), `packages/db/src/program-deep-dive.ts` (read helper
  `programResearchExpertise(programId)` returning latest row + readiness),
  `apps/web/app/programs/[id]/page.tsx` (fan-out fetch), `apps/web/app/programs/[id]/types.ts`,
  `apps/web/app/programs/[id]/client.tsx` (new section).

- [ ] **Step 1: Read helper + endpoint.** Latest row by `generatedAt`; when none, return the
  readiness verdict from `assembleResearchExpertiseInput`'s cheap parts (roster count + paper
  count only — do NOT run the full assembly on every page view; add a
  `researchExpertiseReadiness(programId)` light query) so the UI can explain WHY it is empty.
- [ ] **Step 2: UI section** — follow an existing section's structure in `client.tsx` (e.g. the
  skills section): themes as cards (name, count, year span, trend badge, example titles), three
  recommendation lanes, caveats in muted text, `<ConfidenceBadge>` + `<FreshnessBadge>`, empty
  states: `no-roster` → "No curated faculty roster yet — run programs:extract-faculty";
  `thin` → "Only N papers found for this roster in the last 10 years — below the analysis
  threshold (10)"; `not-generated` → "Not yet analysed — run pnpm expertise:generate".
- [ ] **Step 3: Gates** — full typecheck, api tests, web tests; view
  `http://localhost:3000/programs/cmon1wyw1003lzh90a5cdurkf` renders the section (dev servers are
  already running; the web app hot-reloads).
- [ ] **Step 4: Commit** — `feat(web,api): research-expertise deep-dive section`

---

## Task 7: The 3-program gate — STOP for the user

- [ ] **Step 1:** `pnpm expertise:generate --only <code>` for: rich (KKU-SEQ-0252, 2,899 papers —
  the stress case), median (KKU-SEQ-0065, 259), thin (pick one with 10–20 papers via a quick SQL).
- [ ] **Step 2: Self-check:** every theme's example titles appear verbatim in the assembled input
  (script the check, don't eyeball); trends consistent with papersPerYear; no banned tells; English;
  confidences ≤ ceilings; the thin program's output reads honest, not padded.
- [ ] **Step 3: Report to the user** with the three payloads (file dumps or the live deep-dive
  pages), the self-check results, and the bulk-run cost estimate (~250 programs ≈ $5–10). **STOP —
  bulk is the user's go/no-go.**

## Task 8 (post-gate, only on the user's go): bulk + PDF section

- [ ] Bulk: `pnpm expertise:generate --all`; report readiness counts, confidence distribution,
  clamp/lint counts, failures, cost.
- [ ] PDF: `packages/pdf-templates/src/templates/program-detail/sections/research-expertise.tsx`
  (reference-table shape — no chart), wire into `sections/index.ts` manifest (`chartLed: false`),
  extend the PDF schema + `program-detail-data.ts` builder, tests per the v2 section pattern.
  Commit separately.

## Done criteria

- [ ] Assembly pure-functions tested (dedup 588→259-style, scoring order, readiness, stats).
- [ ] Prompt conformant from birth — ratchet green with NO allowlist change.
- [ ] `no-roster` programs make zero AI calls; `thin` ceils ≤0.49.
- [ ] Endpoint provenance uses the version constant.
- [ ] All 8 projects typecheck; all suites green.
- [ ] 3-program gate delivered; bulk only after explicit go.
