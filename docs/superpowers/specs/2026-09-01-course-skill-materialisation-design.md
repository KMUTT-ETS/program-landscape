# Course-skill materialisation — design

**Date:** 2026-09-01
**Status:** approved for planning
**Surface:** backend-only (no new UI) — foundational data work for a later Program
Deep-Dive feature, tracked separately

## Why this exists

The eventual goal (a separate, later project) is a Program Deep-Dive feature that
recommends how a programme's curriculum could be revised, *at the course level*, to
incorporate its faculty's research expertise. That feature needs to be able to say
"course X currently covers skills A and B; consider extending it to cover C" — which
requires knowing, for a real course, which skills it currently covers.

That link does not exist today. Two "course" tables exist in the schema and they do not
talk to each other:

- `ProgramCourse` — real, populated data (2,638 rows across 285 programmes), sourced from
  the curriculum-PDF course extractor (`program-courses-extract.v1`) cross-joined with
  registrar class-offering GPA history. No relation to the skill taxonomy at all.
- `Course` / `CourseSkill` — has the skill-linkage schema this needs, but is **empty in
  production** (0 rows, confirmed 2026-09-01). The extraction handler that would populate
  `CourseSkill` (`EXTRACT_COURSE_SKILLS`, already built) exists but has never been run at
  scale, and even where it runs, nothing writes an `AiExtraction`'s approved payload
  through to real `CourseSkill` rows — that materialisation step was never built.

This document specs the standalone project that closes that gap: real `Course` rows for
every real `ProgramCourse`, real `CourseSkill` rows resolved against the real skill
taxonomy, with the review/approval discipline this codebase uses everywhere else. The
course-level recommendation feature itself is out of scope here and gets its own spec
once this data exists to build on.

## Non-goals

- **No ongoing pipeline hook.** This is a one-time backfill over the current 2,638
  `ProgramCourse` rows. New programmes or curriculum revisions added later are not
  auto-materialised — re-run the scripts manually. Wiring materialisation into the live
  `program-courses-extract.v1` trigger is deferred.
- **No new UI.** `/admin/extraction-review` already renders any `PENDING_REVIEW`
  `AiExtraction` row generically regardless of `extractionKind`, so `COURSE_SKILLS` rows
  that don't auto-approve are reviewable there without any new screen.
- **No the course-level recommendation feature.** That's Phase 2, specced separately
  after this ships and its real output (match rates, skill coverage) can inform that
  design instead of assuming numbers ahead of time.
- **No re-architecture of `ProgramCourse` vs `Course`.** `ProgramCourse` remains the
  source of truth for course identity; `Course` is created *from* it, never the reverse.

## Data flow — five components, run in this order

```
1. Skill-embedding backfill  (Skill.embedding, 5,152 rows, 0 → populated)
        ↓
2. Candidate-selection fix   (pickCandidateSkills: random-30 → pgvector similarity)
        ↓
3. Course materialisation    (ProgramCourse → Course, 2,638 rows, digest-matched enrichment)
        ↓
4. Course-skill extraction   (existing course-skills.v2 prompt, run at scale)
        ↓
5. Materialisation-on-approval (AiExtraction → real CourseSkill rows, + PROPOSED_SKILL for misses)
```

### 1. Skill-embedding backfill

**New script:** `apps/ingestion/src/scripts/backfill-skill-embeddings.ts`, exposed as
`pnpm skills:backfill-embeddings`.

Confirmed state (2026-09-01): 5,152 `Skill` rows, 0 with `embedding IS NOT NULL`.

The `EMBED_SKILL` ai-job handler (`apps/ingestion/src/ai-jobs/handlers.ts`) already does
the per-skill embed-and-write correctly — it just has never been invoked for the full
taxonomy. This script does the same work directly (not via BullMQ, so it doesn't need
the ingestion worker running):

- Batches of 25 skills (matching the chunk size used by `kmitl-skill-mapping` and
  `kku-research`'s concurrent-upsert pattern elsewhere in this codebase).
- For each skill: text = `${nameEn} | ${nameTh} | ${category ?? ''}` (identical to the
  `EMBED_SKILL` handler's existing text construction — do not diverge, so a skill
  embedded via either path produces the same vector for the same input).
- `AiService.embed()` called once per batch (the embed API accepts multiple texts per
  call); vectors written back via the existing `$executeRaw ... ::vector` pattern.
- Idempotent: `WHERE embedding IS NULL` scoping means a second run only picks up new
  skills (e.g. ones added between now and a future run).
- JSONL run log at `logs/skill-embedding-backfill-<ts>.jsonl`, one line per skill:
  `{skillId, nameEn, status: 'embedded'|'failed', error?}`.

### 2. Candidate-selection fix

**Modified file:** `apps/ingestion/src/ai-jobs/handlers.ts`, function `pickCandidateSkills`.

Current implementation (verbatim, lines 552-568):

```ts
async function pickCandidateSkills(limit: number) {
  // Placeholder candidate strategy: most-recent N skills. Real impl
  // uses vector similarity over the query text once embeddings are
  // populated (see EMBED_SKILL handler). The switch is a single
  // $queryRaw replacement when prompt 04's embedding backfill runs.
  const rows = await prisma.skill.findMany({
    select: { id: true, nameTh: true, nameEn: true, category: true },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return rows.map((r) => ({ id: r.id, nameTh: r.nameTh, nameEn: r.nameEn, category: r.category }));
}
```

New signature: `pickCandidateSkills(queryText: string, limit: number, ai: AiService)`.

1. Embed `queryText` via `ai.embed({ ctx: { module: 'curriculum', kind: 'candidate-skill-search' }, texts: [queryText] })`.
2. `$queryRaw` ordering by `embedding <-> ${vectorLit}::vector` (same literal-vector
   pattern as `EMBED_SKILL`'s write path), `WHERE embedding IS NOT NULL`, `LIMIT ${limit}`.
3. Same return shape as today (`{id, nameTh, nameEn, category}[]`) — callers don't change.

Both call sites update to pass a query string:

- `EXTRACT_COURSE_SKILLS`: query = `${course.nameEn} ${course.nameTh} ${course.descriptionEn ?? ''} ${course.descriptionTh ?? ''}`.trim()`.
- `EXTRACT_JOB_POSTING_SKILLS`: query = `${posting.title} ${posting.descriptionRaw ?? ''}`.trim()` — this handler shares the same placeholder and gets the same fix as an incidental improvement, not additional scope (same function, same call site shape).

This means every `EXTRACT_COURSE_SKILLS` / `EXTRACT_JOB_POSTING_SKILLS` call now costs one
extra `embed()` call (the query embedding) on top of the existing `extractStructured()`
call. Both are small, cheap calls — folded into the cost estimate below.

### 3. Course materialisation

**New script:** `apps/ingestion/src/scripts/materialise-courses-from-program-courses.ts`,
exposed as `pnpm curriculum:materialise-courses [--program <code>] [--limit N]`.

For each `ProgramCourse` row without a matching `Course` (checked via the existing
`@@unique([programId, code])` on `Course`):

1. **Identity fields — copied verbatim from `ProgramCourse`, this table is the source of
   truth for identity:**
   - `Course.code` = `ProgramCourse.courseCode` (the normalised form, not `courseCodeRaw`
     — matches how the rest of the codebase already treats `courseCode` as canonical, e.g.
     the join against `ClassOffering.courseCode`).
   - `Course.nameTh` = `ProgramCourse.courseNameTh`; `Course.nameEn` = `ProgramCourse.courseNameEn`.
   - `Course.credits` = `ProgramCourse.credits`.
   - `Course.programId` = `ProgramCourse.programId`.

2. **Null-handling (`ProgramCourse.courseNameTh/En` and `.credits` are nullable;
   `Course.nameTh/En` and `.credits` are not) — explicit fallbacks, each counted and
   reported, never silently dropped:**
   - Missing `courseNameTh` → falls back to `courseCodeRaw` (or `courseCode` if raw is
     also empty). Same for `courseNameEn`.
   - Missing `credits` → defaults to `0`.
   - Every fallback increments a counter in the run summary (`namesFilledFromCode`,
     `creditsDefaultedToZero`) so the operator can see how much of the materialised set
     has degraded identity data, without the script refusing to create the row.

3. **`type`** — defaults to the schema default `ELECTIVE`. Neither source table carries a
   reliable core/elective signal; not worth inventing a heuristic for this pass.

4. **Description enrichment — best-effort match against the program's digest:**
   - Look up the program's most recent `PROGRAM_DIGEST` `AiExtraction` (status
     `APPROVED` or `AUTO_APPROVED`, latest `createdAt`), read `payloadJson.courses[]`.
   - Match attempt, in order: (a) exact match on course code (normalised: uppercase,
     whitespace-stripped, compared against `ProgramCourse.courseCode`'s own normalised
     form); (b) if no code match, case-insensitive exact match on `nameEn` or `nameTh`.
     No fuzzy/similarity matching for names — an exact-or-nothing rule keeps this
     deterministic and auditable; partial name matches are exactly the kind of silent
     wrong-course-content merge this feature cannot afford.
   - On match: `Course.descriptionTh`/`descriptionEn` copied from the digest course entry.
   - No match (including: program was never digested, or digest has no `courses[]`):
     `Course` row is still created, with `descriptionTh`/`descriptionEn` left `null`. This
     is not an error — the extraction step (below) already handles a course with no
     description; it's simply thinner grounding for that one course.
   - Run summary reports `descriptionMatchedByCode`, `descriptionMatchedByName`,
     `descriptionUnmatched` counts.

5. **Idempotency:** the `@@unique([programId, code])` constraint means a second run is a
   no-op for already-materialised courses (checked before insert, not relying on a DB
   error — matches the `findFirst`-then-`create` pattern used elsewhere in this codebase
   for compound keys, e.g. `FacultyCompensation`).

Output: JSONL run log at `logs/course-materialise-<ts>.jsonl` (one line per
`ProgramCourse` row processed) plus an aggregate summary printed at the end (counts as
above, per-program breakdown available with `--verbose`).

### 4. Course-skill extraction

**New script:** `apps/ingestion/src/scripts/extract-course-skills-bulk.ts`, exposed as
`pnpm curriculum:extract-course-skills [--program <code>] [--limit N]`.

Direct sequential/chunked calls to `AiService`, not BullMQ — matching the
`programs:digest-bulk` precedent (doesn't require the ingestion worker to be running,
gives a single coherent run log for a one-time backfill). Chunk size 10 (course
descriptions are longer than skill-embedding text; keep concurrency lower than the
25-chunk used for the embedding backfill to stay within provider rate limits, matching
`kmitl-skill-mapping`'s 25-chunk vs `kku-research`'s lighter concurrency choice for
larger payloads).

For every `Course` row without an existing `AiExtraction` where
`extractionKind = 'COURSE_SKILLS'` and `sourceEntityId = course.id`:

1. Call `pickCandidateSkills(queryText, 30, ai)` (component 2, now real vector search).
2. Call `buildCourseSkillExtractionMessages()` (existing, **unmodified** —
   `course-skills.v2` prompt is not touched by this project) with the course fields and
   the real candidate list.
3. `ai.extractStructured()` against `CourseSkillExtractionSchema` (existing, unmodified).
4. Write `AiExtraction` row exactly as `EXTRACT_COURSE_SKILLS` already does today
   (`sourceEntityType: 'course'`, `extractionKind: 'COURSE_SKILLS'`, `reviewStatus:
   confidence >= 0.85 ? 'AUTO_APPROVED' : 'PENDING_REVIEW'`) — this script reuses the
   exact same write shape as the existing ai-job handler; it is a bulk *driver* for that
   handler's logic, not a divergent implementation.
5. **If `AUTO_APPROVED`:** immediately call `materialiseCourseSkills(extraction.id)`
   (component 5) in the same pass — no separate step, no waiting for a human to click
   approve for the 85%+ confidence rows.
6. **If `PENDING_REVIEW`:** row sits in the queue, visible at `/admin/extraction-review`
   like any other pending extraction, materialising only once an analyst approves it
   (component 5's function is also wired into the approve endpoint — see below).

Per-course try/catch; a failure on one course logs and continues rather than aborting the
run (matching `programs:digest-bulk`'s resilience posture). JSONL run log at
`logs/course-skill-extraction-<ts>.jsonl`.

### 5. Materialisation-on-approval

**New file:** `packages/db/src/course-skill-materialize.ts`, exporting
`materialiseCourseSkills(extractionId: string): Promise<MaterialiseCourseSkillsResult>` —
structurally mirrors `materialiseProgramDigest()` in `packages/db/src/program-digest-materialize.ts`.

```ts
export interface MaterialiseCourseSkillsResult {
  courseId: string;
  skillsLinked: number;
  skillsProposed: number;
  alreadyMaterialised: boolean;
}
```

Behaviour:

- Reads the `AiExtraction` row (`extractionKind` must be `COURSE_SKILLS`), parses
  `payloadJson` against `CourseSkillExtractionSchema` (imported from
  `@kku/shared` — reused, not re-declared).
- For each `payloadJson.skills[]` entry with a non-empty `skillId` that resolves to a
  real `Skill` row: upsert `CourseSkill` on `(courseId, skillId)` — `weight` from the
  payload, `source: 'LLM_EXTRACTED'` (existing `SkillSource` enum value — confirmed
  present in the schema today, `MANUAL | LLM_EXTRACTED`; no enum change needed),
  `confidence` from the extraction's overall `confidence` field.
- `skillId`s in the payload that don't resolve to a real `Skill` (the model
  hallucinated/misquoted a candidate id) are dropped and counted, not written — this
  should be rare given real candidates are now supplied, and any nonzero count is a
  signal worth surfacing in the run summary, not silently ignoring.
- Each `payloadJson.proposedSkills[]` entry becomes a sibling `AiExtraction` row with
  `extractionKind: 'PROPOSED_SKILL'`, `sourceEntityType: 'course'`,
  `sourceEntityId: course.id` — identical convention to
  `materialiseProgramDigest()`'s existing `PROPOSED_SKILL` emission (same schema shape:
  `nameTh`, `nameEn`, `suggestedParentSkillId`, `rationale`). These queue for the same
  analyst-driven taxonomy-growth path already in use for digest-sourced proposals.
- Idempotency: re-running for an already-materialised extraction is a no-op
  (`alreadyMaterialised: true`) — checked via a marker in the extraction row (matching
  `materialiseProgramDigest`'s existing timestamp-in-`reviewNotes` approach, reused
  verbatim rather than inventing a second convention).

**Wiring:**

- `apps/api/src/ai-admin/ai-admin.controller.ts`'s `approve()` method gains a branch for
  `extractionKind === 'COURSE_SKILLS'` alongside the existing `PROGRAM_DIGEST` and
  `IMD_RANKINGS` branches — same try/catch-and-surface-error-without-unwinding-approval
  pattern already used for those two.
- `approveAllPending()` (bulk endpoint) gains the same dispatch, matching how it already
  chains `PROGRAM_DIGEST`/`IMD_RANKINGS` materialisation today.
- Component 4's bulk script calls `materialiseCourseSkills()` directly for
  `AUTO_APPROVED` rows (not via HTTP) — same "script calls the shared function directly,
  HTTP endpoint calls the same shared function" pattern as `programs:approve-pending`
  calling `materialiseProgramDigest()` directly.

## Schema changes

**None.** `Course`, `CourseSkill`, `Skill.embedding`, and `SkillSource.LLM_EXTRACTED` are
all pre-existing columns/tables/enum values — confirmed by reading
`packages/db/prisma/schema.prisma` during design. This project populates existing
structure; it does not reshape it.

## Cost estimate

| Call type | Count | Notes |
|---|---|---|
| Skill embedding (batched) | ~5,152 texts, ~25/batch → ~206 API calls | one-time |
| Query embedding (per course, for candidate search) | ~2,638 | small text, cheap |
| Course-skill extraction (`extractStructured`) | ~2,638 | same order of magnitude as `program-digest` (~$0.04/call observed) |

Rough total: **$15–30**, same order of magnitude as the `program-digest` bulk run
($8.10 for 228 programmes). Actual spend is visible in `AiInference.costEstimateUsd`
after the run, same as every other AI pipeline in this codebase.

## Verification / acceptance

- `Skill` embedding coverage: `SELECT COUNT(*) FROM skills WHERE embedding IS NOT NULL`
  reaches 5,152 (or very close — a handful of provider failures are acceptable if logged).
- `Course` row count reaches 2,638 (one per `ProgramCourse`, allowing for the
  already-existing-skip case on re-run).
- `CourseSkill` row count > 0, with a materially better skill-match distribution than a
  spot-check against the old random-30 candidate approach would have produced (informal
  check, not a hard threshold — this is a judgement call made by reading a sample of
  extractions post-run, not a CI assertion).
- `AiExtraction` rows with `extractionKind = 'COURSE_SKILLS'` split sensibly between
  `AUTO_APPROVED` (≥0.85 confidence) and `PENDING_REVIEW`; the latter are visible and
  actionable at `/admin/extraction-review` without any new UI work.
- Re-running any of the four scripts a second time with no schema/data changes produces
  zero new rows (idempotency check).

## Deferred / explicitly not built here

- Ongoing pipeline hook (auto-materialise on future `program-courses-extract.v1` runs).
- The course-level curriculum-recommendation feature itself (Phase 2 — separate spec).
- Any UI beyond the existing generic `/admin/extraction-review` queue.
- Fuzzy/similarity-based name matching for digest-course enrichment (deliberately exact-
  match-or-nothing, see component 3).
