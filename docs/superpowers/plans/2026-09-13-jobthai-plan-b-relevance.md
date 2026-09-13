# JobThai Plan B — programme bridge and the relevance driver

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-09-13-jobthai-demand-extraction-design.md`
**Depends on:** Plan A (complete) and the skill-taxonomy de-duplication (complete)

**Goal:** Link KKU programmes to JobThai occupations by two independent paths, then add one relevance driver from that link.

**Methodology impact:** `health-score.v5.0` → **`health-score.v5.1`**. Composites above programme scope move. The operator approved feeding relevance immediately, nationally weighted, on 2026-09-12 after being shown the geography and postgraduate skew.

---

## What Plan A measured, so this plan need not guess

Plan A existed partly to replace the spec's guessed thresholds with observation. It did:

| Quantity | Spec guess | **Measured** |
|---|---|---|
| Occupations | 173 | **240** (distinct pairs, not subcategories) |
| Embedding cosine floor | 0.80 | **0.72** — 0.80 rejected 39 of 40 correct matches |
| Signal floor | 30 postings | **see below — 20** |
| Extraction LLM spend | $2–5 | **$0** (deterministic matching sufficed; 78.2% coverage) |

**Per-programme posting distribution**, via the field-of-study bridge over 831 distinct fields and 297 canonical active programmes:

| | |
|---|---|
| Programmes matching ≥1 field | 246 of 297 (82.8%) |
| Postings per matched programme | min 3 · p25 **20** · median **136** · p75 433 · max 3,534 |
| Floor 10 → | 223 programmes keep a signal (75.1%) |
| **Floor 20 →** | **185 (62.3%)** |
| Floor 30 → | 167 (56.2%) |
| Floor 50 → | 151 (50.8%) |

`JOBTHAI_MIN_POSTINGS_FOR_SIGNAL = 20`, the observed 25th percentile. The spec's 30 was reasoned from "only 304 Khon Kaen postings exist" but discards 18 more programmes for no measured reason. 20 sits at the natural break: below it a programme's signal rests on a handful of adverts.

## THE FINDING THAT SHAPES THIS PLAN

Coverage by level, from the same measurement:

| Level | Programmes matching ≥1 field |
|---|---|
| BACHELOR | 88 of 102 (86%) |
| MASTER | 87 of 110 (79%) |
| DOCTORAL | 56 of 68 (82%) |
| HIGHER_GRAD_DIPLOMA | 15 of 17 (88%) |

Postgraduate programmes match at nearly the bachelor's rate. **That does not contradict the 0.8% postgraduate figure — it exposes a trap.** The field-of-study bridge matches a Master's in Accounting to postings asking for "สาขาบัญชี" at *bachelor* level. The discipline matches; the postings are not for postgraduates.

A naive driver would therefore hand doctoral programmes a demand signal derived from undergraduate job adverts, and it would look entirely healthy — 82% coverage, plausible skills, no nulls. That is the worst failure mode available here: confident and wrong.

**So the postgraduate null rule must be enforced on the POSTINGS' education level, not on whether a field matched.** For a MASTER or DOCTORAL programme, only postings whose `minEducationLevel` is MASTER or DOCTORATE count — 41 nationally, so every postgraduate programme falls below the floor and the driver returns null. That is the honest outcome and it is what the operator approved: null, never 0, where the data cannot speak.

## File structure

| Path | Responsibility |
|---|---|
| `packages/db/prisma/migrations/<ts>_program_jobthai_link/migration.sql` | `ProgramJobThaiLink`, hand-written |
| `packages/db/src/jobthai-bridge.ts` | Pure: field normalisation, the two match paths, link scoring |
| `apps/ingestion/src/scripts/jobthai-link-programs.ts` | Runner, dry-run by default |
| `packages/db/src/health-score.ts` | The new driver + `DIMENSION_DRIVERS` entry + version bump |
| `docs/methodologies/health-score.md`, `apps/web/app/docs/methodology/content-{en,th}.tsx`, `apps/web/app/changelog/page.tsx` | Documentation |

---

### Task 1: `ProgramJobThaiLink` schema ✅ DONE

**Files:** `packages/db/prisma/schema.prisma`, new migration.

- [x] **Step 1: Add the model**

```prisma
/// Which JobThai occupations a programme's graduates plausibly fill.
/// Built by TWO independent paths so they can corroborate or disagree;
/// `linkSource = both` is the strong signal and a disagreement is shown to an
/// analyst rather than averaged away.
model ProgramJobThaiLink {
  id                  String   @id @default(cuid())
  programId           String   @map("program_id")
  jobThaiOccupationId String   @map("jobthai_occupation_id")
  /// 'field-of-study' | 'skill-overlap' | 'both'
  linkSource          String   @map("link_source")
  /// 0..1 link strength.
  score               Float
  /// Postings behind this link AFTER the education-level gate. Drives
  /// JOBTHAI_MIN_POSTINGS_FOR_SIGNAL, so it must be stored, not recomputed.
  postingCount        Int      @map("posting_count")
  evidenceTh          String?  @map("evidence_th") @db.Text
  methodVersion       String   @default("jobthai-bridge.v1") @map("method_version")
  /// Stamped on write. Omitting it is what left 6,224 program_demand_matches
  /// invisible to realDataWhere(); it has happened three times in this repo.
  ingestionRunId      String?  @map("ingestion_run_id")
  computedAt          DateTime @default(now()) @map("computed_at")

  program      Program           @relation(fields: [programId], references: [id], onDelete: Cascade)
  occupation   JobThaiOccupation @relation(fields: [jobThaiOccupationId], references: [id], onDelete: Cascade)
  ingestionRun IngestionRun?     @relation(fields: [ingestionRunId], references: [id], onDelete: SetNull)

  @@unique([programId, jobThaiOccupationId])
  @@index([programId])
  @@index([jobThaiOccupationId])
  @@map("program_jobthai_links")
}
```

Add back-relations on `Program`, `JobThaiOccupation` and `IngestionRun`.

- [x] **Step 2: Hand-write the migration**

Generate a reference diff to a scratch path OUTSIDE the repo and copy only your own statements. A diff against this database also emits `DROP TABLE "mv_refresh_log"`, dropped `verdict_snapshots` columns, five `DROP INDEX` and two unrelated `CREATE INDEX`. Then:

```bash
pnpm tsx scripts/migration-linter.ts packages/db/prisma/migrations/<ts>_program_jobthai_link/migration.sql
pnpm --filter @kku/db exec prisma migrate deploy
pnpm --filter @kku/db exec prisma generate
```

Restart api and ingestion — `nest start --watch` does not see `packages/` changes.

- [x] **Step 3: Commit**

---

### Task 2: The bridge, pure functions first ✅ DONE

**Files:** create `packages/db/src/jobthai-bridge.ts`, test `packages/db/test/jobthai-bridge.test.ts`.

- [x] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';

import {
  JOBTHAI_MIN_POSTINGS_FOR_SIGNAL,
  eligiblePostingLevels,
  scoreFieldOfStudyLink,
  scoreSkillOverlapLink,
  combineLinkSources,
} from '../src/jobthai-bridge';

describe('eligiblePostingLevels', () => {
  it('restricts a postgraduate programme to postgraduate postings', () => {
    // THE TRAP: the field-of-study bridge matches a Master's in Accounting to
    // bachelor-level postings for สาขาบัญชี. 82% of doctoral programmes match
    // a field, but only 41 postings nationally state a postgraduate minimum.
    // Gating on the POSTING's level is what keeps the driver honest.
    expect(eligiblePostingLevels('MASTER')).toEqual(['MASTER', 'DOCTORATE']);
    expect(eligiblePostingLevels('DOCTORAL')).toEqual(['MASTER', 'DOCTORATE']);
  });

  it('lets a bachelor programme count bachelor and vocational-floor postings', () => {
    // A posting accepting ปวส or a bachelor's is open to a bachelor graduate.
    expect(eligiblePostingLevels('BACHELOR')).toContain('BACHELOR');
    expect(eligiblePostingLevels('BACHELOR')).toContain('HIGHER_VOCATIONAL_CERT');
    expect(eligiblePostingLevels('BACHELOR')).not.toContain('MASTER');
  });
});

describe('scoreFieldOfStudyLink', () => {
  it('scores an exact discipline match highest', () => {
    expect(scoreFieldOfStudyLink({ matchedFields: 3, totalFieldsForOccupation: 3 })).toBe(1);
  });

  it('returns 0 rather than null for no matched field — absence is measurable here', () => {
    expect(scoreFieldOfStudyLink({ matchedFields: 0, totalFieldsForOccupation: 5 })).toBe(0);
  });

  it('guards a zero denominator', () => {
    expect(scoreFieldOfStudyLink({ matchedFields: 0, totalFieldsForOccupation: 0 })).toBe(0);
  });
});

describe('scoreSkillOverlapLink', () => {
  it('is the share of the occupation demand set the programme teaches', () => {
    expect(scoreSkillOverlapLink({ sharedSkills: 5, occupationSkills: 10 })).toBe(0.5);
  });

  it('guards a zero denominator', () => {
    expect(scoreSkillOverlapLink({ sharedSkills: 0, occupationSkills: 0 })).toBe(0);
  });
});

describe('combineLinkSources', () => {
  it('labels a link found by both paths and scores it above either alone', () => {
    const both = combineLinkSources({ fieldScore: 0.5, skillScore: 0.5 });
    expect(both.linkSource).toBe('both');
    expect(both.score).toBeGreaterThan(0.5);
  });

  it('labels a field-only link', () => {
    expect(combineLinkSources({ fieldScore: 0.8, skillScore: 0 }).linkSource).toBe('field-of-study');
  });

  it('labels a skill-only link', () => {
    expect(combineLinkSources({ fieldScore: 0, skillScore: 0.8 }).linkSource).toBe('skill-overlap');
  });

  it('returns null when neither path found anything, rather than a zero link', () => {
    expect(combineLinkSources({ fieldScore: 0, skillScore: 0 })).toBeNull();
  });

  it('uses the measured signal floor', () => {
    // 25th percentile of the observed per-programme distribution. The spec
    // guessed 30, which discarded 18 more programmes for no measured reason.
    expect(JOBTHAI_MIN_POSTINGS_FOR_SIGNAL).toBe(20);
  });
});
```

- [x] **Step 2: Run to verify they fail** — `pnpm --filter @kku/db test -- jobthai-bridge`

- [x] **Step 3: Implement**

```ts
/**
 * Minimum postings behind a programme's links before its JobThai signal is
 * trusted. 20 is the observed 25th percentile of the per-programme
 * distribution (min 3, p25 20, median 136, p75 433, max 3,534 over 246 matched
 * programmes). Below it a programme's signal rests on a handful of adverts.
 */
export const JOBTHAI_MIN_POSTINGS_FOR_SIGNAL = 20;

/**
 * Which posting education levels a programme's graduates can answer.
 *
 * THIS IS THE HONEST-SIGNAL GATE. The field-of-study bridge matches a Master's
 * in Accounting to bachelor-level postings for สาขาบัญชี — 79% of master's and
 * 82% of doctoral programmes match some field — but only 41 postings nationally
 * state a postgraduate minimum. Without this gate a PhD programme receives a
 * demand signal built from undergraduate job adverts and looks entirely
 * healthy while being wrong.
 */
export function eligiblePostingLevels(programLevel: string): string[] {
  if (programLevel === 'MASTER' || programLevel === 'DOCTORAL') return ['MASTER', 'DOCTORATE'];
  // A posting whose floor is vocational is open to a bachelor's graduate.
  return ['VOCATIONAL_CERT', 'HIGHER_VOCATIONAL_CERT', 'BACHELOR'];
}
```

`combineLinkSources` returns `{ linkSource, score }` or null. For `both`, score is `1 - (1 - fieldScore) * (1 - skillScore)` — corroboration raises confidence above either path alone without letting it exceed 1.

- [x] **Step 4: Run tests, then commit**

---

### Task 3: The link runner ✅ DONE — 2,105 links, thresholds corrected after hand-inspection

**Files:** create `apps/ingestion/src/scripts/jobthai-link-programs.ts`; register `jobthai:link-programs`.

- [x] **Step 1: Implement, dry-run by default**

For each canonical ACTIVE programme:
1. Resolve eligible postings via `eligiblePostingLevels(programme.level)`.
2. **Field path** — match `requiredFieldsRaw` against the programme's discipline. Treat `*ANY*` as a match only where the occupation also passes the skill path, or every programme links to every "any field" occupation.
3. **Skill path** — intersect `ProgramSkill` with `JobThaiOccupationSkill`. This is the path the taxonomy de-duplication just unblocked: before it, a programme pointing at one "Data Science" row and the demand set at another produced a silent false negative.
4. `combineLinkSources`, upsert with `postingCount` and `ingestionRunId`.

- [x] **Step 2: Run for real and record**

Report: programmes linked, links by `linkSource`, how many programmes clear the floor, and **how many postgraduate programmes end up with zero eligible postings** — expect nearly all of them, and that is the gate working.

- [x] **Step 3: Inspect 10 links by hand before trusting them**

Print programme name, occupation, score, source and evidence for a spread of scores. A link that reads implausibly means the field matcher is too loose — fix it before the driver consumes it. Plan A's field-of-study extraction needed three rounds of exactly this.

- [x] **Step 4: Commit**

---

### Task 4: The relevance driver and `health-score.v5.1` ✅ DONE

**Files:** `packages/db/src/health-score.ts`, `packages/db/src/methodology-bundle.ts`, tests.

- [x] **Step 1: Write the failing tests**

Extend `packages/db/test/health-score-driver-parity.test.ts`, whose mock harness
already exists:

```ts
describe('jobthai_demand_alignment', () => {
  it('is a canonical relevance driver', () => {
    expect(DIMENSION_DRIVERS.relevance).toContain('jobthai_demand_alignment');
  });

  it('is the share of the programme's taught skills that its occupations demand', async () => {
    mocks.facultyFindMany.mockResolvedValue([{ id: 'fac-1', nameEn: 'Science', nameTh: 'วิทย์' }]);
    mocks.queryMetricByScope.mockResolvedValue([]);
    mocks.programFindMany.mockResolvedValue([{ id: 'prog-1', nameEn: 'A', nameTh: 'ก', facultyId: 'fac-1' }]);
    mocks.programFindUnique.mockResolvedValue({ id: 'prog-1', level: 'BACHELOR', nameTh: 'ก', kmitlCareerIds: [] });
    // 4 taught skills, 2 of them demanded by the linked occupations.
    mocks.programSkillFindMany.mockResolvedValue([
      { skillId: 's1' }, { skillId: 's2' }, { skillId: 's3' }, { skillId: 's4' },
    ]);
    mocks.programJobThaiLinkFindMany.mockResolvedValue([
      { jobThaiOccupationId: 'o1', postingCount: 500 },
    ]);
    mocks.jobThaiOccupationSkillFindMany.mockResolvedValue([{ skillId: 's1' }, { skillId: 's2' }]);

    const rows = await computeHealthScores('faculty', 'fac-1');
    const d = rows[0]!.dimensions.relevance.drivers.find((x) => x.label === 'jobthai_demand_alignment');
    expect(d!.value).toBe(50);
  });

  it('is NULL, never 0, for a postgraduate programme', async () => {
    // Not because no field matched — 82% of doctoral programmes DO match a
    // field — but because the postings behind those matches require only a
    // bachelor's. Only 41 postings nationally state a postgraduate minimum.
    mocks.facultyFindMany.mockResolvedValue([{ id: 'fac-1', nameEn: 'Science', nameTh: 'วิทย์' }]);
    mocks.queryMetricByScope.mockResolvedValue([]);
    mocks.programFindMany.mockResolvedValue([{ id: 'prog-1', nameEn: 'A', nameTh: 'ก', facultyId: 'fac-1' }]);
    mocks.programFindUnique.mockResolvedValue({ id: 'prog-1', level: 'DOCTORAL', nameTh: 'ก', kmitlCareerIds: [] });
    mocks.programSkillFindMany.mockResolvedValue([{ skillId: 's1' }]);
    mocks.programJobThaiLinkFindMany.mockResolvedValue([]);

    const rows = await computeHealthScores('faculty', 'fac-1');
    const d = rows[0]!.dimensions.relevance.drivers.find((x) => x.label === 'jobthai_demand_alignment');
    expect(d!.value).toBeNull();
  });

  it('is NULL below the signal floor rather than scoring a handful of adverts', async () => {
    mocks.facultyFindMany.mockResolvedValue([{ id: 'fac-1', nameEn: 'Science', nameTh: 'วิทย์' }]);
    mocks.queryMetricByScope.mockResolvedValue([]);
    mocks.programFindMany.mockResolvedValue([{ id: 'prog-1', nameEn: 'A', nameTh: 'ก', facultyId: 'fac-1' }]);
    mocks.programFindUnique.mockResolvedValue({ id: 'prog-1', level: 'BACHELOR', nameTh: 'ก', kmitlCareerIds: [] });
    mocks.programSkillFindMany.mockResolvedValue([{ skillId: 's1' }]);
    mocks.programJobThaiLinkFindMany.mockResolvedValue([
      { jobThaiOccupationId: 'o1', postingCount: JOBTHAI_MIN_POSTINGS_FOR_SIGNAL - 1 },
    ]);
    mocks.jobThaiOccupationSkillFindMany.mockResolvedValue([{ skillId: 's1' }]);

    const rows = await computeHealthScores('faculty', 'fac-1');
    const d = rows[0]!.dimensions.relevance.drivers.find((x) => x.label === 'jobthai_demand_alignment');
    expect(d!.value).toBeNull();
  });
});
```

Add `programJobThaiLinkFindMany` and `jobThaiOccupationSkillFindMany` to the
harness's `vi.hoisted` mock block and to the `prisma` mock object.

The v5.0 parity guard will fail until the driver exists at both programme and
scope level — that is the guard doing its job, and it is why the v5.0 drift
cannot recur here. Note that the guard asserts against `DRIVER_NOT_COMPUTED`,
not merely against the label being present, because `summariseDrivers` pads
every canonical label.

- [x] **Step 2: Implement**

Add `jobthai_demand_alignment` to `DIMENSION_DRIVERS.relevance`, to `scoreRelevanceProgram`, and as a rollup in `scoreRelevanceScope` via `rolledUpDriver` — its calibration is per-programme, so it rolls up rather than aggregating.

- [x] **Step 3: Bump the version**

`HEALTH_SCORE_VERSION = 'health-score.v5.1'` and `BUNDLE_CALENDAR_TAG`. The manifest fingerprint recomputes from the constant.

- [x] **Step 4: Measure what moved**

```bash
pnpm consistency:check --no-write
```

Record the relevance mean before and after, how many programmes gained a non-null driver, and how many are null by the postgraduate gate versus by the floor. **Report the direction plainly** — v5.0's restored driver moved relevance DOWN because the dimension had been flattered by a missing input, and the same may happen here.

- [x] **Step 5: Docs and changelog**

`docs/methodologies/health-score.md`, both `content-{en,th}.tsx` version tables, and a changelog entry. State the geography and postgraduate caveats as numbers, and that postgraduate programmes get null rather than a score built from undergraduate adverts.

- [x] **Step 6: Full verification and commit**

All five suites green with counts at or above baseline (`@kku/shared` 995 · `@kku/db` 454 · web 157 · api 142 · ingestion 238), typecheck and lint clean.

---

## Definition of done

- `ProgramJobThaiLink` populated, every row carrying `ingestion_run_id`.
- `jobthai_demand_alignment` present at programme AND scope level, enforced by the parity guard.
- Null — never 0 — for postgraduate programmes and for below-floor programmes, with counts of each reported.
- `health-score.v5.1`, documented in both languages, with the measured before/after.
- 10 links hand-inspected before the driver consumed them.

## Out of scope

- The semantic embedding match pass. It stays disabled pending a ~100-sample labelled precision study; the floor is 0.72 from a 40-observation sanity check.
- Plan A's LLM phases: 240 occupation profiles, field-of-study normalisation, novel-skill discovery. Nothing blocks them; the deterministic path reached 78.2% without them.
- Trend and growth analysis, pending real posting dates from JobThai.
