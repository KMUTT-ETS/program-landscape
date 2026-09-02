# Research-Informed Curriculum Revision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Curriculum revision" section to Program Deep-Dive that turns a programme's faculty research strength into course-level advice — which named course to extend and with what, which course to create, and which elective deserves promotion to required.

**Architecture:** Two components. **A** bumps `program-courses-extract` to v2 to capture each course's หมวด category (no such signal exists today) and stores it on `ProgramCourse`. **B** adds a new prompt, a pure input assembler, a **pure anti-fabrication validator** that drops any recommendation naming a course or theme that isn't real, a runner mirroring `generateProgramResearchExpertise()`, a persisted table, two endpoints, a bulk script, and the UI section. B's other three lanes work without A; only the promotion lane depends on it.

**Tech Stack:** TypeScript, Prisma/PostgreSQL, Zod, `AiService` (`@kku/shared`), NestJS, Next.js 14, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-01-curriculum-revision-recommendation-design.md`

---

## File structure

| File | Responsibility |
|---|---|
| `packages/shared/src/ai/prompts/program-courses-extract.ts` | **Modify** — add `category` to `CourseSchema`, bump to v2 |
| `packages/db/prisma/migrations/20260901120000_program_course_category/migration.sql` | **Create** — `CourseCategory` enum + `program_courses.category` |
| `packages/db/prisma/schema.prisma` | **Modify** — same, on the Prisma side |
| `apps/ingestion/src/scripts/materialise-program-courses.ts` | **Modify** — carry `category` through |
| `packages/shared/src/ai/prompts/program-curriculum-revision.ts` | **Create** — the new prompt: version, Zod schema, message builder, confidence reuse |
| `packages/db/src/program-curriculum-revision.ts` | **Create** — input assembly (Prisma) + readiness, and the **pure validator** |
| `packages/db/src/program-curriculum-revision-run.ts` | **Create** — the runner (AI call, lint retry, clamp, validate, persist) |
| `packages/db/prisma/migrations/20260901130000_program_curriculum_revision/migration.sql` | **Create** — the new table |
| `apps/api/src/programs/deep-dive.controller.ts` | **Modify** — GET + POST regenerate |
| `apps/ingestion/src/scripts/generate-curriculum-revision.ts` | **Create** — bulk script |
| `apps/web/app/programs/[id]/types.ts` | **Modify** — response types |
| `apps/web/app/programs/[id]/page.tsx` | **Modify** — fetch the section |
| `apps/web/app/programs/[id]/client.tsx` | **Modify** — render the section |

**Ordering:** Component A (Tasks 1–4) runs first so that Component B's first bulk generation already has category data and produces promotion candidates. B is buildable without A.

---

# Component A — Course category

### Task 1: Add `category` to the course-extraction prompt (v2)

**Files:**
- Modify: `packages/shared/src/ai/prompts/program-courses-extract.ts`
- Test: `packages/shared/test/program-courses-extract.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

```typescript
// packages/shared/test/program-courses-extract.test.ts
import { describe, it, expect } from 'vitest';
import {
  PROGRAM_COURSES_EXTRACT_VERSION,
  ProgramCoursesExtractSchema,
} from '../src/ai/prompts/program-courses-extract';

describe('program-courses-extract v2 — course category', () => {
  it('is stamped v2', () => {
    expect(PROGRAM_COURSES_EXTRACT_VERSION).toBe('program-courses-extract.v2');
  });

  it('accepts every category the Thai curriculum structure uses', () => {
    for (const category of [
      'GENERAL_EDUCATION',
      'CORE',
      'MAJOR_REQUIRED',
      'MAJOR_ELECTIVE',
      'FREE_ELECTIVE',
      'THESIS_PROJECT',
      'UNKNOWN',
    ]) {
      const parsed = ProgramCoursesExtractSchema.parse({
        courses: [{ code: 'EN241100', nameTh: 'x', nameEn: 'x', credits: 3, category }],
        caveats: [],
        confidence: 0.9,
      });
      expect(parsed.courses[0]!.category).toBe(category);
    }
  });

  it('defaults a missing category to UNKNOWN rather than guessing one', () => {
    // A v1-era payload, or a course the model could not place. Defaulting
    // to a real category would produce confidently wrong promotion advice.
    const parsed = ProgramCoursesExtractSchema.parse({
      courses: [{ code: 'EN241100', nameTh: 'x', nameEn: 'x', credits: 3 }],
      caveats: [],
      confidence: 0.9,
    });
    expect(parsed.courses[0]!.category).toBe('UNKNOWN');
  });

  it('rejects a category outside the enum', () => {
    expect(() =>
      ProgramCoursesExtractSchema.parse({
        courses: [{ code: 'EN241100', nameTh: 'x', nameEn: 'x', credits: 3, category: 'ELECTIVE' }],
        caveats: [],
        confidence: 0.9,
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && npx vitest run test/program-courses-extract.test.ts`
Expected: FAIL — version is still `program-courses-extract.v1` and `category` is stripped as an unknown key.

- [ ] **Step 3: Update the schema and version**

In `packages/shared/src/ai/prompts/program-courses-extract.ts`, change the version constant to:

```typescript
export const PROGRAM_COURSES_EXTRACT_VERSION = 'program-courses-extract.v2';
```

and extend `CourseSchema` (currently at ~line 85) with the category field:

```typescript
/** The หมวด grouping a course sits under in the curriculum structure.
 *  Richer than the Course.type enum (CORE/ELECTIVE/GENERAL), which cannot
 *  express บังคับ-vs-เลือก WITHIN หมวดวิชาเฉพาะ — exactly the distinction
 *  elective-to-core promotion advice depends on.
 *
 *  UNKNOWN is a first-class answer, not a failure: a course the model
 *  cannot place must say so. Defaulting it into a real category would
 *  produce a confidently wrong promotion recommendation. */
export const CourseCategorySchema = z.enum([
  'GENERAL_EDUCATION', // หมวดวิชาศึกษาทั่วไป
  'CORE',              // วิชาแกน / วิชาพื้นฐาน
  'MAJOR_REQUIRED',    // วิชาเฉพาะบังคับ
  'MAJOR_ELECTIVE',    // วิชาเฉพาะเลือก
  'FREE_ELECTIVE',     // หมวดวิชาเลือกเสรี
  'THESIS_PROJECT',    // วิทยานิพนธ์ / การศึกษาอิสระ / โครงงาน
  'UNKNOWN',
]);
export type CourseCategory = z.infer<typeof CourseCategorySchema>;

const CourseSchema = z.object({
  /** Whitespace-stripped, upper-cased code as it appears in the PDF.
   *  Materialiser normalises again before insert so EN241100 == "EN 241 100". */
  code: z.string().min(2),
  nameTh: z.string().default(''),
  nameEn: z.string().default(''),
  credits: z.number().int().min(0).max(60).nullable().default(null),
  category: CourseCategorySchema.default('UNKNOWN'),
});
```

- [ ] **Step 4: Teach the model the category rule**

In the same file, inside the system prompt string, add this block immediately before the output-format description (find the existing rules list and append):

```
COURSE CATEGORY:
Every course must carry a `category` naming the หมวด it sits under in the
curriculum structure:
  GENERAL_EDUCATION  หมวดวิชาศึกษาทั่วไป
  CORE               วิชาแกน / วิชาพื้นฐาน
  MAJOR_REQUIRED     วิชาเฉพาะบังคับ (required within the major)
  MAJOR_ELECTIVE     วิชาเฉพาะเลือก (elective within the major)
  FREE_ELECTIVE      หมวดวิชาเลือกเสรี
  THESIS_PROJECT     วิทยานิพนธ์ / การศึกษาอิสระ / โครงงาน
  UNKNOWN            the section headers do not place this course

Read the category from the section heading the course is listed under, not
from the course name. When a course appears under no clear heading, return
UNKNOWN — do NOT infer a category from the course title or code. A wrong
category is worse than an absent one, because downstream advice about
promoting an elective to required is built on this field.
```

Also update the file's header comment to record the v2 change, following the existing convention in this codebase's prompt files (e.g. `course-skill-extraction.ts`'s `// v2 (2026-08-17, ...)` note):

```typescript
// v2 (2026-09-01): added `category` per course (the หมวด grouping), read
// from the curriculum-structure headings the extractor already slices. v1
// discarded them. Enables elective-to-core promotion advice in
// program-curriculum-revision.v1. No change to code/name/credits behaviour.
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/shared && npx vitest run test/program-courses-extract.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Verify the prompt-standard ratchet still passes**

Run: `cd packages/shared && npx vitest run test/prompt-standard-conformance.test.ts`
Expected: PASS — `program-courses-extract.ts` is not on the `NOT_YET_CONFORMANT` allowlist, so it must still carry CHANNEL MANIFEST / CONFIDENCE RUBRIC / English rule / BANNED PHRASES. The edits above add to the prompt body and must not remove any marker.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/ai/prompts/program-courses-extract.ts packages/shared/test/program-courses-extract.test.ts
git commit -m "feat(curriculum): program-courses-extract v2 captures course category"
```

---

### Task 2: Persist `category` on `ProgramCourse`

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260901120000_program_course_category/migration.sql`

- [ ] **Step 1: Add the enum and column to the Prisma schema**

In `packages/db/prisma/schema.prisma`, add the enum next to the existing `CourseType` enum:

```prisma
/// The หมวด grouping a course sits under in the curriculum structure.
/// Distinct from CourseType (CORE/ELECTIVE/GENERAL), which cannot express
/// บังคับ-vs-เลือก within หมวดวิชาเฉพาะ. Populated by
/// program-courses-extract.v2; NULL on rows extracted by v1.
enum CourseCategory {
  GENERAL_EDUCATION
  CORE
  MAJOR_REQUIRED
  MAJOR_ELECTIVE
  FREE_ELECTIVE
  THESIS_PROJECT
  UNKNOWN
}
```

and add the column to `model ProgramCourse`, after `credits`:

```prisma
  /// Nullable: rows extracted by program-courses-extract v3 and earlier
  /// have no category and must stay valid. Re-run the extractor to fill
  /// them. Also permanently NULL for rows from the extractor's regex
  /// name-fallback path (methodVersion ending `-fallback`), which has no
  /// section-heading context to read a category from.
  category       CourseCategory? @map("category")
```

- [ ] **Step 2: Write the migration SQL by hand**

Create `packages/db/prisma/migrations/20260901120000_program_course_category/migration.sql`:

```sql
-- CreateEnum
CREATE TYPE "CourseCategory" AS ENUM ('GENERAL_EDUCATION', 'CORE', 'MAJOR_REQUIRED', 'MAJOR_ELECTIVE', 'FREE_ELECTIVE', 'THESIS_PROJECT', 'UNKNOWN');

-- AlterTable
ALTER TABLE "program_courses" ADD COLUMN "category" "CourseCategory";
```

(Hand-written rather than generated: `prisma migrate dev` needs a TTY that Claude Code sessions don't have — see CLAUDE.md's non-interactive migration workflow.)

- [ ] **Step 3: Apply the migration**

Run: `cd packages/db && npx prisma migrate deploy && npx prisma generate`
Expected: `1 migration found` / `Applied migration 20260901120000_program_course_category`, then a successful client regeneration.

- [ ] **Step 4: Verify the column exists and Prisma can query it**

Run:
```bash
cd packages/db && npx tsx -e "
import { prisma } from './src/index';
(async () => {
  const r = await prisma.programCourse.findFirst({ select: { courseCode: true, category: true } });
  console.log('sample row:', r);
  const nulls = await prisma.programCourse.count({ where: { category: null } });
  console.log('rows with NULL category (expected: all 2638):', nulls);
  await prisma.\$disconnect();
})();
"
```
Expected: a sample row with `category: null`, and `2638` NULL rows — v1-extracted data survived the migration intact.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260901120000_program_course_category
git commit -m "feat(db): add CourseCategory to program_courses"
```

---

### Task 3: Carry `category` through the materialiser

**Files:**
- Modify: `apps/ingestion/src/scripts/materialise-program-courses.ts`

- [ ] **Step 1: Extend the `DigestCourse` interface**

In `apps/ingestion/src/scripts/materialise-program-courses.ts`, the local interface (~line 45) currently reads:

```typescript
interface DigestCourse {
  code?: string;
  courseCode?: string;
  nameTh?: string;
  nameEn?: string;
  credits?: number;
}
```

Add the category field:

```typescript
type DigestCourseCategory =
  | 'GENERAL_EDUCATION'
  | 'CORE'
  | 'MAJOR_REQUIRED'
  | 'MAJOR_ELECTIVE'
  | 'FREE_ELECTIVE'
  | 'THESIS_PROJECT'
  | 'UNKNOWN';

const VALID_CATEGORIES: ReadonlySet<string> = new Set<DigestCourseCategory>([
  'GENERAL_EDUCATION',
  'CORE',
  'MAJOR_REQUIRED',
  'MAJOR_ELECTIVE',
  'FREE_ELECTIVE',
  'THESIS_PROJECT',
  'UNKNOWN',
]);

interface DigestCourse {
  code?: string;
  courseCode?: string;
  nameTh?: string;
  nameEn?: string;
  credits?: number;
  category?: string;
}
```

- [ ] **Step 2: Write the category onto each row**

In the `rows.push({...})` block, the row type declaration currently lists `credits: number | null;`. Add to that inline type:

```typescript
          category: DigestCourseCategory | null;
```

and in the `rows.push({...})` object literal, after the `credits:` line, add:

```typescript
            // v1 payloads carry no category; an unrecognised value is
            // discarded rather than coerced, so a prompt drift can never
            // silently write a bogus category.
            category: c.category && VALID_CATEGORIES.has(c.category)
              ? (c.category as DigestCourseCategory)
              : null,
```

- [ ] **Step 3: Report category coverage in the summary**

Immediately before the existing `setRecordsLoaded(totalInserted);` line, add a counter. First declare it next to the other counters (`let totalInserted = 0;` etc.):

```typescript
    let totalWithCategory = 0;
```

then inside the per-programme loop, immediately after `totalInserted += rows.length;`, add:

```typescript
        totalWithCategory += rows.filter((r) => r.category !== null).length;
```

and add one line to the final console summary block:

```typescript
    console.log(`Rows with a category:      ${totalWithCategory} / ${totalInserted}`);
```

- [ ] **Step 4: Wire the SECOND writer — `program-courses-extract/run.ts`**

**`program_courses` has two writers, not one.** Besides the materialiser above, `apps/ingestion/src/program-courses-extract/run.ts` also does a delete-and-replace of a programme's `program_courses` rows (~line 284). If only the materialiser carries `category`, then any later single-programme `pnpm programs:extract-courses <code>` re-run **silently wipes that programme's categories back to NULL** — losing part of the $51 re-extraction with no error.

In `apps/ingestion/src/program-courses-extract/run.ts`:

1. Add `category` to the `rows` array's inline type (~line 219-227), matching the Prisma column's nullability:

```typescript
    category: CourseCategory | null;
```

Import the type from `@kku/shared` (it is exported by `program-courses-extract.ts` alongside `CourseCategorySchema`).

2. In the **LLM path** row literal (~line 243-251), carry the parsed value through:

```typescript
        category: c.category,
```

3. In the **fallback path** row literal (~line 271-279), carry the explicit UNKNOWN that `FallbackCourseExtraction.category` now holds:

```typescript
        // Structurally UNKNOWN — this path recovers a course from a text
        // window around its code and never reads the หมวด headings. Written
        // explicitly so promotion logic sees these rows as unplaced rather
        // than indistinguishable from "not yet re-extracted" NULLs.
        category: fb.category,
```

4. The dedup at ~line 241 is first-wins. When the LLM lists one course under two headings, one category is silently chosen. Add a counter for it and log the total at the end of the run, so a systematically ambiguous curriculum is visible rather than silent:

```typescript
    let duplicateCourseRows = 0;
```
increment it wherever the existing dedup discards a repeat, and include it in the run's summary log line.

- [ ] **Step 5: Correct the schema doc comment now that the wiring exists**

`packages/db/prisma/schema.prisma`'s `ProgramCourse.category` comment was written ahead of the wiring and is currently wrong in two ways. Fix both:

1. It says "Populated by program-courses-extract.v4" — only true once Step 4 lands. Now it is.
2. It says fallback rows are "permanently NULL". **They will be `UNKNOWN`, not NULL** — `FallbackCourseExtraction.category` is typed `Extract<CourseCategory, 'UNKNOWN'>` and Step 4 writes it through. That distinction is load-bearing for the promotion feature: `NULL` means "never run through a category-aware extractor", `UNKNOWN` means "ran, but the headings did not place this course". Conflating them would let promotion logic treat un-extracted rows as deliberately-unplaceable ones.

Replace the column comment with:

```prisma
  /// The หมวด grouping this course sits under. Written by both
  /// program_courses writers (program-courses-extract/run.ts and
  /// materialise-program-courses.ts).
  ///
  /// NULL vs UNKNOWN are different states, and the distinction is
  /// load-bearing for promotion advice:
  ///   NULL     — never run through a category-aware extractor (rows from
  ///              program-courses-extract v3 and earlier). Re-run the
  ///              extractor to fill them.
  ///   UNKNOWN  — ran, but the curriculum headings did not place the
  ///              course. Always the case for the extractor's regex
  ///              name-fallback path, which never reads หมวด headings.
  category       CourseCategory? @map("category")
```

Make the same correction to the `enum CourseCategory` doc comment above it if it repeats the "populated by v4 / NULL on v3" framing.

- [ ] **Step 6: Typecheck**

Run: `cd apps/ingestion && npx tsc --noEmit && cd ../../packages/db && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Dry-run to confirm nothing breaks on pre-v4 data**

Run: `pnpm programs:materialise-program-courses --dry-run`
Expected: completes; `Rows with a category: 0 / <n>` — correct, because no programme has been re-extracted with v4 yet.

- [ ] **Step 8: Commit**

```bash
git add apps/ingestion/src/scripts/materialise-program-courses.ts apps/ingestion/src/program-courses-extract/run.ts packages/db/prisma/schema.prisma
git commit -m "feat(curriculum): both program_courses writers carry course category"
```

---

### Task 4: Re-extract course categories for all programmes

**Files:** none — operational task.

Cost: `program-courses-extract` measured at **$0.178/call over 38 real calls** (91,609 input tokens average). 285 programmes ≈ **$51**.

- [ ] **Step 1: Smoke-test on one programme**

`extract-program-courses.ts` takes a **positional** selector and handles **one programme per invocation** — it has no `--program` flag and no bulk mode (`Usage: pnpm programs:extract-courses <code|mhesi|sequenceNo|id>`).

Run: `pnpm programs:extract-courses KKU-SEQ-0030`
Expected: completes and writes a new `AiExtraction`.

- [ ] **Step 2: Confirm categories actually came back**

Run:
```bash
cd packages/db && npx tsx -e "
import { prisma } from './src/index';
(async () => {
  const row = await prisma.aiExtraction.findFirst({
    where: { extractionKind: 'PROGRAM_COURSES_EXTRACT', methodVersion: 'program-courses-extract.v4' },
    orderBy: { createdAt: 'desc' }, select: { payloadJson: true },
  });
  const cs = (row?.payloadJson as any)?.courses ?? [];
  const dist: Record<string, number> = {};
  for (const c of cs) dist[c.category ?? 'MISSING'] = (dist[c.category ?? 'MISSING'] ?? 0) + 1;
  console.log('category distribution:', dist);
  await prisma.\$disconnect();
})();
"
```

(The extraction kind is `PROGRAM_COURSES_EXTRACT` — verified at `apps/ingestion/src/program-courses-extract/run.ts:183`.)

Expected: a spread across real categories — **not** every course `UNKNOWN`. **If everything comes back `UNKNOWN`, stop here.** The prompt instruction isn't landing, and re-running 285 programmes at $51 would buy nothing. Fix Task 1 Step 4's wording first.

- [ ] **Step 3: Run the full re-extraction**

There is no bulk mode, so drive the single-programme script in a shell loop over the canonical codes:

```bash
cd /home/denpong/projects/program-landscape
cd packages/db && npx tsx -e "
import { prisma } from './src/index';
(async () => {
  const ps = await prisma.program.findMany({
    where: { sequenceNoFromSheet: { not: null }, programCourses: { some: {} } },
    select: { code: true }, orderBy: { code: 'asc' },
  });
  console.log(ps.map(p => p.code).join('\n'));
  await prisma.\$disconnect();
})();
" > /tmp/course-codes.txt
cd /home/denpong/projects/program-landscape
wc -l /tmp/course-codes.txt   # expect ~285
nohup bash -c 'while read -r code; do
  echo "=== $code ==="; pnpm programs:extract-courses "$code" || echo "FAILED $code";
done < /tmp/course-codes.txt' > logs/courses-extract-v2.out 2>&1 &
```

Follow with: `tail -f logs/courses-extract-v2.out`
Expected: ~285 programmes; several hours; ≈$51. The `|| echo "FAILED $code"` keeps one bad programme from killing the loop — grep the log for `FAILED` afterwards and re-run those individually.

- [ ] **Step 4: Do NOT run the materialiser — it would destroy this run**

> ⚠️ **`pnpm programs:materialise-program-courses` MUST NOT be run after the re-extraction.**
>
> An earlier draft of this plan told you to. That was wrong and would have deleted every category the ~$51 run just produced. The reasoning:
>
> - `programs:extract-courses` writes `program_courses` **directly** via `program-courses-extract/run.ts`, categories included. After Step 3 the rows are already materialised — there is no second step to run.
> - `materialise-program-courses.ts` is a **different pipeline** reading `PROGRAM_DIGEST` payloads. `program-digest.v3`'s course schema has **no `category` field**, so every row it writes has `category = NULL`.
> - It does an unconditional `deleteMany({ programId })` + `createMany(...)` per programme. Running it after Step 3 replaces every category-bearing row with a NULL-category one.
>
> The two scripts are competing writers of the same table; whichever runs last wins. Task 3 added a guard that makes the materialiser refuse to clobber v4-extracted rows, but do not rely on it — simply do not run it here.

Nothing to do for this step. Proceed to Step 5.

- [ ] **Step 5: Record real coverage**

Run:
```bash
cd packages/db && npx tsx -e "
import { prisma } from './src/index';
(async () => {
  const byCat = await prisma.programCourse.groupBy({ by: ['category'], _count: true });
  console.log(byCat);
  await prisma.\$disconnect();
})();
"
```
Expected: a distribution including a meaningful count of `MAJOR_ELECTIVE` and `MAJOR_REQUIRED` — those two are what the promotion lane needs. Note the `UNKNOWN` + `null` share; it is a data-quality figure to report, not a defect to hide.

No commit — this task runs already-committed code.

---

# Component B — The curriculum-revision recommendation

### Task 5: The `program-curriculum-revision.v1` prompt

**Files:**
- Create: `packages/shared/src/ai/prompts/program-curriculum-revision.ts`
- Modify: `packages/shared/src/ai/prompts/index.ts` (add the export)
- Test: `packages/shared/test/program-curriculum-revision.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/shared/test/program-curriculum-revision.test.ts
import { describe, it, expect } from 'vitest';
import {
  PROGRAM_CURRICULUM_REVISION_VERSION,
  ProgramCurriculumRevisionSchema,
  buildProgramCurriculumRevisionMessages,
  type CurriculumRevisionInput,
} from '../src/ai/prompts/program-curriculum-revision';

const input: CurriculumRevisionInput = {
  program: {
    code: 'KKU-SEQ-0001', nameTh: 'วิศวกรรมศาสตรบัณฑิต', nameEn: 'B.Eng.',
    levelTh: 'ป.ตรี', facultyNameTh: 'คณะวิศวกรรมศาสตร์',
    totalCredits: 140, durationYears: 4,
  },
  courses: [
    { courseCode: 'EN241100', nameTh: 'โครงสร้างข้อมูล', nameEn: 'Data Structures',
      credits: 3, category: 'MAJOR_REQUIRED',
      descriptionTh: 'ศึกษาโครงสร้างข้อมูลพื้นฐาน', learningOutcomesTh: ['เข้าใจ array'] },
  ],
  themes: [
    { name: 'Vector databases', paperCount: 12, exampleTitles: ['A survey of vector indexing'],
      yearSpan: '2019-2025', trend: 'rising', evidenceNote: 'twelve papers' },
  ],
  roster: [{ name: 'Somchai X', rank: 'ASSOC_PROF', specialization: 'databases' }],
  currentProgramSkills: ['Programming'],
  readiness: 'ok',
};

describe('program-curriculum-revision prompt', () => {
  it('is stamped v1', () => {
    expect(PROGRAM_CURRICULUM_REVISION_VERSION).toBe('program-curriculum-revision.v1');
  });

  it('parses a well-formed payload', () => {
    const parsed = ProgramCurriculumRevisionSchema.parse({
      coverageSummary: { themesTotal: 1, themesReflectedInCurriculum: 0, themesAbsent: ['Vector databases'], narrative: 'n' },
      enhanceCourses: [{
        courseCode: 'EN241100', courseNameTh: 'โครงสร้างข้อมูล',
        currentlyCoversQuote: 'ศึกษาโครงสร้างข้อมูลพื้นฐาน',
        themeRefs: ['Vector databases'], addition: 'Add vector indexing',
        additionDetail: 'A 3-hour module.', effort: 'MINOR',
        evidencePaperTitles: ['A survey of vector indexing'],
      }],
      newCourseProposals: [], promotionCandidates: [],
      confidence: 0.7, caveats: [],
    });
    expect(parsed.enhanceCourses[0]!.courseCode).toBe('EN241100');
  });

  it('defaults every list so a sparse model response still parses', () => {
    const parsed = ProgramCurriculumRevisionSchema.parse({
      coverageSummary: { themesTotal: 0, themesReflectedInCurriculum: 0, narrative: 'n' },
      confidence: 0.4,
    });
    expect(parsed.enhanceCourses).toEqual([]);
    expect(parsed.newCourseProposals).toEqual([]);
    expect(parsed.promotionCandidates).toEqual([]);
    expect(parsed.caveats).toEqual([]);
    expect(parsed.coverageSummary.themesAbsent).toEqual([]);
  });

  it('rejects an effort value outside the enum', () => {
    expect(() =>
      ProgramCurriculumRevisionSchema.parse({
        coverageSummary: { themesTotal: 0, themesReflectedInCurriculum: 0, narrative: 'n' },
        enhanceCourses: [{
          courseCode: 'X', courseNameTh: 'x', currentlyCoversQuote: 'q', themeRefs: ['t'],
          addition: 'a', additionDetail: 'd', effort: 'HUGE', evidencePaperTitles: [],
        }],
        confidence: 0.5,
      }),
    ).toThrow();
  });

  it('puts the real course list and themes into the user message', () => {
    const [system, user] = buildProgramCurriculumRevisionMessages(input);
    expect(system.role).toBe('system');
    expect(user.content).toContain('EN241100');
    expect(user.content).toContain('โครงสร้างข้อมูล');
    expect(user.content).toContain('Vector databases');
    // The roster is what makes "who could teach it" answerable.
    expect(user.content).toContain('Somchai X');
  });

  it('tells the model the course list is closed', () => {
    const [system] = buildProgramCurriculumRevisionMessages(input);
    // The code-level validator drops invented courses, but the prompt must
    // still say so — a dropped recommendation is a wasted one.
    expect(system.content).toMatch(/only.*courses listed|listed above|do not invent/i);
  });

  it('states the category basis so promotion advice is not invented', () => {
    const withUnknown: CurriculumRevisionInput = {
      ...input,
      courses: [{ ...input.courses[0]!, category: null }],
    };
    const [, user] = buildProgramCurriculumRevisionMessages(withUnknown);
    expect(user.content).toMatch(/category unknown|no category/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && npx vitest run test/program-curriculum-revision.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the prompt module**

```typescript
// packages/shared/src/ai/prompts/program-curriculum-revision.ts
import { z } from 'zod';
import type { AiMessage } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// program-curriculum-revision.v1
//
// Turns a program's demonstrated research strength into COURSE-LEVEL
// curriculum advice: which named course to extend and with what, which
// course to create where a strength has no home, and which elective
// deserves promotion to required.
//
// Supersedes nothing — it sits alongside program-research-expertise's
// programme-level `recommendations.curriculum` lane, which stays as the
// summary it already is. The gap this closes: that lane names no course
// code and cites no course content, so a department head cannot act on it.
//
// Pre-computed and persisted (ProgramCurriculumRevision), same posture as
// program-research-expertise — the Deep-Dive reads a row, it never
// generates on page load.
//
// Conformant from birth (docs/prompt-standard.md) — the conformance ratchet
// (packages/shared/test/prompt-standard-conformance.test.ts) admits no new
// allowlist entries, so this file carries every required marker from its
// first commit.
//
// GROUNDING RULES WITH TEETH — enforced in CODE, not merely requested:
// validateCurriculumRevisionPayload() (packages/db/src/
// program-curriculum-revision.ts) DROPS any item naming a courseCode absent
// from the program's real course list, and any themeRef absent from the
// input themes. The whole value of this section is that a reader can look
// up the course it names; one that cites a non-existent course is worse
// than no recommendation at all.
//
// Design spec: docs/superpowers/specs/2026-09-01-curriculum-revision-recommendation-design.md
// ─────────────────────────────────────────────────────────────────────────────

export const PROGRAM_CURRICULUM_REVISION_VERSION = 'program-curriculum-revision.v1';

const EffortEnum = z.enum(['MINOR', 'MODERATE', 'MAJOR']);

export const ProgramCurriculumRevisionSchema = z.object({
  coverageSummary: z.object({
    themesTotal: z.number().int().nonnegative(),
    themesReflectedInCurriculum: z.number().int().nonnegative(),
    /** Theme names with no course home at all. */
    themesAbsent: z.array(z.string()).default([]),
    narrative: z.string(),
  }),
  enhanceCourses: z
    .array(
      z.object({
        /** MUST be a courseCode from the input list — enforced downstream. */
        courseCode: z.string(),
        courseNameTh: z.string().default(''),
        /** Verbatim from that course's own descriptionTh. */
        currentlyCoversQuote: z.string().default(''),
        themeRefs: z.array(z.string()).default([]),
        addition: z.string(),
        additionDetail: z.string().default(''),
        effort: EffortEnum,
        evidencePaperTitles: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  newCourseProposals: z
    .array(
      z.object({
        titleTh: z.string(),
        titleEn: z.string().default(''),
        // min(1): a proposed course carrying zero credits is not a course.
        credits: z.number().int().min(1).max(30),
        placementYear: z.number().int().min(1).max(8),
        placementSemester: z.number().int().min(1).max(3),
        themeRefs: z.array(z.string()).default([]),
        rationale: z.string(),
        couldBeTaughtBy: z
          .array(z.object({ name: z.string(), rank: z.string().default('') }))
          .default([]),
        evidencePaperTitles: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  promotionCandidates: z
    .array(
      z.object({
        courseCode: z.string(),
        courseNameTh: z.string().default(''),
        currentCategory: z.string().default(''),
        proposedCategory: z.string().default(''),
        themeRefs: z.array(z.string()).default([]),
        rationale: z.string(),
      }),
    )
    .default([]),
  confidence: z.number().min(0).max(1),
  caveats: z.array(z.string()).default([]),
});
export type ProgramCurriculumRevision = z.infer<typeof ProgramCurriculumRevisionSchema>;

export interface CurriculumRevisionCourse {
  courseCode: string;
  nameTh: string;
  nameEn: string;
  credits: number | null;
  category: string | null;
  descriptionTh: string;
  learningOutcomesTh: string[];
}

export interface CurriculumRevisionTheme {
  name: string;
  paperCount: number;
  exampleTitles: string[];
  yearSpan: string;
  trend: string;
  evidenceNote: string;
}

export interface CurriculumRevisionInput {
  program: {
    code: string;
    nameTh: string;
    nameEn: string;
    levelTh: string;
    facultyNameTh: string;
    totalCredits: number | null;
    durationYears: number | null;
  };
  courses: CurriculumRevisionCourse[];
  themes: CurriculumRevisionTheme[];
  roster: Array<{ name: string; rank: string; specialization: string | null }>;
  currentProgramSkills: string[];
  readiness: 'ok' | 'thin';
}

export function buildProgramCurriculumRevisionMessages(
  input: CurriculumRevisionInput,
): AiMessage[] {
  const system = `You advise a Thai university department on how to revise one academic program's curriculum so it reflects the research its own faculty actually publish. Your output is a DRAFT for a curriculum committee to edit — never a decision, and never an accreditation submission.

HARD CONSTRAINTS:
1. **The course list is CLOSED.** Every courseCode you cite in enhanceCourses or promotionCandidates MUST appear verbatim in the COURSES block below. Do not invent, guess, or extrapolate a course code. A recommendation naming a course that does not exist is discarded before anyone reads it.
2. **Themes are closed too.** Every themeRefs entry must match a theme name from the RESEARCH THEMES block exactly.
3. **currentlyCoversQuote must be VERBATIM** from that course's own description in the COURSES block — copy the text, do not paraphrase or summarise. It is what lets a reader confirm you understood the course.
4. **You were shown paper TITLES only** — no abstracts, no findings. Never claim what a paper concluded or how it was conducted. That a paper belongs to a subject area is title-supportable; what it found is not.
5. **Do not recommend removing, retiring, or consolidating any course.** That judgement affects staff livelihoods and cannot rest on research volume.
6. **Promotion advice requires category evidence.** Only propose promoting a course whose category is given as MAJOR_ELECTIVE. When a course's category is unknown, it is not eligible — say nothing about its status.
7. **Evidence-proportional output.** With thin research, produce FEWER and more hedged recommendations, and say so in caveats. Padding a thin portfolio into a confident revision plan is the failure mode this section exists to avoid. Returning one well-grounded recommendation is a better answer than five speculative ones.

WHAT TO PRODUCE:
- coverageSummary — how many research themes are already reflected in the curriculum, which are absent entirely, and a 2-4 sentence read.
- enhanceCourses — for a specific existing course, what it covers today (verbatim quote), which research theme it does not yet reflect, and a CONCRETE addition: a topic, a module, or a revised learning outcome. Not "modernise the course".
- newCourseProposals — only where a research strength has no home in ANY existing course. Give a Thai and English title, credits, the study year and semester it belongs in, and which roster member could teach it.
- promotionCandidates — a MAJOR_ELECTIVE course strongly backed by the program's own research that merits becoming MAJOR_REQUIRED.

Write every analytical field in English. Thai appears only in data-label fields (courseNameTh, titleTh) and in currentlyCoversQuote, which is a verbatim quotation of Thai source text — a structural extraction requirement, not a language choice.

CONFIDENCE RUBRIC (report one number):
  0.90-1.00  every key input channel present and mutually consistent
  0.70-0.89  one material channel missing, or a noted inconsistency
  0.50-0.69  verdict rests on a single channel, or inputs conflict materially
  below 0.50 best effort over sparse input — flag for human review
Grade against the bands. Do not default to 0.95.

BANNED PHRASES (do not use these words/phrases or their close paraphrases anywhere in your output):
- "delve"
- "leverage" (as a verb)
- "robust"
- "landscape" (in its metaphorical sense — not literal geography)
- "tapestry"
- "furthermore"
- "moreover"
- "it is important to note"
- "in today's rapidly evolving"

Output STRICT JSON matching the schema described. No prose before or after, no markdown fences.`;

  const coursesBlock = input.courses
    .map((c) => {
      const cat = c.category ?? 'category unknown — not eligible for promotion advice';
      const outcomes = c.learningOutcomesTh.length
        ? `\n    outcomes: ${c.learningOutcomesTh.join(' / ')}`
        : '';
      return `  [${c.courseCode}] ${c.nameTh}${c.nameEn ? ` / ${c.nameEn}` : ''} (${c.credits ?? '?'} credits, ${cat})
    description: ${c.descriptionTh || '(none on file)'}${outcomes}`;
    })
    .join('\n');

  const themesBlock = input.themes
    .map(
      (t) =>
        `  - ${t.name} — ${t.paperCount} paper(s), ${t.yearSpan}, trend ${t.trend}
    examples: ${t.exampleTitles.map((x) => `"${x}"`).join('; ')}
    note: ${t.evidenceNote}`,
    )
    .join('\n');

  const rosterBlock = input.roster
    .map((r) => `  - ${r.name} (${r.rank})${r.specialization ? ` — ${r.specialization}` : ''}`)
    .join('\n');

  const user = `[PROGRAM] ${input.program.code} — ${input.program.nameTh}${input.program.nameEn ? ` / ${input.program.nameEn}` : ''}
Faculty: ${input.program.facultyNameTh} | Level: ${input.program.levelTh} | ${input.program.totalCredits ?? '?'} credits over ${input.program.durationYears ?? '?'} years
Research evidence base: ${input.readiness === 'thin' ? 'THIN — few papers; hedge accordingly and say so in caveats' : 'adequate'}

[COURSES] (${input.courses.length}) — this list is closed; cite only these codes
${coursesBlock || '  (none)'}

[RESEARCH THEMES] (${input.themes.length}) — cite only these names
${themesBlock || '  (none)'}

[FACULTY ROSTER] (${input.roster.length}) — for "who could teach it"
${rosterBlock || '  (none)'}

[SKILLS THE PROGRAM ALREADY CLAIMS TO BUILD]
${input.currentProgramSkills.length ? input.currentProgramSkills.join(', ') : '(none recorded)'}

Return the JSON.`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// CHANNEL MANIFEST
//
// Consumed:
//   - program meta (code, names, level, faculty, totalCredits, durationYears)
//   - courses[] — the program's REAL extracted course list, each with its
//     Thai description and learning outcomes. THE anchor for every
//     course-level claim; the list is closed and validated in code.
//   - themes[] — from the latest ProgramResearchExpertise payload: name,
//     paperCount, verbatim example titles, yearSpan, trend, evidenceNote.
//   - roster[] — faculty name + rank + specialization, so a new-course
//     proposal can name who would teach it.
//   - currentProgramSkills[] — what the program already claims to build.
//   - readiness — 'thin' tells the model to hedge; the runner ALSO clamps
//     confidence deterministically, so this is guidance, not the control.
//
// Deliberately omitted, with reason:
//   - Labour-market demand — that is the Gap Analyzer's argument. Blending
//     "what our researchers know" with "what employers want" would hide two
//     separate decisions inside one recommendation.
//   - Peer-institution curricula — the Benchmarking module's job.
//   - Paper abstracts/findings — not held by the platform; titles only, per
//     the same constraint program-research-expertise operates under.
//   - Student evaluation / GPA data — course *performance* is a different
//     question from course *content*, and mixing them would let a
//     well-taught course look like it needs new content, or vice versa.
// ─────────────────────────────────────────────────────────────────────────────
```

- [ ] **Step 4: Export it**

In `packages/shared/src/ai/prompts/index.ts`, add alongside the other prompt exports:

```typescript
export * from './program-curriculum-revision';
```

- [ ] **Step 5: Run tests**

Run: `cd packages/shared && npx vitest run test/program-curriculum-revision.test.ts test/prompt-standard-conformance.test.ts`
Expected: PASS — 7 prompt tests, and the ratchet accepts the new file because it carries CHANNEL MANIFEST, CONFIDENCE RUBRIC, BANNED PHRASES and an English rule.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/ai/prompts/program-curriculum-revision.ts packages/shared/src/ai/prompts/index.ts packages/shared/test/program-curriculum-revision.test.ts
git commit -m "feat(curriculum): add program-curriculum-revision.v1 prompt"
```

---

### Task 6: The anti-fabrication validator (pure)

**Files:**
- Create: `packages/db/src/program-curriculum-revision.ts`
- Test: `packages/db/test/program-curriculum-revision.test.ts`

This is the load-bearing safety mechanism. Pure function, no Prisma — the DB-touching assembler lands in Task 7 in the same file.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/db/test/program-curriculum-revision.test.ts
import { describe, it, expect } from 'vitest';
import { validateCurriculumRevisionPayload } from '../src/program-curriculum-revision';
import { CURRICULUM_REVISION_PROVENANCE_CAVEAT, type ProgramCurriculumRevision } from '@kku/shared';

const ctx = {
  validCourseCodes: new Set(['EN241100', 'EN241200']),
  categoryByCourseCode: new Map<string, string | null>([
    ['EN241100', 'MAJOR_ELECTIVE'],
    ['EN241200', 'MAJOR_REQUIRED'],
  ]),
  validThemeNames: new Set(['Vector databases', 'Graph learning']),
  descriptionByCourseCode: new Map([
    ['EN241100', 'ศึกษาโครงสร้างข้อมูลพื้นฐาน  เช่น array และ linked list'],
    ['EN241200', 'ระบบปฏิบัติการเบื้องต้น'],
  ]),
};

function payload(over: Partial<ProgramCurriculumRevision> = {}): ProgramCurriculumRevision {
  return {
    coverageSummary: { themesTotal: 2, themesReflectedInCurriculum: 1, themesAbsent: [], narrative: 'n' },
    enhanceCourses: [], newCourseProposals: [], promotionCandidates: [],
    // caveats is .min(1).refine()'d to require the provenance sentence —
    // an empty array is not a payload the schema can produce, so the
    // fixture carries the real constant rather than [].
    confidence: 0.7, caveats: [CURRICULUM_REVISION_PROVENANCE_CAVEAT], ...over,
  } as ProgramCurriculumRevision;
}

const enhance = (over: Record<string, unknown> = {}) => ({
  courseCode: 'EN241100', courseNameTh: 'โครงสร้างข้อมูล',
  currentlyCoversQuote: 'ศึกษาโครงสร้างข้อมูลพื้นฐาน',
  themeRefs: ['Vector databases'], addition: 'a', additionDetail: 'd',
  effort: 'MINOR' as const, evidencePaperTitles: [], ...over,
});

describe('validateCurriculumRevisionPayload', () => {
  it('keeps a fully valid recommendation untouched', () => {
    const { payload: out, drops } = validateCurriculumRevisionPayload(payload({ enhanceCourses: [enhance()] }), ctx);
    expect(out.enhanceCourses).toHaveLength(1);
    expect(drops.enhanceCoursesDropped).toBe(0);
  });

  it('DROPS an enhancement naming a course that does not exist', () => {
    // The core guarantee: a reader can always look up the course named.
    const { payload: out, drops } = validateCurriculumRevisionPayload(
      payload({ enhanceCourses: [enhance(), enhance({ courseCode: 'ZZ999999' })] }), ctx,
    );
    expect(out.enhanceCourses).toHaveLength(1);
    expect(out.enhanceCourses[0]!.courseCode).toBe('EN241100');
    expect(drops.enhanceCoursesDropped).toBe(1);
  });

  it('drops invalid theme refs but keeps the item when a valid ref remains', () => {
    const { payload: out, drops } = validateCurriculumRevisionPayload(
      payload({ enhanceCourses: [enhance({ themeRefs: ['Vector databases', 'Invented theme'] })] }), ctx,
    );
    expect(out.enhanceCourses[0]!.themeRefs).toEqual(['Vector databases']);
    expect(drops.themeRefsDropped).toBe(1);
  });

  it('drops the whole item when every theme ref was invented', () => {
    // An untethered recommendation has no evidence chain left.
    const { payload: out, drops } = validateCurriculumRevisionPayload(
      payload({ enhanceCourses: [enhance({ themeRefs: ['Invented'] })] }), ctx,
    );
    expect(out.enhanceCourses).toHaveLength(0);
    expect(drops.enhanceCoursesDropped).toBe(1);
  });

  it('blanks a non-verbatim quote but KEEPS the recommendation', () => {
    // A paraphrased quote is a citation defect, not necessarily bad advice.
    const { payload: out, drops } = validateCurriculumRevisionPayload(
      payload({ enhanceCourses: [enhance({ currentlyCoversQuote: 'this text is nowhere in the description' })] }), ctx,
    );
    expect(out.enhanceCourses).toHaveLength(1);
    expect(out.enhanceCourses[0]!.currentlyCoversQuote).toBe('');
    expect(drops.quotesBlanked).toBe(1);
  });

  it('accepts a verbatim quote whose whitespace differs from the source', () => {
    // The source has a double space; the model returned a single one.
    const { payload: out, drops } = validateCurriculumRevisionPayload(
      payload({ enhanceCourses: [enhance({ currentlyCoversQuote: 'ศึกษาโครงสร้างข้อมูลพื้นฐาน เช่น array' })] }), ctx,
    );
    expect(out.enhanceCourses[0]!.currentlyCoversQuote).not.toBe('');
    expect(drops.quotesBlanked).toBe(0);
  });

  it('drops a promotion candidate naming an unknown course', () => {
    const { payload: out, drops } = validateCurriculumRevisionPayload(
      payload({ promotionCandidates: [
        { courseCode: 'ZZ999999', courseNameTh: 'x', currentCategory: 'MAJOR_ELECTIVE', proposedCategory: 'MAJOR_REQUIRED', themeRefs: ['Vector databases'], rationale: 'r' },
      ] }), ctx,
    );
    expect(out.promotionCandidates).toHaveLength(0);
    expect(drops.promotionCandidatesDropped).toBe(1);
  });

  it('drops a promotion candidate for a course that is not MAJOR_ELECTIVE', () => {
    // EN241200 is MAJOR_REQUIRED — there is no promotion to make. The prompt
    // states this rule; the validator is what enforces it.
    const { payload: out, drops } = validateCurriculumRevisionPayload(
      payload({ promotionCandidates: [
        { courseCode: 'EN241200', courseNameTh: 'x', currentCategory: 'MAJOR_REQUIRED', proposedCategory: 'MAJOR_REQUIRED', themeRefs: ['Vector databases'], rationale: 'r' },
      ] }), ctx,
    );
    expect(out.promotionCandidates).toHaveLength(0);
    expect(drops.promotionsNotElective).toBe(1);
  });

  it('keeps a promotion candidate that IS MAJOR_ELECTIVE', () => {
    const { payload: out } = validateCurriculumRevisionPayload(
      payload({ promotionCandidates: [
        { courseCode: 'EN241100', courseNameTh: 'x', currentCategory: 'MAJOR_ELECTIVE', proposedCategory: 'MAJOR_REQUIRED', themeRefs: ['Vector databases'], rationale: 'r' },
      ] }), ctx,
    );
    expect(out.promotionCandidates).toHaveLength(1);
  });

  it('drops a new-course proposal whose theme refs are all invented', () => {
    const { payload: out, drops } = validateCurriculumRevisionPayload(
      payload({ newCourseProposals: [
        { titleTh: 'ก', titleEn: 'A', credits: 3, placementYear: 3, placementSemester: 1, themeRefs: ['Nope'], rationale: 'r', couldBeTaughtBy: [], evidencePaperTitles: [] },
      ] }), ctx,
    );
    expect(out.newCourseProposals).toHaveLength(0);
    expect(drops.newCourseProposalsDropped).toBe(1);
  });

  it('filters themesAbsent down to real theme names', () => {
    const { payload: out } = validateCurriculumRevisionPayload(
      payload({ coverageSummary: { themesTotal: 2, themesReflectedInCurriculum: 0, themesAbsent: ['Graph learning', 'Invented'], narrative: 'n' } }), ctx,
    );
    expect(out.coverageSummary.themesAbsent).toEqual(['Graph learning']);
  });

  it('reports zero drops for an empty payload', () => {
    const { drops } = validateCurriculumRevisionPayload(payload(), ctx);
    expect(drops).toEqual({
      enhanceCoursesDropped: 0, newCourseProposalsDropped: 0,
      promotionCandidatesDropped: 0, themeRefsDropped: 0, quotesBlanked: 0,
      promotionsNotElective: 0,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/db && npx vitest run test/program-curriculum-revision.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the validator**

```typescript
// packages/db/src/program-curriculum-revision.ts
import type { ProgramCurriculumRevision } from '@kku/shared';

// ─────────────────────────────────────────────────────────────────────────────
// Input assembly + payload validation for program-curriculum-revision.v1.
//
// The validator below is the load-bearing safety mechanism of this feature.
// The prompt ASKS the model to cite only real courses and themes; this
// ENFORCES it. The entire value of the section is that a department head
// can look up the course a recommendation names — one citing a course that
// does not exist is worse than no recommendation, because it costs the
// reader trust in everything beside it.
//
// Pure — no Prisma, no I/O — so the rules are unit-tested directly.
// assembleCurriculumRevisionInput() (Prisma) lives further down the file.
// ─────────────────────────────────────────────────────────────────────────────

export interface CurriculumRevisionValidationContext {
  /** Course codes that genuinely exist for THIS program. */
  validCourseCodes: Set<string>;
  /** courseCode → its CourseCategory (or null when the extractor could not
   *  place it). Promotion advice is only defensible for a course actually
   *  recorded as MAJOR_ELECTIVE — the prompt states that rule but nothing
   *  enforced it, so a promotion citing an already-required course would
   *  have rendered to Council. */
  categoryByCourseCode: Map<string, string | null>;
  /** Theme names from the program's own research-expertise payload. */
  validThemeNames: Set<string>;
  /** courseCode → that course's real Thai description, for quote checking. */
  descriptionByCourseCode: Map<string, string>;
}

export interface CurriculumRevisionDrops {
  enhanceCoursesDropped: number;
  newCourseProposalsDropped: number;
  promotionCandidatesDropped: number;
  themeRefsDropped: number;
  quotesBlanked: number;
  /** Subset of promotionCandidatesDropped: dropped specifically because the
   *  course is not recorded as MAJOR_ELECTIVE. Counted separately because a
   *  high rate means the model is ignoring the category rule, which is a
   *  different problem from it inventing course codes. */
  promotionsNotElective: number;
}

/** Collapse all whitespace so a verbatim quote still matches when the model
 *  normalised spacing that the PDF text happened to double up. */
function normaliseForQuoteMatch(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Strip every unfounded claim from a model payload.
 *
 * Rules:
 *   - An item naming a courseCode outside `validCourseCodes` is DROPPED.
 *   - themeRefs are filtered to `validThemeNames`; an item left with none
 *     is DROPPED (its evidence chain is gone).
 *   - `currentlyCoversQuote` that is not a substring of the course's real
 *     description is BLANKED, not dropped — a paraphrased citation is a
 *     defect in the quote, not proof the advice is wrong.
 *   - `coverageSummary.themesAbsent` is filtered to real theme names.
 *
 * Returns the cleaned payload plus counts. A nonzero drop rate is a
 * prompt-quality signal worth watching — the runner persists it.
 */
export function validateCurriculumRevisionPayload(
  raw: ProgramCurriculumRevision,
  ctx: CurriculumRevisionValidationContext,
): { payload: ProgramCurriculumRevision; drops: CurriculumRevisionDrops } {
  const drops: CurriculumRevisionDrops = {
    enhanceCoursesDropped: 0,
    newCourseProposalsDropped: 0,
    promotionCandidatesDropped: 0,
    themeRefsDropped: 0,
    quotesBlanked: 0,
    promotionsNotElective: 0,
  };

  const filterThemeRefs = (refs: string[]): string[] => {
    const kept = refs.filter((r) => ctx.validThemeNames.has(r));
    drops.themeRefsDropped += refs.length - kept.length;
    return kept;
  };

  const enhanceCourses: ProgramCurriculumRevision['enhanceCourses'] = [];
  for (const item of raw.enhanceCourses) {
    if (!ctx.validCourseCodes.has(item.courseCode)) {
      drops.enhanceCoursesDropped++;
      continue;
    }
    const themeRefs = filterThemeRefs(item.themeRefs);
    if (themeRefs.length === 0) {
      drops.enhanceCoursesDropped++;
      continue;
    }
    let quote = item.currentlyCoversQuote;
    if (quote) {
      const source = normaliseForQuoteMatch(ctx.descriptionByCourseCode.get(item.courseCode) ?? '');
      if (!source.includes(normaliseForQuoteMatch(quote))) {
        quote = '';
        drops.quotesBlanked++;
      }
    }
    enhanceCourses.push({ ...item, themeRefs, currentlyCoversQuote: quote });
  }

  const newCourseProposals: ProgramCurriculumRevision['newCourseProposals'] = [];
  for (const item of raw.newCourseProposals) {
    const themeRefs = filterThemeRefs(item.themeRefs);
    if (themeRefs.length === 0) {
      drops.newCourseProposalsDropped++;
      continue;
    }
    newCourseProposals.push({ ...item, themeRefs });
  }

  const promotionCandidates: ProgramCurriculumRevision['promotionCandidates'] = [];
  for (const item of raw.promotionCandidates) {
    if (!ctx.validCourseCodes.has(item.courseCode)) {
      drops.promotionCandidatesDropped++;
      continue;
    }
    // Promotion means elective → required. A course that is already
    // required, or whose category the extractor could not determine, has
    // no promotion to make. The prompt states this rule; this is what
    // enforces it.
    if (ctx.categoryByCourseCode.get(item.courseCode) !== 'MAJOR_ELECTIVE') {
      drops.promotionCandidatesDropped++;
      drops.promotionsNotElective++;
      continue;
    }
    const themeRefs = filterThemeRefs(item.themeRefs);
    if (themeRefs.length === 0) {
      drops.promotionCandidatesDropped++;
      continue;
    }
    promotionCandidates.push({ ...item, themeRefs });
  }

  return {
    payload: {
      ...raw,
      coverageSummary: {
        ...raw.coverageSummary,
        themesAbsent: raw.coverageSummary.themesAbsent.filter((t) => ctx.validThemeNames.has(t)),
      },
      enhanceCourses,
      newCourseProposals,
      promotionCandidates,
    },
    drops,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/db && npx vitest run test/program-curriculum-revision.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/program-curriculum-revision.ts packages/db/test/program-curriculum-revision.test.ts
git commit -m "feat(curriculum): anti-fabrication validator for curriculum-revision payloads"
```

---

### Task 7: Input assembly + readiness

**Files:**
- Modify: `packages/db/src/program-curriculum-revision.ts` (append)
- Modify: `packages/db/src/index.ts` (export)

- [ ] **Step 1: Append the assembler**

Add to the bottom of `packages/db/src/program-curriculum-revision.ts`:

```typescript
import { z } from 'zod';
import { prisma } from './index';
import {
  ProgramResearchExpertiseSchema,
  type CurriculumRevisionInput,
  type CurriculumRevisionCourse,
} from '@kku/shared';
import { normaliseCourseCode } from './course-code-normalise';

/** Why a program cannot be analysed, or how well it can be. */
export type CurriculumRevisionReadiness = 'ok' | 'thin' | 'no-research' | 'no-courses';

export interface AssembledCurriculumRevisionInput {
  input: CurriculumRevisionInput;
  readiness: CurriculumRevisionReadiness;
  /** Deterministic snapshot persisted alongside the payload so a reader can
   *  audit the basis without recomputing it. */
  stats: {
    courseCount: number;
    coursesWithDescription: number;
    coursesWithCategory: number;
    themeCount: number;
    totalDistinctPapers: number;
    rosterSize: number;
  };
}

const DigestCoursesSchema = z.object({
  courses: z
    .array(
      z.object({
        code: z.string().default(''),
        descriptionTh: z.string().default(''),
        learningOutcomesTh: z.array(z.string()).default([]),
      }),
    )
    .default([]),
});

const ExpertiseStatsSchema = z.object({ totalDistinct: z.number().int().nonnegative() });

/**
 * Assemble everything the prompt needs for one program.
 *
 * Course descriptions are recovered from the program's latest approved
 * PROGRAM_DIGEST by EXACT normalised-code match — deterministic, not fuzzy.
 * That is sound because ProgramCourse.courseCode is itself produced by
 * normalising a digest entry's code with the same helper (see
 * apps/ingestion/src/scripts/materialise-program-courses.ts), so the two
 * agree by construction.
 *
 * Returns null when the program does not exist.
 */
export async function assembleCurriculumRevisionInput(
  programId: string,
): Promise<AssembledCurriculumRevisionInput | null> {
  const program = await prisma.program.findUnique({
    where: { id: programId },
    select: {
      code: true, nameTh: true, nameEn: true, level: true,
      totalCredits: true, durationYears: true,
      faculty: { select: { nameTh: true } },
    },
  });
  if (!program) return null;

  const [programCourses, expertiseRow, digestRow, rosterRows, skillRows] = await Promise.all([
    prisma.programCourse.findMany({
      where: { programId },
      select: { courseCode: true, courseNameTh: true, courseNameEn: true, credits: true, category: true },
      orderBy: { courseCode: 'asc' },
    }),
    prisma.programResearchExpertise.findFirst({
      where: { programId },
      orderBy: { generatedAt: 'desc' },
      select: { payloadJson: true, inputStatsJson: true },
    }),
    prisma.aiExtraction.findFirst({
      where: {
        sourceEntityType: 'program', sourceEntityId: programId,
        extractionKind: 'PROGRAM_DIGEST', reviewStatus: { in: ['APPROVED', 'AUTO_APPROVED'] },
      },
      orderBy: { createdAt: 'desc' },
      select: { payloadJson: true },
    }),
    prisma.programFaculty.findMany({
      where: { programId },
      select: { facultyMember: { select: { nameEn: true, nameTh: true, rank: true, specialization: true } } },
    }),
    prisma.programSkill.findMany({
      where: { programId },
      select: { skill: { select: { nameEn: true } } },
    }),
  ]);

  const LEVEL_TH: Record<string, string> = {
    BACHELOR: 'ป.ตรี', MASTER: 'ป.โท', DOCTORAL: 'ป.เอก', HIGHER_GRAD_DIPLOMA: 'ป.บัณฑิตชั้นสูง',
  };

  // Digest descriptions, keyed by normalised code.
  const descByCode = new Map<string, { descriptionTh: string; learningOutcomesTh: string[] }>();
  if (digestRow) {
    const parsed = DigestCoursesSchema.safeParse(digestRow.payloadJson);
    if (parsed.success) {
      for (const c of parsed.data.courses) {
        const key = normaliseCourseCode(c.code);
        if (key) descByCode.set(key, { descriptionTh: c.descriptionTh, learningOutcomesTh: c.learningOutcomesTh });
      }
    }
  }

  const courses: CurriculumRevisionCourse[] = programCourses.map((pc) => {
    const d = descByCode.get(pc.courseCode);
    return {
      courseCode: pc.courseCode,
      nameTh: pc.courseNameTh ?? '',
      nameEn: pc.courseNameEn ?? '',
      credits: pc.credits,
      category: pc.category ?? null,
      descriptionTh: d?.descriptionTh ?? '',
      learningOutcomesTh: d?.learningOutcomesTh ?? [],
    };
  });

  const themes = expertiseRow
    ? ProgramResearchExpertiseSchema.parse(expertiseRow.payloadJson).themes.map((t) => ({
        name: t.name, paperCount: t.paperCount, exampleTitles: t.exampleTitles,
        yearSpan: t.yearSpan, trend: t.trend, evidenceNote: t.evidenceNote,
      }))
    : [];

  const totalDistinctPapers = expertiseRow
    ? (ExpertiseStatsSchema.safeParse(expertiseRow.inputStatsJson).data?.totalDistinct ?? 0)
    : 0;

  const roster = rosterRows.map((r) => ({
    name: r.facultyMember.nameEn || r.facultyMember.nameTh,
    rank: r.facultyMember.rank ?? '',
    specialization: r.facultyMember.specialization,
  }));

  // Readiness — computed BEFORE any AI call so the runner can skip for free.
  // THIN_PAPER_THRESHOLD (10) is the same floor program-research-expertise
  // uses; duplicating the number here rather than importing keeps @kku/db
  // free of a circular import, and the test below pins them together.
  let readiness: CurriculumRevisionReadiness;
  if (!expertiseRow || themes.length === 0) readiness = 'no-research';
  else if (courses.length === 0) readiness = 'no-courses';
  else if (totalDistinctPapers < 10) readiness = 'thin';
  else readiness = 'ok';

  return {
    readiness,
    stats: {
      courseCount: courses.length,
      coursesWithDescription: courses.filter((c) => c.descriptionTh.length > 0).length,
      coursesWithCategory: courses.filter((c) => c.category !== null).length,
      themeCount: themes.length,
      totalDistinctPapers,
      rosterSize: roster.length,
    },
    input: {
      program: {
        code: program.code, nameTh: program.nameTh, nameEn: program.nameEn ?? '',
        levelTh: LEVEL_TH[program.level] ?? program.level,
        facultyNameTh: program.faculty.nameTh,
        totalCredits: program.totalCredits, durationYears: program.durationYears,
      },
      courses,
      themes,
      roster,
      currentProgramSkills: skillRows.map((s) => s.skill.nameEn).filter(Boolean),
      // The prompt only distinguishes thin vs ok; the no-* cases never reach it.
      readiness: readiness === 'thin' ? 'thin' : 'ok',
      // The actual paper count, not just the thin/ok label. The prompt renders
      // a numeric thinness warning from it — mirroring how
      // program-research-expertise names the real total and the threshold
      // rather than telling the model "evidence is thin" and hoping.
      totalDistinctPapers,
    },
  };
}
```

- [ ] **Step 2: Add the shared course-code helper**

`normaliseCourseCode` currently lives in `apps/ingestion/src/lib/course-code.ts`, which `@kku/db` cannot import (apps don't export to packages). Create `packages/db/src/course-code-normalise.ts`:

```typescript
/**
 * Normalise a course code: strip ALL whitespace, upper-case.
 *
 * MUST stay byte-identical to normaliseCourseCode() in
 * apps/ingestion/src/lib/course-code.ts — that function produced every
 * ProgramCourse.courseCode value in the database, so a divergence here
 * would silently stop digest descriptions from matching their courses.
 * The ingestion copy cannot be imported (apps are not importable from
 * packages); the pinning test in packages/db/test asserts they agree.
 */
export function normaliseCourseCode(raw: string | null | undefined): string {
  if (!raw) return '';
  return String(raw).replace(/\s+/g, '').toUpperCase();
}
```

- [ ] **Step 3: Pin the two copies together with a test**

Append to `packages/db/test/program-curriculum-revision.test.ts`:

```typescript
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { normaliseCourseCode } from '../src/course-code-normalise';

describe('normaliseCourseCode stays in lockstep with the ingestion copy', () => {
  it('produces the same output as the ingestion implementation', () => {
    // The ingestion copy produced every ProgramCourse.courseCode in the DB.
    // If these diverge, digest descriptions silently stop matching courses.
    const ingestionSrc = readFileSync(
      path.join(__dirname, '..', '..', '..', 'apps', 'ingestion', 'src', 'lib', 'course-code.ts'),
      'utf8',
    );
    const body = /export function normaliseCourseCode[\s\S]*?\n}/.exec(ingestionSrc)?.[0];
    expect(body, 'ingestion normaliseCourseCode not found').toBeTruthy();
    expect(body).toContain(`replace(/\\s+/g, '').toUpperCase()`);
  });

  it('strips whitespace and upper-cases', () => {
    expect(normaliseCourseCode('en 241 100')).toBe('EN241100');
    expect(normaliseCourseCode(null)).toBe('');
  });
});
```

- [ ] **Step 4: Export from the package barrel**

In `packages/db/src/index.ts`, add:

```typescript
export * from './program-curriculum-revision';
export * from './course-code-normalise';
```

- [ ] **Step 5: Typecheck and test**

Run: `cd packages/db && npx tsc --noEmit && npx vitest run test/program-curriculum-revision.test.ts`
Expected: no type errors; 12 tests pass.

If `ProgramFaculty`'s relation field is not `facultyMember`, or `FacultyMember` has no `specialization`, fix the `select` to match the real schema — check with `sed -n '/^model ProgramFaculty /,/^}/p' packages/db/prisma/schema.prisma`.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/program-curriculum-revision.ts packages/db/src/course-code-normalise.ts packages/db/src/index.ts packages/db/test/program-curriculum-revision.test.ts
git commit -m "feat(curriculum): assemble curriculum-revision input with readiness"
```

---

### Task 8: `ProgramCurriculumRevision` table

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260901130000_program_curriculum_revision/migration.sql`

- [ ] **Step 1: Add the model**

In `packages/db/prisma/schema.prisma`, immediately after `model ProgramResearchExpertise`:

```prisma
/// Course-level curriculum revision advice derived from a program's
/// research expertise (program-curriculum-revision.v1).
///
/// INSERT-ONLY, exactly like ProgramResearchExpertise — re-runs accrete
/// history rather than overwriting, so a methodology bump leaves prior
/// output auditable. Readers take the latest by generatedAt.
model ProgramCurriculumRevision {
  id             String   @id @default(cuid())
  programId      String   @map("program_id")
  /// Full payload, typed at the Zod layer (ProgramCurriculumRevisionSchema),
  /// AFTER the anti-fabrication validator has stripped unfounded claims.
  payloadJson    Json     @map("payload_json")
  /// Deterministic input snapshot + the validator's drop counts, so a
  /// reader can audit the basis without recomputing it.
  inputStatsJson Json     @map("input_stats_json")
  methodVersion  String   @map("method_version")
  aiInferenceId  String?  @map("ai_inference_id")
  generatedAt    DateTime @default(now()) @map("generated_at")

  program Program @relation(fields: [programId], references: [id], onDelete: Cascade)

  @@index([programId, generatedAt])
  @@map("program_curriculum_revisions")
}
```

Add the back-relation to `model Program` (next to its existing `programResearchExpertise` relation):

```prisma
  curriculumRevisions      ProgramCurriculumRevision[]
```

(Check the exact existing back-relation field name with `grep -n "ProgramResearchExpertise\[\]" packages/db/prisma/schema.prisma` and match its style.)

- [ ] **Step 2: Write the migration**

Create `packages/db/prisma/migrations/20260901130000_program_curriculum_revision/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "program_curriculum_revisions" (
    "id" TEXT NOT NULL,
    "program_id" TEXT NOT NULL,
    "payload_json" JSONB NOT NULL,
    "input_stats_json" JSONB NOT NULL,
    "method_version" TEXT NOT NULL,
    "ai_inference_id" TEXT,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "program_curriculum_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "program_curriculum_revisions_program_id_generated_at_idx" ON "program_curriculum_revisions"("program_id", "generated_at");

-- AddForeignKey
ALTER TABLE "program_curriculum_revisions" ADD CONSTRAINT "program_curriculum_revisions_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 3: Apply**

Run: `cd packages/db && npx prisma migrate deploy && npx prisma generate`
Expected: migration applied, client regenerated.

- [ ] **Step 4: Verify Prisma can reach the model**

Run:
```bash
cd packages/db && npx tsx -e "
import { prisma } from './src/index';
(async () => {
  console.log('rows:', await prisma.programCurriculumRevision.count());
  await prisma.\$disconnect();
})();
"
```
Expected: `rows: 0`

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260901130000_program_curriculum_revision
git commit -m "feat(db): add ProgramCurriculumRevision table"
```

---

### Task 9: The runner

**Files:**
- Create: `packages/db/src/program-curriculum-revision-run.ts`
- Modify: `packages/db/src/index.ts` (export)

Mirrors `packages/db/src/program-research-expertise-run.ts` — parse-retry, banned-tell lint retry, deterministic confidence clamp, insert-only persistence — plus the validator from Task 6.

- [ ] **Step 1: Write the runner**

```typescript
// packages/db/src/program-curriculum-revision-run.ts
import {
  buildProgramCurriculumRevisionMessages,
  ProgramCurriculumRevisionSchema,
  PROGRAM_CURRICULUM_REVISION_VERSION,
  researchExpertiseConfidenceCeiling,
  lintBannedTells,
  extractStructuredWithParseRetry,
  type AiService,
} from '@kku/shared';
import { prisma } from './index';
import {
  assembleCurriculumRevisionInput,
  validateCurriculumRevisionPayload,
  type CurriculumRevisionReadiness,
  type CurriculumRevisionDrops,
} from './program-curriculum-revision';

// ─────────────────────────────────────────────────────────────────────────────
// Generates course-level curriculum-revision advice for one program.
//
// Mirrors program-research-expertise-run.ts's four post-generation
// disciplines, plus one this feature adds:
//   1. extractStructuredWithParseRetry — one corrective retry on schema failure.
//   2. lintBannedTells over free text — one corrective retry, then persist-and-warn.
//   3. Deterministic confidence clamp — REUSING
//      researchExpertiseConfidenceCeiling, deliberately not a parallel scale:
//      this advice rests on exactly the same publication evidence the research
//      section grades, so a Deep-Dive page must never show a confident
//      curriculum recommendation beneath a low-confidence research analysis
//      built from identical evidence.
//   4. NEW — validateCurriculumRevisionPayload strips any recommendation
//      naming a course or theme that does not exist.
//
// `no-research` / `no-courses` short-circuit BEFORE any AI call: a program
// with nothing to analyse should not cost a call to say so.
//
// INSERT-ONLY, like ProgramResearchExpertise — history accretes.
// ─────────────────────────────────────────────────────────────────────────────

/** Words that would turn this section into course-closure advice. The spec
 *  forbids that outright — it affects staff livelihoods and research volume
 *  is the wrong basis for it — so these force a corrective retry rather than
 *  being left to the prompt's good behaviour. */
const CLOSURE_TERMS = [
  'retire', 'retiring', 'retired',
  'consolidate', 'consolidating', 'consolidation',
  'merge', 'merging', 'merged',
  'close', 'closing', 'closure',
  'discontinue', 'discontinuing', 'discontinued',
  'suspend', 'suspending', 'suspended',
  'phase out', 'phasing out', 'phased out',
  'sunset', 'sunsetting',
] as const;

export interface RunCurriculumRevisionParams {
  programId: string;
  ai: AiService;
  triggeredByUserId?: string | null;
}

export type CurriculumRevisionOutcome =
  | {
      status: 'SUCCEEDED';
      readiness: CurriculumRevisionReadiness;
      rowId: string;
      aiInferenceId: string | null;
      confidence: number;
      confidenceClamped: boolean;
      lintRetried: boolean;
      drops: CurriculumRevisionDrops;
      enhanceCount: number;
      newCourseCount: number;
      promotionCount: number;
      tokensInput: number;
      tokensOutput: number;
      costUsd: number;
    }
  | { status: 'SKIPPED'; reason: string; readiness: CurriculumRevisionReadiness | null }
  | { status: 'FAILED'; reason: string };

/** Free-text fields the banned-tell linter inspects. */
export function buildLintableText(payload: {
  coverageSummary: { narrative: string };
  enhanceCourses: Array<{ addition: string; additionDetail: string }>;
  newCourseProposals: Array<{ rationale: string }>;
  promotionCandidates: Array<{ rationale: string }>;
  caveats: string[];
}): string {
  return [
    payload.coverageSummary.narrative,
    ...payload.enhanceCourses.flatMap((e) => [e.addition, e.additionDetail]),
    ...payload.newCourseProposals.map((n) => n.rationale),
    ...payload.promotionCandidates.map((p) => p.rationale),
    ...payload.caveats,
  ].join('\n');
}

export async function generateProgramCurriculumRevision(
  params: RunCurriculumRevisionParams,
): Promise<CurriculumRevisionOutcome> {
  const assembled = await assembleCurriculumRevisionInput(params.programId);
  if (!assembled) {
    return { status: 'SKIPPED', reason: `program not found: ${params.programId}`, readiness: null };
  }
  if (assembled.readiness === 'no-research' || assembled.readiness === 'no-courses') {
    return { status: 'SKIPPED', reason: assembled.readiness, readiness: assembled.readiness };
  }

  const messages = buildProgramCurriculumRevisionMessages(assembled.input);
  const extractionParams = {
    ctx: {
      module: 'programs',
      kind: 'program-curriculum-revision',
      userId: params.triggeredByUserId ?? null,
      traceId: `curriculum-revision-${params.programId}`,
    },
    methodVersion: PROGRAM_CURRICULUM_REVISION_VERSION,
    // Same 50000 convention as every other structured-extraction runner
    // here — thinking-mode output truncated mid-JSON at smaller budgets.
    maxOutputTokens: 50000,
  };

  let response;
  try {
    response = await extractStructuredWithParseRetry(
      params.ai,
      { ...extractionParams, messages },
      ProgramCurriculumRevisionSchema,
      'program-curriculum-revision',
    );
  } catch (err) {
    return { status: 'FAILED', reason: err instanceof Error ? err.message : String(err) };
  }

  // Banned-tell lint PLUS the course-closure policy gate — one corrective
  // retry, then persist-and-warn.
  //
  // The closure terms are enforced here rather than trusted to the prompt
  // because recommending that a course be retired/merged/closed affects
  // staff livelihoods, and research volume is the wrong basis for that
  // judgement. The spec forbids it outright, so a violation must force a
  // rewrite the same way a banned tell does. Several of these words are
  // this product's own scenario-planner intervention names, which is
  // exactly why a model steeped in the codebase might reach for them.
  let lintRetried = false;
  const lintable = buildLintableText(response.parsed);
  const closureViolations = CLOSURE_TERMS.filter((t) => new RegExp(`\\b${t}\\b`, 'i').test(lintable));
  const violations = [
    ...lintBannedTells(lintable),
    ...closureViolations.map((phrase) => ({ phrase })),
  ];
  if (violations.length > 0) {
    lintRetried = true;
    const correctionMessages = [
      ...messages,
      { role: 'assistant' as const, content: response.rawText },
      {
        role: 'user' as const,
        content: `Your draft used banned phrase(s): ${violations
          .map((v) => `"${v.phrase}"`)
          .join(', ')}. Rewrite the ENTIRE response without any of these words or their close paraphrases — keep the same structure and grounding rules. Return the corrected JSON in the same format as before.`,
      },
    ];
    try {
      const retry = await extractStructuredWithParseRetry(
        params.ai,
        { ...extractionParams, messages: correctionMessages },
        ProgramCurriculumRevisionSchema,
        'program-curriculum-revision',
      );
      const stillViolating = lintBannedTells(buildLintableText(retry.parsed));
      if (stillViolating.length > 0) {
        console.warn(
          `[program-curriculum-revision] banned-tell lint still failing after retry for program ${params.programId}: ${stillViolating.map((v) => v.phrase).join(', ')}`,
        );
      }
      response = retry;
    } catch (err) {
      console.warn(
        `[program-curriculum-revision] lint-retry failed for program ${params.programId}, keeping original: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Anti-fabrication gate — the reason this feature can be trusted.
  const { payload: validated, drops } = validateCurriculumRevisionPayload(response.parsed, {
    validCourseCodes: new Set(assembled.input.courses.map((c) => c.courseCode)),
    validThemeNames: new Set(assembled.input.themes.map((t) => t.name)),
    descriptionByCourseCode: new Map(
      assembled.input.courses.map((c) => [c.courseCode, c.descriptionTh]),
    ),
    categoryByCourseCode: new Map(
      assembled.input.courses.map((c) => [c.courseCode, c.category]),
    ),
  });
  const totalDropped =
    drops.enhanceCoursesDropped + drops.newCourseProposalsDropped + drops.promotionCandidatesDropped;
  if (totalDropped > 0) {
    console.warn(
      `[program-curriculum-revision] dropped ${totalDropped} unfounded item(s) for program ${params.programId}: ${JSON.stringify(drops)}`,
    );
  }

  // Deterministic confidence ceiling — same scale as the research section.
  const ceiling = researchExpertiseConfidenceCeiling(
    assembled.readiness === 'thin' ? 'thin' : 'ok',
    assembled.stats.totalDistinctPapers,
  );
  let confidence = validated.confidence;
  let confidenceClamped = false;
  if (confidence > ceiling) {
    confidenceClamped = true;
    console.warn(
      `[program-curriculum-revision] confidence clamped for program ${params.programId}: reported=${confidence} ceiling=${ceiling} (readiness=${assembled.readiness}, totalDistinct=${assembled.stats.totalDistinctPapers})`,
    );
    confidence = ceiling;
  }

  // themesTotal is trivially computable from the input, so do not let the
  // model report it — a Council-facing count that contradicts the evidence
  // block beside it destroys trust in the whole section. themesReflected is
  // derived the same way: total minus the themes the model (post-validation)
  // says have no course home. Both are overwritten, not merely checked.
  const themesTotal = assembled.input.themes.length;
  const themesReflectedInCurriculum = Math.max(
    0,
    themesTotal - validated.coverageSummary.themesAbsent.length,
  );

  // Persist the POST-clamp, POST-validation payload — a Council-facing
  // reader must never see a claim the runner itself rejected.
  const payload = {
    ...validated,
    coverageSummary: { ...validated.coverageSummary, themesTotal, themesReflectedInCurriculum },
    confidence,
  };

  const created = await prisma.programCurriculumRevision.create({
    data: {
      programId: params.programId,
      payloadJson: payload,
      inputStatsJson: { ...assembled.stats, drops: { ...drops } },
      methodVersion: PROGRAM_CURRICULUM_REVISION_VERSION,
      aiInferenceId: response.aiInferenceId,
    },
    select: { id: true, aiInferenceId: true },
  });

  return {
    status: 'SUCCEEDED',
    readiness: assembled.readiness,
    rowId: created.id,
    aiInferenceId: created.aiInferenceId,
    confidence,
    confidenceClamped,
    lintRetried,
    drops,
    enhanceCount: payload.enhanceCourses.length,
    newCourseCount: payload.newCourseProposals.length,
    promotionCount: payload.promotionCandidates.length,
    tokensInput: response.tokens.input,
    tokensOutput: response.tokens.output,
    costUsd: response.cost.usd,
  };
}
```

- [ ] **Step 2: Export it**

In `packages/db/src/index.ts`:

```typescript
export * from './program-curriculum-revision-run';
```

- [ ] **Step 3: Typecheck**

Run: `cd packages/db && npx tsc --noEmit`
Expected: no errors. If `lintBannedTells` or `researchExpertiseConfidenceCeiling` don't resolve from `@kku/shared`, confirm with `grep -n "lintBannedTells\|researchExpertiseConfidenceCeiling" packages/db/src/program-research-expertise-run.ts` — that file imports both from `@kku/shared` already.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/program-curriculum-revision-run.ts packages/db/src/index.ts
git commit -m "feat(curriculum): curriculum-revision runner with validation and clamp"
```

---

### Task 10: Reader + API endpoints

**Files:**
- Modify: `packages/db/src/program-curriculum-revision.ts` (append the reader)
- Modify: `apps/api/src/programs/deep-dive.controller.ts`

- [ ] **Step 1: Append the reader**

Add to the bottom of `packages/db/src/program-curriculum-revision.ts`:

```typescript
import { ProgramCurriculumRevisionSchema, type ProgramCurriculumRevision } from '@kku/shared';

export interface ProgramCurriculumRevisionResult {
  payload: ProgramCurriculumRevision;
  methodVersion: string;
  generatedAt: string;
  courseCount: number;
  coursesWithCategory: number;
}

const RevisionStatsSchema = z.object({
  courseCount: z.number().int().nonnegative().default(0),
  coursesWithCategory: z.number().int().nonnegative().default(0),
});

/** Latest persisted revision for a program, or null. INSERT-ONLY table, so
 *  this reads the most recent row rather than a unique-per-program one. */
export async function programCurriculumRevision(
  programId: string,
): Promise<ProgramCurriculumRevisionResult | null> {
  const row = await prisma.programCurriculumRevision.findFirst({
    where: { programId },
    orderBy: { generatedAt: 'desc' },
  });
  if (!row) return null;
  const stats = RevisionStatsSchema.parse(row.inputStatsJson);
  return {
    // Parsed, not cast — running the JSON back through the same schema the
    // runner validated at write time is what makes this read honest.
    payload: ProgramCurriculumRevisionSchema.parse(row.payloadJson),
    methodVersion: row.methodVersion,
    generatedAt: row.generatedAt.toISOString(),
    courseCount: stats.courseCount,
    coursesWithCategory: stats.coursesWithCategory,
  };
}

export interface CurriculumRevisionReadinessResult {
  readiness: CurriculumRevisionReadiness;
  courseCount: number;
  /** Distinct papers behind the research analysis — lets the 'thin' empty
   *  state name the actual number, the way the research section already
   *  says "Only N papers found ... below the analysis threshold (10)". */
  distinctPaperCount: number;
}

/** Cheap readiness verdict for the empty states — two counts, no AI, no
 *  input assembly. Deliberately NOT assembleCurriculumRevisionInput(),
 *  which loads courses, digests, roster and skills. */
export async function curriculumRevisionReadiness(
  programId: string,
): Promise<CurriculumRevisionReadinessResult | null> {
  const program = await prisma.program.findUnique({ where: { id: programId }, select: { id: true } });
  if (!program) return null;
  const [courseCount, expertise] = await Promise.all([
    prisma.programCourse.count({ where: { programId } }),
    prisma.programResearchExpertise.findFirst({
      where: { programId }, orderBy: { generatedAt: 'desc' }, select: { inputStatsJson: true },
    }),
  ]);
  if (!expertise) return { readiness: 'no-research', courseCount, distinctPaperCount: 0 };
  const distinctPaperCount =
    ExpertiseStatsSchema.safeParse(expertise.inputStatsJson).data?.totalDistinct ?? 0;
  if (courseCount === 0) return { readiness: 'no-courses', courseCount, distinctPaperCount };
  return {
    // Same 10-paper floor as program-research-expertise's THIN_PAPER_THRESHOLD.
    readiness: distinctPaperCount < 10 ? 'thin' : 'ok',
    courseCount,
    distinctPaperCount,
  };
}
```

- [ ] **Step 2: Add the GET endpoint**

In `apps/api/src/programs/deep-dive.controller.ts`, add to the `@kku/db` import list: `programCurriculumRevision`, `curriculumRevisionReadiness`. Add to the `@kku/shared` import list: `PROGRAM_CURRICULUM_REVISION_VERSION`.

Then add, immediately after the existing `researchExpertise()` method:

```typescript
  // Course-level curriculum-revision advice. Same three-distinct-empty-
  // reasons discipline as research-expertise above — no-research /
  // no-courses / not-yet-generated read very differently to a reader.
  // methodologyVersion comes from the prompt constant, never a literal
  // (a stale literal has already bitten this controller once).
  @Get('curriculum-revision')
  @Authorized('programs:read:all')
  @Provenance({
    sources: [
      { id: 'kku-research', name: 'KKU Publications mirror (kku-research)' },
      { id: 'program-courses', name: 'Curriculum PDF course extraction' },
      { id: 'program-faculty', name: 'Curated program faculty roster' },
    ],
    methodologyVersion: PROGRAM_CURRICULUM_REVISION_VERSION,
  })
  async curriculumRevision(@AuthSession() user: SessionUser, @Param('programId') programId: string) {
    await assertProgramAccessible(programId, user);
    const [result, readiness] = await Promise.all([
      programCurriculumRevision(programId),
      curriculumRevisionReadiness(programId),
    ]);
    if (!readiness) throw new NotFoundException();
    return { result, readiness };
  }
```

- [ ] **Step 3: Create the service that owns the AI client**

The deep-dive controller has **no** `AiService` — its constructor takes only `CockpitService` and `PdfService` (verified at `deep-dive.controller.ts:110-113`), and the existing narrative-regenerate endpoint delegates to `this.cockpit`. Follow the same shape: a thin service owns the AI client, the controller stays thin.

Create `apps/api/src/programs/curriculum-revision.service.ts`, mirroring how `CockpitService` builds its client in `onModuleInit` (`apps/api/src/cockpit/cockpit.service.ts:36-50`):

```typescript
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaAiInferenceRecorder, generateProgramCurriculumRevision } from '@kku/db';
import { createAiService, type AiService, type AiProviderId } from '@kku/shared';

// Owns the AiService for curriculum-revision regeneration. The deep-dive
// controller has no AI client of its own (it delegates narrative
// regeneration to CockpitService the same way) — building one per request
// would re-read config and re-create the provider on every call.
@Injectable()
export class CurriculumRevisionService implements OnModuleInit {
  private ai!: AiService;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    this.ai = createAiService({
      recorder: new PrismaAiInferenceRecorder(),
      providerId: (this.config.get<string>('AI_PROVIDER') ?? 'google') as AiProviderId,
      apiKeys: {
        google: this.config.get<string>('GOOGLE_AI_API_KEY'),
        anthropic: this.config.get<string>('ANTHROPIC_API_KEY'),
        openrouter: this.config.get<string>('OPENROUTER_API_KEY'),
      },
    });
  }

  async regenerate(programId: string, userId: string) {
    return generateProgramCurriculumRevision({ programId, ai: this.ai, triggeredByUserId: userId });
  }
}
```

Register it in the module that declares `DeepDiveController` — find it with `grep -rn "DeepDiveController" apps/api/src/**/*.module.ts` — adding `CurriculumRevisionService` to that module's `providers` array.

If `CockpitService`'s `createAiService` call passes additional keys (e.g. `intelSphere`), mirror those too so the two clients resolve providers identically.

- [ ] **Step 4: Add the regenerate endpoint**

Inject the service into the controller's constructor:

```typescript
  constructor(
    @Inject(CockpitService) private readonly cockpit: CockpitService,
    private readonly pdf: PdfService,
    private readonly curriculumRevision: CurriculumRevisionService,
  ) {}
```

and add, after the existing `regenerateNarrative()` method:

```typescript
  // Regenerate the curriculum-revision advice for one program. Insert-only,
  // so this accretes a new row rather than replacing — the prior version
  // stays auditable.
  @Post('curriculum-revision')
  @Authorized('programs:read:all')
  @AuditLog({ action: 'program.regenerate_curriculum_revision', entityType: 'AiInference' })
  async regenerateCurriculumRevision(
    @AuthSession() user: SessionUser,
    @Param('programId') programId: string,
  ) {
    await assertProgramAccessible(programId, user);
    return this.curriculumRevision.regenerate(programId, user.userId);
  }
```

Note the controller no longer imports `generateProgramCurriculumRevision` directly — only `programCurriculumRevision` and `curriculumRevisionReadiness` from `@kku/db`.

- [ ] **Step 5: Typecheck**

Run: `cd packages/db && npx tsc --noEmit && cd ../../apps/api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Verify the endpoint answers**

Start the API (`pnpm dev`), then:

Run: `curl -s "http://localhost:4000/api/v1/programs/<programId>/curriculum-revision" -H "Cookie: <a signed-in session cookie>" | head -40`
Expected: a `{ data: { result, readiness } }` envelope. Before Task 11 has run, `result` is `null` and `readiness.readiness` is one of `ok` / `thin` / `no-research` / `no-courses` — which is exactly what the UI's three empty states branch on.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/program-curriculum-revision.ts apps/api/src/programs/curriculum-revision.service.ts apps/api/src/programs/deep-dive.controller.ts
git commit -m "feat(api): curriculum-revision read + regenerate endpoints"
```

---

### Task 11: Bulk generation script

**Files:**
- Create: `apps/ingestion/src/scripts/generate-curriculum-revision.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the script**

```typescript
#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// Bulk (re)generate `program-curriculum-revision` for canonical programs.
//
// Structural template: generate-research-expertise.ts — dotenv load →
// resolve targets → sequential per-program try/catch → JSONL audit log →
// summary bucketed by readiness. Sequential by design: one Google-provider
// call in flight at a time, matching every other AI phase here.
//
// Skips are NOT failures: 'no-research' and 'no-courses' short-circuit
// before any AI call and are reported separately.
//
// Persistence is INSERT-ONLY, so re-running adds rows rather than
// upserting. That is intentional — prior advice stays auditable.
//
// Usage:
//   pnpm curriculum:revision-generate                      # all
//   pnpm curriculum:revision-generate --limit 5            # smoke test
//   pnpm curriculum:revision-generate --program KKU-SEQ-0030
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';

loadDotEnv(path.resolve(process.cwd(), '.env'));

function loadDotEnv(envPath: string): void {
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, 'utf8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

import { prisma, PrismaAiInferenceRecorder, generateProgramCurriculumRevision } from '@kku/db';
import { createAiService, type AiProviderId } from '@kku/shared';

const args = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
}
const PROGRAM_CODE = flag('program');
const LIMIT = (() => {
  const v = flag('limit');
  if (!v) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`--limit must be a positive integer; got ${v}`);
  return n;
})();

const LOG_DIR = path.resolve(process.cwd(), 'logs');
if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
const LOG_PATH = path.join(LOG_DIR, `curriculum-revision-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
function audit(r: Record<string, unknown>): void {
  appendFileSync(LOG_PATH, JSON.stringify({ ts: new Date().toISOString(), ...r }) + '\n', 'utf8');
}

async function main(): Promise<void> {
  console.log(`Log file: ${LOG_PATH}`);
  audit({ event: 'start', programFilter: PROGRAM_CODE, limit: LIMIT });

  const programs = await prisma.program.findMany({
    where: { sequenceNoFromSheet: { not: null }, ...(PROGRAM_CODE ? { code: PROGRAM_CODE } : {}) },
    select: { id: true, code: true, nameTh: true },
    orderBy: { code: 'asc' },
    ...(LIMIT ? { take: LIMIT } : {}),
  });
  console.log(`Candidate programmes: ${programs.length}`);
  audit({ event: 'eligible', count: programs.length });

  const ai = createAiService({
    recorder: new PrismaAiInferenceRecorder(),
    providerId: (process.env.AI_PROVIDER ?? 'google') as AiProviderId,
    apiKeys: {
      google: process.env.GOOGLE_AI_API_KEY,
      anthropic: process.env.ANTHROPIC_API_KEY,
      openrouter: process.env.OPENROUTER_API_KEY,
    },
  });

  let succeeded = 0, failed = 0, totalCost = 0, clamped = 0, lintRetried = 0, totalDropped = 0;
  const skips: Record<string, number> = {};

  for (let i = 0; i < programs.length; i++) {
    const p = programs[i]!;
    const prefix = `[${(i + 1).toString().padStart(3)}/${programs.length}] ${p.code}`;
    const startedAt = Date.now();
    let outcome;
    try {
      outcome = await generateProgramCurriculumRevision({ programId: p.id, ai });
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      console.log(`${prefix}  ✗ threw: ${message.slice(0, 150)}`);
      audit({ event: 'program', programCode: p.code, status: 'failed', errorMessage: message });
      continue;
    }
    const ms = Date.now() - startedAt;

    if (outcome.status === 'SUCCEEDED') {
      succeeded++;
      totalCost += outcome.costUsd;
      if (outcome.confidenceClamped) clamped++;
      if (outcome.lintRetried) lintRetried++;
      const dropped =
        outcome.drops.enhanceCoursesDropped +
        outcome.drops.newCourseProposalsDropped +
        outcome.drops.promotionCandidatesDropped;
      totalDropped += dropped;
      console.log(
        `${prefix}  ✓ ${(ms / 1000).toFixed(1)}s  conf=${outcome.confidence.toFixed(2)}  ` +
          `${outcome.enhanceCount} enhance / ${outcome.newCourseCount} new / ${outcome.promotionCount} promote` +
          (dropped > 0 ? `  (${dropped} dropped)` : ''),
      );
      audit({ event: 'program', programCode: p.code, status: 'success', durationMs: ms, ...outcome });
    } else if (outcome.status === 'SKIPPED') {
      skips[outcome.reason] = (skips[outcome.reason] ?? 0) + 1;
      console.log(`${prefix}  – skipped: ${outcome.reason}`);
      audit({ event: 'program', programCode: p.code, status: 'skipped', reason: outcome.reason });
    } else {
      failed++;
      console.log(`${prefix}  ✗ ${outcome.reason.slice(0, 150)}`);
      audit({ event: 'program', programCode: p.code, status: 'failed', errorMessage: outcome.reason });
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Succeeded:            ${succeeded}`);
  console.log(`Failed:               ${failed}`);
  console.log(`Skipped:              ${JSON.stringify(skips)}`);
  console.log(`Confidence clamped:   ${clamped}`);
  console.log(`Lint retried:         ${lintRetried}`);
  console.log(`Unfounded items dropped: ${totalDropped}`);
  console.log(`Total cost:           $${totalCost.toFixed(2)}`);
  audit({ event: 'end', succeeded, failed, skips, clamped, lintRetried, totalDropped, totalCost });
}

main()
  .catch((err) => {
    console.error(err);
    audit({ event: 'fatal', error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 2: Register**

In `package.json`, next to `"expertise:generate"`:

```json
    "curriculum:revision-generate": "tsx apps/ingestion/src/scripts/generate-curriculum-revision.ts",
```

- [ ] **Step 3: Smoke-test on the programme from the spec**

Run: `pnpm curriculum:revision-generate --program KKU-SEQ-0030`
Expected: one `✓` line. That programme has 1 paper per theme, so expect `conf=0.49` (the thin ceiling) and `Confidence clamped: 1` — the honest-limits behaviour working.

- [ ] **Step 4: Inspect the generated advice by hand**

Run:
```bash
cd packages/db && npx tsx -e "
import { prisma } from './src/index';
(async () => {
  const p = await prisma.program.findFirst({ where: { code: 'KKU-SEQ-0030' }, select: { id: true } });
  const row = await prisma.programCurriculumRevision.findFirst({ where: { programId: p!.id }, orderBy: { generatedAt: 'desc' } });
  console.log(JSON.stringify(row?.payloadJson, null, 2).slice(0, 2500));
  console.log('STATS:', JSON.stringify(row?.inputStatsJson));
  await prisma.\$disconnect();
})();
"
```
Expected: every `enhanceCourses[].courseCode` is a real code for that programme, each `currentlyCoversQuote` is Thai text from that course's description, and `themeRefs` match the programme's themes. This is the check that the feature does what the whole re-scope was for.

- [ ] **Step 5: Commit**

```bash
git add apps/ingestion/src/scripts/generate-curriculum-revision.ts package.json
git commit -m "feat(curriculum): bulk curriculum-revision generation script"
```

---

### Task 12: Deep-Dive UI section

**Files:**
- Modify: `apps/web/app/programs/[id]/types.ts`
- Modify: `apps/web/app/programs/[id]/page.tsx`
- Modify: `apps/web/app/programs/[id]/client.tsx`

- [ ] **Step 1: Add the response types**

Append to `apps/web/app/programs/[id]/types.ts`:

```typescript
// ─── Curriculum revision (program-curriculum-revision.v1) ───────────────

export interface DeepDiveCurriculumEnhance {
  courseCode: string;
  courseNameTh: string;
  /** Verbatim from the course's own Thai description. Empty when the model
   *  paraphrased and the validator blanked it. */
  currentlyCoversQuote: string;
  themeRefs: string[];
  addition: string;
  additionDetail: string;
  effort: 'MINOR' | 'MODERATE' | 'MAJOR';
  evidencePaperTitles: string[];
}

export interface DeepDiveCurriculumNewCourse {
  titleTh: string;
  titleEn: string;
  credits: number;
  placementYear: number;
  placementSemester: number;
  themeRefs: string[];
  rationale: string;
  couldBeTaughtBy: Array<{ name: string; rank: string }>;
  evidencePaperTitles: string[];
}

export interface DeepDiveCurriculumPromotion {
  courseCode: string;
  courseNameTh: string;
  currentCategory: string;
  proposedCategory: string;
  themeRefs: string[];
  rationale: string;
}

export interface DeepDiveCurriculumRevisionPayload {
  coverageSummary: {
    themesTotal: number;
    themesReflectedInCurriculum: number;
    themesAbsent: string[];
    narrative: string;
  };
  enhanceCourses: DeepDiveCurriculumEnhance[];
  newCourseProposals: DeepDiveCurriculumNewCourse[];
  promotionCandidates: DeepDiveCurriculumPromotion[];
  confidence: number;
  caveats: string[];
}

export interface DeepDiveCurriculumRevision {
  result: {
    payload: DeepDiveCurriculumRevisionPayload;
    methodVersion: string;
    generatedAt: string;
    courseCount: number;
    coursesWithCategory: number;
  } | null;
  readiness: {
    readiness: 'ok' | 'thin' | 'no-research' | 'no-courses';
    courseCount: number;
    distinctPaperCount: number;
  };
}
```

- [ ] **Step 2: Fetch it**

In `apps/web/app/programs/[id]/page.tsx`, add `DeepDiveCurriculumRevision` to the `./types` import list, add `curriculumRevision,` to the destructured array (immediately after `researchExpertise,`), and add the fetch to `Promise.all` in the **same position**:

```typescript
    apiFetch<DeepDiveCurriculumRevision>(`/programs/${id}/curriculum-revision`).catch(() => null),
```

**Order matters** — the destructuring array and the `Promise.all` array are positional. Place both entries directly after their `researchExpertise` counterparts.

Then pass it to the client, alongside the existing `researchExpertise={researchExpertise}`:

```tsx
        curriculumRevision={curriculumRevision}
```

- [ ] **Step 3: Render the section**

In `apps/web/app/programs/[id]/client.tsx`:

Add to the `./types` import list: `DeepDiveCurriculumRevision`.

Add to the props interface (next to `researchExpertise`):

```typescript
  curriculumRevision: DeepDiveCurriculumRevision | null;
```

Destructure it in the component signature alongside `researchExpertise`, and render it immediately after `<ResearchExpertiseSection data={researchExpertise} />`:

```tsx
      <CurriculumRevisionSection data={curriculumRevision} />
```

Then add the component near `ResearchExpertiseSection`:

```tsx
// Course-level curriculum advice derived from the programme's own research
// (program-curriculum-revision.v1). Sits BELOW the research section, whose
// three-lane strip stays as the programme-level summary it already is.
//
// A draft for a curriculum committee to edit — never a decision. Every
// course named here is guaranteed to exist: the runner drops any
// recommendation citing a course outside the programme's real course list.
function CurriculumRevisionSection({ data }: { data: DeepDiveCurriculumRevision | null }) {
  if (!data) return null;

  if (!data.result) {
    // Three distinct reasons, three distinct messages — they read very
    // differently to a reader, same discipline as the research section.
    const message =
      data.readiness.readiness === 'no-research'
        ? 'This programme has no research-expertise analysis yet, so there is nothing to derive curriculum advice from. Run pnpm expertise:generate --only <code> first.'
        : data.readiness.readiness === 'no-courses'
          ? 'No course list has been extracted for this programme, so there are no courses to advise on. Run pnpm programs:extract-courses <code>.'
          : `Not generated yet — run pnpm curriculum:revision-generate --program <code>. ${data.readiness.courseCount} course${data.readiness.courseCount === 1 ? '' : 's'} and ${data.readiness.distinctPaperCount} paper${data.readiness.distinctPaperCount === 1 ? '' : 's'} are on file for it.`;
    return (
      <Section title="Curriculum revision">
        <Card padding="md" tone="quiet">
          <p className="text-sm text-text-secondary">{message}</p>
        </Card>
      </Section>
    );
  }

  const { payload, generatedAt, methodVersion } = data.result;

  return (
    <Section
      title="Curriculum revision"
      description="Where this programme's own research strength is not yet reflected in its courses. A draft for a curriculum committee to edit, not a decision."
      actions={
        <div className="flex items-center gap-2">
          <ConfidenceBadge value={payload.confidence} />
          <FreshnessBadge timestamp={generatedAt} />
          <ProvenanceButton
            sources={[
              { id: 'kku-research', name: 'KKU Publications mirror' },
              { id: 'program-courses', name: 'Curriculum PDF course extraction' },
            ]}
            methodologyVersion={methodVersion}
          />
        </div>
      }
    >
      <Card padding="md">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="text-sm font-semibold text-text-primary">
            {payload.coverageSummary.themesReflectedInCurriculum} of {payload.coverageSummary.themesTotal} research themes
          </span>
          <span className="text-xs text-text-tertiary">reflected in the current curriculum</span>
        </div>
        <p className="mt-2 text-sm text-text-secondary">{payload.coverageSummary.narrative}</p>
        {payload.coverageSummary.themesAbsent.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1">
            <span className="text-xs text-text-tertiary">Not represented anywhere:</span>
            {payload.coverageSummary.themesAbsent.map((t) => (
              <Badge key={t} tone="warning" size="sm">{t}</Badge>
            ))}
          </div>
        )}
      </Card>

      {payload.enhanceCourses.length > 0 && (
        <div className="mt-4">
          <h4 className="mb-2 text-sm font-semibold text-text-primary">Enhance existing courses</h4>
          <div className="flex flex-col gap-3">
            {payload.enhanceCourses.map((e) => (
              <Card key={`${e.courseCode}-${e.addition}`} padding="md">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-text-tertiary">{e.courseCode}</span>
                  <span className="text-sm font-medium text-text-primary">{e.courseNameTh}</span>
                  <Badge tone="neutral" size="sm">{e.effort.toLowerCase()} effort</Badge>
                </div>
                {e.currentlyCoversQuote && (
                  <p className="mt-2 border-l-2 border-border-subtle pl-3 text-xs italic text-text-tertiary">
                    {e.currentlyCoversQuote}
                  </p>
                )}
                <p className="mt-2 text-sm font-medium text-text-primary">{e.addition}</p>
                {e.additionDetail && (
                  <p className="mt-0.5 text-sm text-text-secondary">{e.additionDetail}</p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  {e.themeRefs.map((t) => (
                    <Badge key={t} tone="neutral" size="sm">{t}</Badge>
                  ))}
                </div>
                {e.evidencePaperTitles.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-text-tertiary">
                      Evidence ({e.evidencePaperTitles.length} paper{e.evidencePaperTitles.length === 1 ? '' : 's'})
                    </summary>
                    <ul className="mt-1 flex flex-col gap-0.5">
                      {e.evidencePaperTitles.map((t) => (
                        <li key={t} className="text-xs text-text-tertiary">{t}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </Card>
            ))}
          </div>
        </div>
      )}

      {payload.newCourseProposals.length > 0 && (
        <div className="mt-4">
          <h4 className="mb-2 text-sm font-semibold text-text-primary">New course proposals</h4>
          <div className="flex flex-col gap-3">
            {payload.newCourseProposals.map((n) => (
              <Card key={n.titleTh} padding="md">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-text-primary">{n.titleTh}</span>
                  {n.titleEn && <span className="text-xs text-text-tertiary">{n.titleEn}</span>}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-text-tertiary">
                  <span className="font-tabular">{n.credits} credits</span>
                  <span className="font-tabular">Year {n.placementYear}, semester {n.placementSemester}</span>
                </div>
                <p className="mt-2 text-sm text-text-secondary">{n.rationale}</p>
                {n.couldBeTaughtBy.length > 0 && (
                  <p className="mt-2 text-xs text-text-tertiary">
                    Could be taught by: {n.couldBeTaughtBy.map((f) => `${f.name}${f.rank ? ` (${f.rank})` : ''}`).join(', ')}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  {n.themeRefs.map((t) => (
                    <Badge key={t} tone="neutral" size="sm">{t}</Badge>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {payload.promotionCandidates.length > 0 && (
        <div className="mt-4">
          <h4 className="mb-2 text-sm font-semibold text-text-primary">Promotion candidates</h4>
          <div className="flex flex-col gap-3">
            {payload.promotionCandidates.map((p) => (
              <Card key={p.courseCode} padding="md">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-text-tertiary">{p.courseCode}</span>
                  <span className="text-sm font-medium text-text-primary">{p.courseNameTh}</span>
                </div>
                <p className="mt-1 text-xs text-text-tertiary">
                  {p.currentCategory} → {p.proposedCategory}
                </p>
                <p className="mt-2 text-sm text-text-secondary">{p.rationale}</p>
              </Card>
            ))}
          </div>
        </div>
      )}

      {payload.caveats.length > 0 && (
        <Card className="mt-4" padding="sm" tone="quiet">
          <ul className="flex flex-col gap-1">
            {payload.caveats.map((c) => (
              <li key={c} className="text-xs text-text-tertiary">{c}</li>
            ))}
          </ul>
        </Card>
      )}
    </Section>
  );
}
```

Match `<Section>`'s real prop names (`title` / `description` / `actions`) and the `Badge` tone values to those already used by `ResearchExpertiseSection` in the same file — read it first and adjust if they differ.

- [ ] **Step 4: Typecheck and lint**

Run: `cd apps/web && npx tsc --noEmit && npx eslint app/programs/\[id\]/client.tsx app/programs/\[id\]/page.tsx app/programs/\[id\]/types.ts`
Expected: no errors. In particular no `no-restricted-syntax` violation — every colour above is a design token, no hex.

- [ ] **Step 5: View it**

Run `pnpm dev`, then open `http://localhost:3000/programs/<id>` for the programme generated in Task 11 Step 3.
Expected: a "Curriculum revision" section below the research section, showing the coverage summary and at least one enhance-course card naming a real course code, with a confidence badge reading 0.49 for that thin programme.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/programs/\[id\]/types.ts apps/web/app/programs/\[id\]/page.tsx apps/web/app/programs/\[id\]/client.tsx
git commit -m "feat(web): curriculum revision section in Program Deep-Dive"
```

---

### Task 13: Full run + verification

**Files:** none — operational.

- [ ] **Step 1: Generate for every programme**

Run: `nohup pnpm curriculum:revision-generate > logs/curriculum-revision-run.out 2>&1 &`
Follow: `tail -f logs/curriculum-revision-run.out`
Expected: ~251 succeed; ~50 skip as `no-research`; cost ≈ $8–13.

- [ ] **Step 2: Prove the anti-fabrication guarantee holds across the whole run**

Run:
```bash
cd packages/db && npx tsx -e "
import { prisma } from './src/index';
(async () => {
  const rows = await prisma.programCurriculumRevision.findMany({ select: { programId: true, payloadJson: true } });
  let checked = 0, bad = 0;
  for (const r of rows) {
    const codes = new Set((await prisma.programCourse.findMany({
      where: { programId: r.programId }, select: { courseCode: true },
    })).map(c => c.courseCode));
    const p: any = r.payloadJson;
    for (const item of [...(p.enhanceCourses ?? []), ...(p.promotionCandidates ?? [])]) {
      checked++;
      if (!codes.has(item.courseCode)) { bad++; console.log('FABRICATED:', r.programId, item.courseCode); }
    }
  }
  console.log({ rows: rows.length, courseCitationsChecked: checked, fabricated: bad });
  await prisma.\$disconnect();
})();
"
```
Expected: **`fabricated: 0`**. Every course cited across every persisted recommendation resolves to a real course in that same programme. This is the spec's core guarantee, asserted rather than assumed.

- [ ] **Step 3: Check the drop rate and clamp behaviour**

Run:
```bash
cd packages/db && npx tsx -e "
import { prisma } from './src/index';
(async () => {
  const rows = await prisma.programCurriculumRevision.findMany({ select: { payloadJson: true, inputStatsJson: true } });
  let dropped = 0, thin = 0, enhance = 0, news = 0, promo = 0;
  for (const r of rows) {
    const s: any = r.inputStatsJson, p: any = r.payloadJson;
    dropped += (s.drops?.enhanceCoursesDropped ?? 0) + (s.drops?.newCourseProposalsDropped ?? 0) + (s.drops?.promotionCandidatesDropped ?? 0);
    if (p.confidence <= 0.49) thin++;
    enhance += (p.enhanceCourses ?? []).length; news += (p.newCourseProposals ?? []).length; promo += (p.promotionCandidates ?? []).length;
  }
  console.log({ rows: rows.length, unfoundedItemsDropped: dropped, atOrBelowThinCeiling: thin, enhance, news, promo });
  await prisma.\$disconnect();
})();
"
```
Expected: `unfoundedItemsDropped` low relative to total items (a high rate is a prompt-quality signal to investigate, not to hide); `promo` greater than zero **only if Task 4 ran** — otherwise categories are all NULL and the promotion lane is legitimately empty.

- [ ] **Step 4: Read five programmes by hand**

Pick five programmes across different faculties and open each Deep-Dive. For each, confirm: the named courses exist in that programme's course list, the quoted text genuinely appears in the course description, the additions are concrete rather than "modernise the curriculum", and no recommendation proposes removing a course.

- [ ] **Step 5: Confirm the thin case stays honest**

Open `KKU-SEQ-0030`. Expected: confidence badge at 0.49, caveats stating the evidence is thin, and few recommendations rather than a padded list. If a one-paper-per-theme programme produces a long confident revision plan, the evidence-proportionality rule is not working and needs a prompt fix before this ships to Council users.

No commit — verification of already-committed work.

---

## Self-Review

**Spec coverage:** Component A — prompt v2 (Task 1), persistence (Task 2), materialiser (Task 3), re-run (Task 4). Component B — prompt (Task 5), anti-fabrication validator (Task 6), input assembly + readiness (Task 7), table (Task 8), runner with clamp/lint (Task 9), reader + both endpoints (Task 10), bulk script (Task 11), UI with three empty states (Task 12), verification incl. the fabrication assertion (Task 13). Spec's non-goals are respected: no retire/consolidate lane anywhere, no labour-market or peer input, no write-back to curriculum records, the existing three-lane strip untouched.

**Placeholder scan:** no TBD/TODO. Every code step carries complete file contents or exact before/after.

**Assumptions verified against the codebase after the first draft — four were wrong and are fixed above:**

| Assumption in the draft | Reality | Fix |
|---|---|---|
| `program-courses-extract` is at v1, so the bump is to **v2** | **Wrong** — the file was at **v3**, and the DB already holds real `AiExtraction` rows stamped `program-courses-extract.v2` (5), `v2.1`, `v2.2`, `v2.3` and `v1`. Stamping "v2" would fuse two different prompt behaviours under one version, which `docs/prompt-standard.md` forbids | Caught by the Task 1 implementer; bumped to **v4** throughout. Task 4's verification query updated to match |
| `program_courses` has one writer (the materialiser), so only it needs the category | **Wrong** — `program-courses-extract/run.ts` also delete-and-replaces a programme's rows. Carrying `category` in only one writer means a later single-programme re-extract silently wipes categories back to NULL, losing part of the $51 run with no error | Caught in Task 1's re-review; Task 3 Step 4 now wires both writers, plus a counter for the first-wins dedup |
| Task 4 should run `programs:materialise-program-courses` after the re-extraction to "materialise categories" | **Wrong, and destructive.** The two scripts are competing writers of `program_courses` fed by *different* sources. `programs:extract-courses` already writes categories directly; the materialiser reads `PROGRAM_DIGEST`, whose schema has **no category field**, and does an unconditional per-programme `deleteMany` + `createMany`. Running it after Step 3 would have deleted every category the ~$51 run produced | Caught in Task 3's review. Task 4 Step 4 now explicitly forbids it, and Task 3 adds a guard so the materialiser refuses to clobber v4-extracted rows |
| Controller has `this.ai` for the regenerate endpoint | **Wrong.** Its constructor takes only `CockpitService` + `PdfService` (`deep-dive.controller.ts:110-113`); narrative regeneration delegates to `this.cockpit` | Task 10 Step 3 adds `CurriculumRevisionService`, mirroring `CockpitService`'s `onModuleInit` AI construction |
| Extraction kind is `PROGRAM_COURSES` | **Wrong** — it is `PROGRAM_COURSES_EXTRACT` (`program-courses-extract/run.ts:183`) | Task 4 Step 2 query corrected |
| `programs:extract-courses` accepts `--program` and can run in bulk | **Wrong** — positional selector, **one programme per invocation**, no bulk mode | Task 4 Step 3 drives it from a shell loop over codes, with per-programme failure isolation |
| `curriculumRevisionReadiness` returning `themeCount: 0` | A hardcoded placeholder | Replaced with `distinctPaperCount`, which the `thin` empty state now names — matching how the research section already reports "Only N papers found" |
| `ProgramFaculty.facultyMember`, `FacultyMember.specialization` | **Correct** — confirmed in schema | unchanged |
| `Section` takes `title` / `description` / `actions` | **Correct** — confirmed in `packages/ui/src/layout/section.tsx:11-18` | unchanged |

**Type consistency:** `CourseCategorySchema` (Task 1) → Prisma `CourseCategory` (Task 2) → materialiser's `DigestCourseCategory` (Task 3) share one value set. `CurriculumRevisionInput`/`CurriculumRevisionCourse` (Task 5) are produced by Task 7's assembler and consumed by Task 5's builder. `ProgramCurriculumRevision` (Task 5) flows through the validator (Task 6), the runner (Task 9), the reader (Task 10) and the UI types (Task 12) unchanged. `CurriculumRevisionDrops` (Task 6) is returned by the runner (Task 9) and read by the bulk script (Task 11) and Task 13's queries. `CurriculumRevisionReadiness`'s four values (Task 7) are the same four the UI branches on (Task 12).

**Ordering:** A before B so B's first run yields promotion candidates. B builds and runs without A — the promotion lane is simply empty, which Task 13 Step 3 accounts for explicitly rather than treating as a failure.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-01-curriculum-revision-recommendation.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
