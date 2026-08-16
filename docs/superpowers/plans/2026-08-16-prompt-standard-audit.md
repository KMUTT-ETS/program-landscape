# Prompt Standard + Audit + First Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish an enforceable prompt-engineering standard, audit all 29 prompts against it, and rewrite the first (worst-gap) prompt — `program-strategic-narrative` — to prove the workflow end to end.

**Architecture:** The standard is a document plus a greppable conformance test that ratchets (rewritten prompts join the enforced set; unrewritten ones are on an explicit allowlist that only shrinks). The audit is read-only and produces the rewrite worklist. The strategic-narrative rewrite widens its input snapshot with channels the DB now holds, flips output to English, and passes a 3-program human gate before any bulk regeneration.

**Tech Stack:** TypeScript strict, Zod, Vitest, existing `AiService` plumbing. No new dependencies.

---

## Scope — this is plan 1 of 2

Spec: `docs/superpowers/specs/2026-08-16-prompt-standard-audit-design.md`. This plan delivers the
standard, the conformance harness, the audit, and one full rewrite with its gate. **Plan 2 (the
remaining rewrites + regenerations) is written after the audit worklist exists** — writing detailed
rewrite tasks for prompts not yet audited would be speculation.

Decisions already settled (do not relitigate): analysis output English-only with an enumerated
Thai-data-field exemption list; humanize = remove AI tells only, terse register stays; rewrite only
where the audit finds material gaps; user go/no-go before every bulk regeneration.

## File structure

| File | Responsibility |
|---|---|
| `docs/prompt-standard.md` | The standard. Referenced from `docs/ai-governance.md`. |
| `packages/shared/test/prompt-standard-conformance.test.ts` | Greppable ratchet: enforced prompts must carry the standard's markers. |
| `docs/superpowers/notes/2026-08-16-prompt-audit.md` | The 29-prompt audit worklist. |
| `packages/shared/src/ai/prompts/program-strategic-narrative.ts` | Rewrite to v2. |
| `packages/db/src/program-strategic-narrative-run.ts` | Caller: fetch + wire the new channels. |
| `packages/shared/test/program-strategic-narrative.test.ts` | Builder tests for v2. |

---

## Task 1: The standard document

**Files:**
- Create: `docs/prompt-standard.md`
- Modify: `docs/ai-governance.md` (one reference line), `CLAUDE.md` (language-strategy reversal)

- [ ] **Step 1: Write `docs/prompt-standard.md`.** Transcribe spec §1 into a standalone document with
  these exact section headings (the conformance test and future readers key off them):

  1. `## Language` — analysis output in English; the Thai exemption list (initially:
     `recruitmentSummaryTh` in `program-digest`, `nameTh`-class extraction fields, the entire output
     of `evaluation-question-translate`; marked "finalised by the audit" with
     `expertise-narrative`'s Thai keyword array as a named candidate).
  2. `## Grounding` — the four rules from the spec (snapshot-only numbers; data-not-available never
     guessed; causal claims as hypotheses; world knowledge only where the prompt's job is external
     context, marked as context).
  3. `## Confidence rubric` — the exact band text, verbatim, because prompts embed it:

     ```
     CONFIDENCE RUBRIC (report one number):
       0.90-1.00  every key input channel present and mutually consistent
       0.70-0.89  one material channel missing, or a noted inconsistency
       0.50-0.69  verdict rests on a single channel, or inputs conflict materially
       below 0.50 best effort over sparse input — flag for human review
     Grade against the bands. Do not default to 0.95.
     ```
  4. `## Banned AI tells` — the exact list (greppable, lowercase): `delve`, `leverage` (verb),
     `robust`, metaphorical `landscape`, `tapestry`, `furthermore`, `moreover`,
     `it is important to note`, `in today's rapidly evolving`, plus the two structural rules
     (no identical sentence openers across bullets; no forced three-item symmetry).
  5. `## Versioning` — major-only bumps on behaviour change; stragglers regularised at next bump.
  6. `## Data-channel manifest` — every builder carries a comment block headed
     `// CHANNEL MANIFEST` listing consumed channels and omitted-with-reason channels.
  7. `## Per-category addenda` — extraction / classification / verdict (70% completeness threshold
     for the mandatory data-gaps note; "what would change this verdict" line) / narrative, from the
     spec.

- [ ] **Step 2: Reference it from `docs/ai-governance.md`** — one line in its prompt-versioning
  section: `Prompt content rules live in docs/prompt-standard.md; conformance is enforced by
  packages/shared/test/prompt-standard-conformance.test.ts.`

- [ ] **Step 3: Update CLAUDE.md's language strategy.** In `## Language strategy`, change the
  analysis-content line to: English-only for AI analysis output (narratives, briefs, insights,
  verdicts) per `docs/prompt-standard.md` — reversed from Thai-primary on 2026-08-16; Thai survives
  only in the standard's exemption list (product-data fields). Leave UI/data-label lines untouched.

- [ ] **Step 4: Commit**

```bash
git add docs/prompt-standard.md docs/ai-governance.md CLAUDE.md
git commit -m "docs: prompt-engineering standard; record the English-output reversal"
```

---

## Task 2: The conformance ratchet

**Files:**
- Create: `packages/shared/test/prompt-standard-conformance.test.ts`

- [ ] **Step 1: Write the test.** It reads every `packages/shared/src/ai/prompts/*.ts` (excluding
  `index.ts`) and asserts, for files NOT on the allowlist, that the source contains the standard's
  markers. Start with **every existing prompt on the allowlist** — the ratchet begins closed and
  only tightens as rewrites land.

```ts
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const PROMPTS_DIR = path.join(__dirname, '..', 'src', 'ai', 'prompts');

// Prompts not yet rewritten to docs/prompt-standard.md. REMOVE entries as
// rewrites land — never add to this list. A new prompt file must conform
// from birth (it will fail here until it does).
const NOT_YET_CONFORMANT = new Set<string>([
  // populated in Step 2 with every current file
]);

const REQUIRED_MARKERS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'channel manifest', pattern: /CHANNEL MANIFEST/ },
  { name: 'confidence rubric', pattern: /CONFIDENCE RUBRIC/ },
  { name: 'English output rule', pattern: /English/ },
];

// The tell-ban applies to the SYSTEM PROMPT text we ship, meaning the file
// must contain the ban list (so the model is told), detected via its header:
const TELL_BAN_MARKER = /BANNED PHRASES|banned AI tells/i;

describe('prompt-standard conformance (ratchet)', () => {
  const files = readdirSync(PROMPTS_DIR).filter(
    (f) => f.endsWith('.ts') && f !== 'index.ts',
  );

  for (const file of files) {
    const conformant = !NOT_YET_CONFORMANT.has(file);
    it(`${file} ${conformant ? 'meets the standard' : 'is allowlisted (pending rewrite)'}`, () => {
      const src = readFileSync(path.join(PROMPTS_DIR, file), 'utf8');
      if (!conformant) {
        // Allowlist honesty: a file carrying ALL markers no longer belongs on
        // the allowlist — remove it (the ratchet only tightens). This stops
        // the list rotting into "conformant but still exempted".
        const carriesAll = REQUIRED_MARKERS.every((m) => m.pattern.test(src));
        expect(
          carriesAll,
          `${file} appears conformant — remove it from NOT_YET_CONFORMANT`,
        ).toBe(false);
        return;
      }
      for (const m of REQUIRED_MARKERS) {
        expect(src, `${file} missing ${m.name}`).toMatch(m.pattern);
      }
      expect(src, `${file} missing tell-ban block`).toMatch(TELL_BAN_MARKER);
    });
  }

  it('allowlist contains no files that no longer exist', () => {
    const files2 = new Set(readdirSync(PROMPTS_DIR));
    for (const f of NOT_YET_CONFORMANT) expect(files2.has(f), `stale allowlist entry ${f}`).toBe(true);
  });
});
```

- [ ] **Step 2: Populate `NOT_YET_CONFORMANT`** with all 28 non-index files (run
  `ls packages/shared/src/ai/prompts/*.ts | xargs -n1 basename | grep -v index.ts`).

- [ ] **Step 3: Run** `pnpm --filter @kku/shared test -- prompt-standard-conformance` — expect PASS
  (all allowlisted + the staleness check).

- [ ] **Step 4: Commit**

```bash
git add packages/shared/test/prompt-standard-conformance.test.ts
git commit -m "test(shared): prompt-standard conformance ratchet — starts fully allowlisted"
```

---

## Task 3: The audit

**Files:**
- Create: `docs/superpowers/notes/2026-08-16-prompt-audit.md`
- Modify: `docs/evaluation-pipeline.md` (§6 count + table drift)

Read-only against the code; zero API spend. For each of the 29 prompts, read the file AND its call
site(s) (grep `build<Name>Messages` across `apps/` + `packages/`), and record:

- [ ] **Step 1: Produce the audit table** with columns: `prompt | category | version | language
  posture (Thai fields → exempt/flip) | grounding gaps vs standard | missing data channels (compare
  the builder's input interface against the deep-dive helpers and fact tables the DB now holds —
  `programOutcomes`, `programTrends`, `programStudentCohorts`, `programSkills`, KMITL demand,
  risk_assessments, evaluations, publications) | AI-tell exposure (narrative class only) | verdict:
  REWRITE / TOUCH / LEAVE + one line | regeneration blast radius (rows, downstream consumers,
  ~cost)`.

- [ ] **Step 2: Open the doc with a findings summary** — carry forward the five discovery findings
  from the spec and anything new the audit surfaces.

- [ ] **Step 3: Fix `docs/evaluation-pipeline.md` §6** — heading says 22; list the real 29 in the
  four-way taxonomy (extraction / classification / verdict / narrative), preserving the existing
  table format.

- [ ] **Step 4: Sanity-check the verdict distribution.** Expect roughly: REWRITE ≈ the 8 narrative +
  5 verdict prompts minus any already-clean; TOUCH ≈ extraction prompts needing only rubric/manifest
  blocks; LEAVE ≈ genuinely fine. If the audit concludes LEAVE for a majority of narrative/verdict
  prompts, re-read them — that contradicts the discovery evidence.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/notes/2026-08-16-prompt-audit.md docs/evaluation-pipeline.md
git commit -m "docs: audit all 29 prompts against the standard; fix pipeline-doc drift"
```

---

## Task 4: Rewrite `program-strategic-narrative` v1 → v2

**Files:**
- Modify: `packages/shared/src/ai/prompts/program-strategic-narrative.ts`
- Modify: `packages/db/src/program-strategic-narrative-run.ts`
- Create: `packages/shared/test/program-strategic-narrative.test.ts`
- Modify: `packages/shared/test/prompt-standard-conformance.test.ts` (remove from allowlist)

The caller already fetches 8 signals in one `Promise.all`
(`program-strategic-narrative-run.ts:71-89`). The missing channels are sibling helpers in
`packages/db/src/program-deep-dive.ts` — this is widening, not plumbing.

- [ ] **Step 1: Write the failing builder tests first.**

```ts
// packages/shared/test/program-strategic-narrative.test.ts
import { describe, expect, it } from 'vitest';
import {
  buildProgramStrategicNarrativeMessages,
  PROGRAM_STRATEGIC_NARRATIVE_VERSION,
} from '../src/ai/prompts/program-strategic-narrative';
import { FIXTURE_INPUT } from './fixtures/strategic-narrative-input';

describe('program-strategic-narrative v2 builder', () => {
  const messages = buildProgramStrategicNarrativeMessages(FIXTURE_INPUT);
  const system = messages.find((m) => m.role === 'system')?.content ?? '';
  const user = messages.find((m) => m.role === 'user')?.content ?? '';

  it('is version 2', () => {
    expect(PROGRAM_STRATEGIC_NARRATIVE_VERSION).toBe('program-strategic-narrative.v2');
  });

  it('demands English output explicitly', () => {
    expect(system).toMatch(/English/);
  });

  it('carries the confidence rubric and the tell ban', () => {
    expect(system).toContain('CONFIDENCE RUBRIC');
    expect(system).toMatch(/BANNED PHRASES/i);
  });

  it('feeds the new channels into the user snapshot', () => {
    expect(user).toContain('GRADUATE OUTCOMES');
    expect(user).toContain('LABOUR-MARKET DEMAND');
    expect(user).toContain('TREND SIGNALS');
    expect(user).toContain('RISK');
    expect(user).toContain('COHORT');
  });

  it('renders a missing channel as explicitly unavailable, not silently absent', () => {
    const noOutcomes = { ...FIXTURE_INPUT, outcomes: null };
    const u = buildProgramStrategicNarrativeMessages(noOutcomes)
      .find((m) => m.role === 'user')!.content;
    expect(u).toContain('GRADUATE OUTCOMES: data not available');
  });

  it('keeps the hard structural rules from v1', () => {
    for (const marker of [
      'No greetings, no closings',
      '## Executive summary',
      '## Recommended actions',
      '250-400 words',
    ]) {
      expect(system).toContain(marker);
    }
  });
});
```

  Create `packages/shared/test/fixtures/strategic-narrative-input.ts` with a realistic
  `FIXTURE_INPUT` covering every channel (hand-written, no PII — use plausible synthetic values;
  this is a builder-shape fixture, not captured data).

- [ ] **Step 2: Run — expect FAIL** (`v1` !== `v2`, missing channels).

- [ ] **Step 3: Extend the input interface.** Add to `ProgramStrategicNarrativeInput`:

```ts
/** Latest graduate-outcome survey row (null = no survey data passes realDataWhere). */
outcomes: {
  surveyYear: number;
  employmentRatePct: number | null;
  averageSalaryThb: number | null;
  furtherStudyRatePct: number | null;
  sampleSize: number;
} | null;
/** KMITL/LinkedIn demand alignment (null = no demand-match rows). */
demandMatch: {
  matchedDemanded: number;
  relevantDemanded: number;
  topUnmatchedSkills: string[]; // ≤5
} | null;
/** Trend signals targeted at or affecting this program (≤5, newest first). */
trendSignals: Array<{
  title: string;
  signalType: string;
  impactScorePct: number;
  recommendation: string;
}>;
/** Risk overlay summary (null = risk assessment not yet run). */
risk: {
  compositeScore: number;
  topLikelihoodDriver: string;
  topImpactDimension: string;
} | null;
/** Cohort progression (null = no cohort links). */
cohorts: {
  totalActive: number;
  delayedSharePct: number | null;
} | null;
```

- [ ] **Step 4: Rewrite the builder + system prompt.**
  - Keep v1's hard rules verbatim (greetings/closings ban, five-section structure, 250–400 words,
    snapshot-only numbers).
  - Add: `Write in English.` as a hard constraint (the narrative previously followed the user's
    data language).
  - Add the `CONFIDENCE RUBRIC` block and a `BANNED PHRASES` block with the standard's list.
  - Add the grounding additions: null channels rendered as `<CHANNEL>: data not available` with an
    instruction that unavailable data must not be guessed and SHOULD be named in Critical risks when
    material (a Council brief that lacks employment data must say so);
    causal claims as hypotheses (`consistent with`, never bare `because`).
  - Add a `## Data gaps` requirement: when 2+ channels are null, the model appends one line after
    Recommended actions naming them. (Schema max length: raise `contentMarkdown` max to 4500 to
    accommodate; min stays.)
  - New user-snapshot blocks, each with the ALL-CAPS header the tests assert: `GRADUATE OUTCOMES`,
    `LABOUR-MARKET DEMAND`, `TREND SIGNALS`, `RISK`, `COHORT` — formatted like the existing blocks
    (`fmt`/`fmtInt` helpers).
  - Add the `// CHANNEL MANIFEST` comment block on the builder listing all consumed channels and the
    deliberate omissions with reasons (e.g. courses list — too long, digested elsewhere; faculty
    roster — PII posture, aggregates already in capability score).
  - Bump `PROGRAM_STRATEGIC_NARRATIVE_VERSION` to `'program-strategic-narrative.v2'`.

- [ ] **Step 5: Wire the caller.** In `program-strategic-narrative-run.ts`, extend the `Promise.all`
  with `programOutcomes(program.id)`, `programTrends(program.id)`,
  `programStudentCohorts(program.id)`, and the risk + demand-match reads. **Read each helper's
  return shape in `program-deep-dive.ts` before mapping — do not guess field names.** Risk:
  `prisma.riskAssessment.findUnique({ where: { programId } })` (verify the model name in
  `schema.prisma`). Demand match: check how the relevance driver reads `program_demand_matches` in
  `health-score.ts` and reuse that shape. Map to the new input fields; null when a channel has no
  rows — never zero-fill.

- [ ] **Step 6: Run the tests — expect PASS.** Then remove
  `program-strategic-narrative.ts` from `NOT_YET_CONFORMANT` and run the conformance test — expect
  PASS (the ratchet's first click).

- [ ] **Step 7: Full gates.** `pnpm --filter @kku/shared test`, `pnpm --filter @kku/db test`,
  `pnpm typecheck` (all 8 must pass — the db caller changed).

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/ai/prompts/program-strategic-narrative.ts \
        packages/db/src/program-strategic-narrative-run.ts \
        packages/shared/test/program-strategic-narrative.test.ts \
        packages/shared/test/fixtures/strategic-narrative-input.ts \
        packages/shared/test/prompt-standard-conformance.test.ts
git commit -m "feat(ai): strategic-narrative v2 — English, grounded, full data channels"
```

---

## Task 5: The 3-program before/after gate

No bulk regeneration in this plan. This task produces the comparison artifact and STOPS for the
user.

- [ ] **Step 1: Pick three real programs** — data-rich / middling / sparse (the PDF gate used
  `KKU-SEQ-0059` / `KKU-SEQ-0089` / `KKU-SEQ-0301`; reuse unless the audit suggests better).

- [ ] **Step 2: Write a throwaway script at the repo root** (deleted after) that, per program:
  fetches the STORED v1 narrative (`programStrategicNarrative(programId)`), then generates a v2
  narrative live via the rewritten builder + `AiService` (3 API calls total, ~cents), and writes
  `/tmp/narrative-compare-<code>.md` containing both, clearly labelled, with the confidence each
  reported.

- [ ] **Step 3: Self-check the v2 outputs before handing over:** English throughout; no banned
  tells (grep the outputs against the list); every number traceable to the input snapshot; the
  sparse program's output names its data gaps rather than papering over them.

- [ ] **Step 4: Report to the user** with the three file paths and the observed differences, and
  **stop**. Bulk regeneration (~300 programs), the lifecycle-drift report, and the remaining
  rewrites are plan 2, which also inherits the audit's worklist.

- [ ] **Step 5: Delete the throwaway script.** Commit nothing from this task except (if needed) a
  note in the audit doc recording the gate outcome.

---

## Done criteria

- [ ] `docs/prompt-standard.md` exists; ai-governance references it; CLAUDE.md records the reversal.
- [ ] Conformance ratchet green with 27 allowlisted + 1 conformant (strategic-narrative).
- [ ] Audit doc covers all 29 with verdicts and blast radii; pipeline doc says 29.
- [ ] Strategic-narrative v2: English, rubric, tell-ban, 5 new channels wired, builder tests green.
- [ ] All 8 projects typecheck; full test suite green.
- [ ] Three before/after comparisons delivered to the user; **no bulk regeneration run**.

## Next (plan 2, after the audit + gate)

Remaining rewrites in worklist order (peer-review → risk-assessment → ai-readiness → insights
panels → extraction touches), each with its own regeneration go/no-go; the lifecycle-drift report;
narrative bulk regeneration ordered early so the mixed-language window on the deep-dive stays short.
