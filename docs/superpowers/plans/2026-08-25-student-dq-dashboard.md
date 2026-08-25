# Student DQ Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/education/student-dq` — a Faculty → Program drill-down over KKU's Digital Intelligence competency test with per-module columns, plus a filterable radar comparing any scope against the university mean.

**Architecture:** A `kku-dq` connector fetches the whole export in one call, resolves each student to a program **in memory**, and writes two aggregate cubes — no student rows, names or IDs are ever persisted. `packages/db` queries the cubes; a NestJS service exposes three scope-clamped endpoints; the Next.js page renders the shared `DrillDownPivot` and the shared `RadarChartSmall`.

**Tech Stack:** TypeScript strict (`noUncheckedIndexedAccess`, no `any`), Zod, Prisma/PostgreSQL, NestJS, Next.js 14 App Router, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-25-student-dq-dashboard-design.md` — read it before Task 1. The measured facts it records (pass mark exactly 70, module 13 only 57% taken, `allPassed` self-inconsistent, 59.6% program-match) are the reason several decisions below look unusual; do not "simplify" them away.

---

## Facts you will need repeatedly

- Export: `GET ${DQ_API_BASE_URL}/export/student-scores`, `Authorization: Bearer ${DQ_API_TOKEN}` → `{ items: [...], totalItems }`. 24,776 items, 13.7 MB, ~3.4 s. Env keys already exist in `.env`.
- Item shape: `{ studentId: "643020334-9", firstname, lastname, faculty, hasResult, allPassed, modules: { THEORY_MODULE_1..13, WORKSHOP_MODULE_5..8 } }`.
- **`firstname`/`lastname` must never be written to disk, logged, or returned from any endpoint.**
- `hashCitizenId(studentId)` from `@kku/shared` matches `student_program_record.student_code_hash`.
- A module score of `0` means *not taken* — see the spec.

## File structure

**Create**

| file | responsibility |
|---|---|
| `packages/shared/src/dq/modules.ts` | The module table + pure helpers (the single source of module order/labels) |
| `packages/shared/test/dq-modules.test.ts` | Unit tests for the above |
| `packages/db/prisma/migrations/20260825120000_student_dq_cubes/migration.sql` | The two cube tables |
| `packages/db/src/student-dq.ts` | Cube queries (overview / drill / radar) |
| `apps/ingestion/src/connectors/sources/kku-dq/transforms.ts` | Pure record→cube-key mapping |
| `apps/ingestion/src/connectors/sources/kku-dq/connector.ts` | fetch / transform / load |
| `apps/ingestion/src/connectors/sources/kku-dq/index.ts` | Barrel |
| `apps/ingestion/test/kku-dq/transforms.test.ts` | Transform tests over a redacted fixture |
| `apps/api/src/education/student-dq.service.ts` | Thin DI wrapper |
| `apps/api/src/education/student-dq.controller.ts` | 3 scope-clamped routes |
| `apps/web/app/education/student-dq/page.tsx` | Server component |
| `apps/web/app/education/student-dq/client.tsx` | Filters, KPIs, drill-down, radar |

**Modify** — `packages/shared/src/index.ts` · `packages/db/prisma/schema.prisma` · `packages/db/src/index.ts` · `packages/shared/src/ingestion/catalog.ts` · `apps/ingestion/src/connectors/registry.ts` · `apps/api/src/education/education.module.ts` · the Education hub page · `apps/web/app/changelog/page.tsx`.

---

## Task 1: Module table and pure helpers

**Files:** Create `packages/shared/src/dq/modules.ts`, `packages/shared/test/dq-modules.test.ts`; modify `packages/shared/src/index.ts`.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/test/dq-modules.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  DQ_MODULES,
  DQ_PASS_MARK,
  cohortFromStudentId,
  dqModuleMean,
  normaliseDqFaculty,
  theoryModules,
  workshopModules,
} from '../src/dq/modules';

describe('DQ_MODULES', () => {
  it('covers exactly the 17 keys the export returns', () => {
    expect(DQ_MODULES).toHaveLength(17);
    expect(theoryModules()).toHaveLength(13);
    expect(workshopModules()).toHaveLength(4);
  });

  it('numbers theory modules 1..13 in framework order', () => {
    expect(theoryModules().map((m) => m.no)).toEqual([1,2,3,4,5,6,7,8,9,10,11,12,13]);
  });

  it('has workshops only for the Essential Software modules 5-8', () => {
    expect(workshopModules().map((m) => m.no)).toEqual([5, 6, 7, 8]);
  });

  it('keys match the export exactly', () => {
    expect(DQ_MODULES.find((m) => m.no === 7 && m.kind === 'THEORY')?.key).toBe('THEORY_MODULE_7');
    expect(DQ_MODULES.find((m) => m.no === 7 && m.kind === 'WORKSHOP')?.key).toBe('WORKSHOP_MODULE_7');
  });

  it('leaves module 13 without a Thai name — it is not in the supplied framework', () => {
    const m13 = DQ_MODULES.find((m) => m.no === 13 && m.kind === 'THEORY');
    expect(m13?.nameEn).toBe('Generative AI');
    expect(m13?.nameTh).toBeNull();
  });

  it('gives every module a radar-safe short label', () => {
    for (const m of DQ_MODULES) {
      expect(m.shortEn.length).toBeGreaterThan(0);
      expect(m.shortEn.length).toBeLessThanOrEqual(18);
    }
  });

  it('states the pass mark measured from the source', () => {
    expect(DQ_PASS_MARK).toBe(70);
  });
});

describe('normaliseDqFaculty', () => {
  it('keeps a plain faculty name', () => {
    expect(normaliseDqFaculty('คณะวิศวกรรมศาสตร์')).toBe('คณะวิศวกรรมศาสตร์');
  });

  it('strips the breadcrumb tail', () => {
    expect(normaliseDqFaculty('คณะวิศวกรรมศาสตร์ / ปริญญาตรี ภาคปกติ / นักศึกษา')).toBe(
      'คณะวิศวกรรมศาสตร์',
    );
  });

  it('collapses internal and surrounding whitespace', () => {
    expect(normaliseDqFaculty('  คณะบริหารธุรกิจ  วิทยาเขตหนองคาย  ')).toBe(
      'คณะบริหารธุรกิจ วิทยาเขตหนองคาย',
    );
  });

  it('maps blank and missing to a single explicit bucket', () => {
    expect(normaliseDqFaculty('')).toBe('(unknown)');
    expect(normaliseDqFaculty('   ')).toBe('(unknown)');
    expect(normaliseDqFaculty(null)).toBe('(unknown)');
    expect(normaliseDqFaculty(undefined)).toBe('(unknown)');
  });
});

describe('cohortFromStudentId', () => {
  it('reads the BE admission year from the first two digits', () => {
    expect(cohortFromStudentId('643020334-9')).toBe(2564);
    expect(cohortFromStudentId('6830201119')).toBe(2568);
  });

  it('rejects an implausible year rather than inventing a cohort', () => {
    // Real export data contains ids beginning "12" and "46". A 2512
    // cohort is not a cohort; it is a bad record.
    expect(cohortFromStudentId('1230201119')).toBeNull();
    expect(cohortFromStudentId('4630201119')).toBeNull();
  });

  it('returns null for unusable ids', () => {
    expect(cohortFromStudentId('')).toBeNull();
    expect(cohortFromStudentId('x')).toBeNull();
    expect(cohortFromStudentId('6')).toBeNull();
  });
});

describe('dqModuleMean', () => {
  it('is the weighted mean of the taken scores', () => {
    expect(dqModuleMean(340, 4)).toBe(85);
  });

  it('returns null when nobody took the module — never 0', () => {
    expect(dqModuleMean(0, 0)).toBeNull();
  });

  it('rolls up correctly from parts', () => {
    // Two programs: 3 students averaging 80, 2 averaging 90.
    // The rollup must be 84, not the mean-of-means 85.
    expect(dqModuleMean(240 + 180, 3 + 2)).toBe(84);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

`pnpm --filter @kku/shared exec vitest run test/dq-modules.test.ts`
Expected: cannot resolve `../src/dq/modules`.

- [ ] **Step 3: Implement**

Create `packages/shared/src/dq/modules.ts`:

```ts
/**
 * KKU Digital Intelligence (DQ) competency framework — module table and
 * the pure helpers the dashboard, the connector and any future export
 * all share.
 *
 * Framework source: KKUDQ.pdf (LTIC) — "กรอบสมรรถนะความฉลาดทางดิจิทัล
 * สำหรับนักศึกษาระดับปริญญาตรี". That document defines modules 1-12 in
 * three domains. Module 13 (Generative AI) appears in the export but NOT
 * in the supplied revision of the framework, so it carries an English
 * label from the operator and no Thai name until the revised document
 * lands. Do not invent one.
 */

export type DqModuleKind = 'THEORY' | 'WORKSHOP';

export type DqDomain =
  | 'ESSENTIAL_COMPUTER'
  | 'ESSENTIAL_SOFTWARE'
  | 'TECHNOLOGY_AT_WORK'
  | 'GENERATIVE_AI';

export const DQ_DOMAIN_LABELS: Record<DqDomain, string> = {
  ESSENTIAL_COMPUTER: 'Essential Computer',
  ESSENTIAL_SOFTWARE: 'Essential Software',
  TECHNOLOGY_AT_WORK: 'Technology at Work',
  GENERATIVE_AI: 'Generative AI',
};

/** Measured from the source, not assumed: no `allPassed` student scores
 *  below this on any of modules 1-12. See the design doc. */
export const DQ_PASS_MARK = 70;

/** A score of 0 means the module was not taken — see the design doc.
 *  Exported so every consumer tests the same way rather than each
 *  writing `> 0` and one of them eventually writing `>= 0`. */
export function dqScoreWasTaken(score: number | null | undefined): boolean {
  return typeof score === 'number' && score > 0;
}

export interface DqModule {
  /** Exact key in the export payload, e.g. 'THEORY_MODULE_7'. */
  key: string;
  no: number;
  kind: DqModuleKind;
  nameEn: string;
  /** Null where the framework document does not define one (module 13). */
  nameTh: string | null;
  domain: DqDomain;
  /** Radar axis label — 13 axes must fit, so keep these short. */
  shortEn: string;
}

interface TheorySeed {
  no: number;
  nameEn: string;
  nameTh: string | null;
  domain: DqDomain;
  shortEn: string;
}

const THEORY_SEED: readonly TheorySeed[] = [
  { no: 1,  nameEn: 'Computer Basics',      nameTh: 'การใช้คอมพิวเตอร์พื้นฐาน',  domain: 'ESSENTIAL_COMPUTER', shortEn: 'Basics' },
  { no: 2,  nameEn: 'Internet',             nameTh: 'การใช้อินเทอร์เน็ต',        domain: 'ESSENTIAL_COMPUTER', shortEn: 'Internet' },
  { no: 3,  nameEn: 'Online Collaboration', nameTh: 'การทำงานร่วมกันแบบออนไลน์', domain: 'ESSENTIAL_COMPUTER', shortEn: 'Collaboration' },
  { no: 4,  nameEn: 'Operating System',     nameTh: 'ระบบปฏิบัติการ',            domain: 'ESSENTIAL_COMPUTER', shortEn: 'OS' },
  { no: 5,  nameEn: 'Word Processing',      nameTh: 'การใช้โปรแกรมประมวลคำ',     domain: 'ESSENTIAL_SOFTWARE', shortEn: 'Word' },
  { no: 6,  nameEn: 'Spreadsheet',          nameTh: 'การใช้โปรแกรมตารางคำนวณ',   domain: 'ESSENTIAL_SOFTWARE', shortEn: 'Spreadsheet' },
  { no: 7,  nameEn: 'Presentation',         nameTh: 'การใช้โปรแกรมการนำเสนองาน', domain: 'ESSENTIAL_SOFTWARE', shortEn: 'Presentation' },
  { no: 8,  nameEn: 'Digital Media',        nameTh: 'การสร้างสื่อดิจิทัล',         domain: 'ESSENTIAL_SOFTWARE', shortEn: 'Digital Media' },
  { no: 9,  nameEn: 'Social Media',         nameTh: 'การใช้สื่อสังคมออนไลน์',      domain: 'TECHNOLOGY_AT_WORK', shortEn: 'Social Media' },
  { no: 10, nameEn: 'Information Literacy', nameTh: 'การรู้สารสนเทศ',            domain: 'TECHNOLOGY_AT_WORK', shortEn: 'Info Literacy' },
  { no: 11, nameEn: 'Career Search Skills', nameTh: 'ทักษะการค้นหาอาชีพ',        domain: 'TECHNOLOGY_AT_WORK', shortEn: 'Career Search' },
  { no: 12, nameEn: 'Digital Footprint',    nameTh: 'ร่องรอยทางดิจิทัล',          domain: 'TECHNOLOGY_AT_WORK', shortEn: 'Footprint' },
  { no: 13, nameEn: 'Generative AI',        nameTh: null,                       domain: 'GENERATIVE_AI',      shortEn: 'Generative AI' },
];

/** Workshops exist only for the Essential Software modules — this
 *  matches the export, which carries WORKSHOP_MODULE_5..8 and no others. */
const WORKSHOP_NUMBERS = [5, 6, 7, 8] as const;

export const DQ_MODULES: readonly DqModule[] = [
  ...THEORY_SEED.map((t): DqModule => ({
    key: `THEORY_MODULE_${t.no}`,
    kind: 'THEORY',
    no: t.no,
    nameEn: t.nameEn,
    nameTh: t.nameTh,
    domain: t.domain,
    shortEn: t.shortEn,
  })),
  ...WORKSHOP_NUMBERS.map((no): DqModule => {
    const t = THEORY_SEED.find((x) => x.no === no)!;
    return {
      key: `WORKSHOP_MODULE_${no}`,
      kind: 'WORKSHOP',
      no,
      nameEn: `${t.nameEn} (workshop)`,
      nameTh: t.nameTh,
      domain: t.domain,
      shortEn: t.shortEn,
    };
  }),
];

export function theoryModules(): DqModule[] {
  return DQ_MODULES.filter((m) => m.kind === 'THEORY').sort((a, b) => a.no - b.no);
}

export function workshopModules(): DqModule[] {
  return DQ_MODULES.filter((m) => m.kind === 'WORKSHOP').sort((a, b) => a.no - b.no);
}

export function dqModuleByKey(key: string): DqModule | undefined {
  return DQ_MODULES.find((m) => m.key === key);
}

/**
 * Normalise the export's `faculty` field.
 *
 * The source mixes plain names with breadcrumb paths
 * ("คณะวิศวกรรมศาสตร์ / ปริญญาตรี ภาคปกติ / นักศึกษา"). Measured: 82 raw
 * strings collapse to 39 this way, of which 24 match Faculty.nameTh
 * exactly. Blank becomes one explicit bucket rather than an empty string
 * that renders as a nameless row.
 */
export function normaliseDqFaculty(raw: string | null | undefined): string {
  const head = (raw ?? '').split('/')[0] ?? '';
  const cleaned = head.trim().replace(/\s+/g, ' ');
  return cleaned.length > 0 ? cleaned : '(unknown)';
}

/** Plausible BE admission years. Outside this range the id is a bad
 *  record, not a cohort — the export contains ids starting "12" and "46". */
const COHORT_MIN_BE = 2540;
const COHORT_MAX_BE = 2600;

/**
 * BE admission year from a KKU student code — the first two digits.
 * `643020334-9` → 2564. Returns null when the id cannot yield a
 * plausible year, so callers group those explicitly instead of
 * inventing a 2512 cohort.
 */
export function cohortFromStudentId(studentId: string | null | undefined): number | null {
  const digits = (studentId ?? '').replace(/[^0-9]/g, '');
  if (digits.length < 2) return null;
  const year = 2500 + Number(digits.slice(0, 2));
  if (!Number.isFinite(year) || year < COHORT_MIN_BE || year > COHORT_MAX_BE) return null;
  return year;
}

/**
 * Mean score for a module from a stored sum and count.
 *
 * Cubes store `scoreSum` + `takenCount` rather than a mean precisely so
 * that a rollup across programs or faculties is a true weighted mean and
 * not a mean of means. Returns null — never 0 — when nobody took it.
 */
export function dqModuleMean(scoreSum: number, takenCount: number): number | null {
  if (takenCount <= 0) return null;
  return scoreSum / takenCount;
}
```

- [ ] **Step 4: Run the tests — expect 16 passing**

`pnpm --filter @kku/shared exec vitest run test/dq-modules.test.ts`

If a test fails, the implementation is wrong, not the test. Do not weaken a test to make it pass; if you believe one is genuinely wrong, STOP and report.

- [ ] **Step 5: Export from the barrel**

Add to `packages/shared/src/index.ts`, next to the other domain exports:

```ts
export * from './dq/modules';
```

Run `pnpm --filter @kku/shared typecheck` → expect no output.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/dq/modules.ts packages/shared/test/dq-modules.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): DQ module table + pure helpers"
```

---

## Task 2: The two cube tables

**Files:** Modify `packages/db/prisma/schema.prisma`; create `packages/db/prisma/migrations/20260825120000_student_dq_cubes/migration.sql`.

- [ ] **Step 1: Add the models**

Append to `packages/db/prisma/schema.prisma`:

```prisma
/// Aggregate cube for the Student DQ dashboard — one row per
/// (faculty × program × cohort). Deliberately aggregate-only: the DQ
/// export carries student names and ids, and NONE of them are persisted.
/// Resolution to a program happens in memory during the connector run.
///
/// No unique constraint on the dimension tuple: programId and
/// cohortYearBE are nullable, and Postgres does not enforce uniqueness
/// across NULLs. The connector replaces the whole cube per run, so
/// uniqueness is a property of the writer, not of the schema.
model DqStudentCube {
  id                 String   @id @default(cuid())
  facultyName        String   @map("faculty_name")
  /// Resolved against Faculty.nameTh; null for names we do not carry
  /// (Nong Khai campus faculties, one college, blanks).
  facultyId          String?  @map("faculty_id")
  /// Null = the explicit "Program not identified" bucket.
  programId          String?  @map("program_id")
  programName        String?  @map("program_name")
  cohortYearBE       Int?     @map("cohort_year_be")
  studentsTested     Int      @map("students_tested")
  studentsWithScores Int      @map("students_with_scores")
  /// DQ's own allPassed flag, passed through unchanged. The source is
  /// inconsistent about module 13 — see docs/superpowers/specs/
  /// 2026-08-25-student-dq-dashboard-design.md.
  studentsAllPassed  Int      @map("students_all_passed")
  ingestionRunId     String   @map("ingestion_run_id")
  createdAt          DateTime @default(now()) @map("created_at")

  @@index([facultyName])
  @@index([programId])
  @@index([ingestionRunId])
  @@map("dq_student_cube")
}

/// Per-module aggregate for the Student DQ dashboard.
/// `scoreSum` + `takenCount` rather than a stored mean: that is what
/// makes a faculty or university figure a true weighted mean instead of
/// a mean of means. A score of 0 in the source means NOT TAKEN and is
/// excluded from both columns.
model DqModuleCube {
  id              String   @id @default(cuid())
  facultyName     String   @map("faculty_name")
  facultyId       String?  @map("faculty_id")
  programId       String?  @map("program_id")
  programName     String?  @map("program_name")
  cohortYearBE    Int?     @map("cohort_year_be")
  /// Export key, e.g. 'THEORY_MODULE_7'.
  moduleKey       String   @map("module_key")
  moduleNo        Int      @map("module_no")
  /// 'THEORY' | 'WORKSHOP' — stored so the UI groups without parsing keys.
  moduleKind      String   @map("module_kind")
  /// Students in this dimension tuple who actually took the module.
  takenCount      Int      @map("taken_count")
  scoreSum        Float    @map("score_sum")
  /// Students in the tuple who had ANY scores — the coverage denominator.
  studentsInScope Int      @map("students_in_scope")
  ingestionRunId  String   @map("ingestion_run_id")
  createdAt       DateTime @default(now()) @map("created_at")

  @@index([facultyName])
  @@index([programId])
  @@index([moduleKey])
  @@index([ingestionRunId])
  @@map("dq_module_cube")
}
```

- [ ] **Step 2: Generate the migration SQL non-interactively**

This repo cannot run `prisma migrate dev` (needs a TTY). Use the documented workflow:

```bash
mkdir -p packages/db/prisma/migrations/20260825120000_student_dq_cubes
cd packages/db && npx prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script > prisma/migrations/20260825120000_student_dq_cubes/migration.sql
```

Open the generated file and confirm it contains ONLY `CREATE TABLE dq_student_cube`, `CREATE TABLE dq_module_cube` and their indexes. **If it contains any DROP or ALTER of an existing table, stop — the diff picked up unrelated drift and must not be committed.** Strip any Prisma banner comment before committing.

- [ ] **Step 3: Apply and verify**

```bash
cd packages/db && npx prisma migrate deploy && npx prisma generate
docker exec program-landscape-postgres psql -U kku -d program_landscape -c "\d dq_module_cube"
```
Expected: the table exists with the columns above.

- [ ] **Step 4: Typecheck and commit**

`pnpm --filter @kku/db typecheck` → no output.

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260825120000_student_dq_cubes
git commit -m "feat(db): DQ cube tables — aggregate-only, sum+count for correct rollups"
```

---

## Task 3: Connector transforms (pure)

**Files:** Create `apps/ingestion/src/connectors/sources/kku-dq/transforms.ts`, `apps/ingestion/test/kku-dq/transforms.test.ts`.

The transform is where a student becomes cube rows. Keeping it pure makes the PII posture testable: it takes an item and returns aggregate keys, never names.

- [ ] **Step 1: Write the failing test**

Create `apps/ingestion/test/kku-dq/transforms.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DqExportItemSchema, accumulate, emptyAccumulator } from '../../src/connectors/sources/kku-dq/transforms';

const ITEM = {
  studentId: '643020334-9',
  firstname: 'REDACTED',
  lastname: 'REDACTED',
  faculty: 'คณะวิทยาศาสตร์ / ปริญญาตรี ภาคปกติ / นักศึกษา',
  hasResult: true,
  allPassed: true,
  modules: {
    THEORY_MODULE_1: 90,
    THEORY_MODULE_13: 0, // not taken
    WORKSHOP_MODULE_5: 80,
  },
};

describe('DqExportItemSchema', () => {
  it('accepts the documented shape', () => {
    expect(DqExportItemSchema.parse(ITEM).studentId).toBe('643020334-9');
  });

  it('accepts an item with no modules object', () => {
    const parsed = DqExportItemSchema.parse({ ...ITEM, modules: undefined });
    expect(parsed.modules).toEqual({});
  });

  it('rejects an item with no studentId — it cannot be placed or counted', () => {
    expect(() => DqExportItemSchema.parse({ ...ITEM, studentId: undefined })).toThrow();
  });
});

describe('accumulate', () => {
  const dims = { facultyName: 'คณะวิทยาศาสตร์', facultyId: 'fac-1', programId: 'prog-1', programName: 'BSc CS', cohortYearBE: 2564 };

  it('counts a scored student once in the student cube', () => {
    const acc = emptyAccumulator();
    accumulate(acc, DqExportItemSchema.parse(ITEM), dims);
    const key = [...acc.students.keys()][0]!;
    expect(acc.students.get(key)).toMatchObject({
      studentsTested: 1,
      studentsWithScores: 1,
      studentsAllPassed: 1,
    });
  });

  it('excludes a zero score from the module it belongs to', () => {
    const acc = emptyAccumulator();
    accumulate(acc, DqExportItemSchema.parse(ITEM), dims);
    const m1 = [...acc.modules.values()].find((m) => m.moduleKey === 'THEORY_MODULE_1')!;
    const m13 = [...acc.modules.values()].find((m) => m.moduleKey === 'THEORY_MODULE_13')!;
    expect(m1).toMatchObject({ takenCount: 1, scoreSum: 90, studentsInScope: 1 });
    // Present in the cube (so coverage can be shown) but not counted as taken.
    expect(m13).toMatchObject({ takenCount: 0, scoreSum: 0, studentsInScope: 1 });
  });

  it('counts a student with hasResult but no scores as tested, not scored', () => {
    const acc = emptyAccumulator();
    accumulate(acc, DqExportItemSchema.parse({ ...ITEM, modules: {} }), dims);
    const s = [...acc.students.values()][0]!;
    expect(s.studentsTested).toBe(1);
    expect(s.studentsWithScores).toBe(0);
    expect(acc.modules.size).toBe(0);
  });

  it('keeps unplaced students in their faculty under a null programId', () => {
    const acc = emptyAccumulator();
    accumulate(acc, DqExportItemSchema.parse(ITEM), { ...dims, programId: null, programName: null });
    const s = [...acc.students.values()][0]!;
    expect(s.programId).toBeNull();
    expect(s.facultyName).toBe('คณะวิทยาศาสตร์');
  });

  it('aggregates two students in the same tuple into one row', () => {
    const acc = emptyAccumulator();
    accumulate(acc, DqExportItemSchema.parse(ITEM), dims);
    accumulate(acc, DqExportItemSchema.parse({ ...ITEM, studentId: '643020335-7', allPassed: false, modules: { THEORY_MODULE_1: 70 } }), dims);
    expect(acc.students.size).toBe(1);
    const s = [...acc.students.values()][0]!;
    expect(s).toMatchObject({ studentsTested: 2, studentsWithScores: 2, studentsAllPassed: 1 });
    const m1 = [...acc.modules.values()].find((m) => m.moduleKey === 'THEORY_MODULE_1')!;
    expect(m1).toMatchObject({ takenCount: 2, scoreSum: 160, studentsInScope: 2 });
  });

  it('never carries a name into the accumulator', () => {
    const acc = emptyAccumulator();
    accumulate(acc, DqExportItemSchema.parse(ITEM), dims);
    expect(JSON.stringify([...acc.students.values(), ...acc.modules.values()])).not.toContain('REDACTED');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

`pnpm --filter ingestion exec vitest run test/kku-dq/transforms.test.ts`

- [ ] **Step 3: Implement**

Create `apps/ingestion/src/connectors/sources/kku-dq/transforms.ts`:

```ts
// Pure record → cube-key mapping for the kku-dq connector.
//
// PDPA posture is enforced here by construction: the accumulator's row
// types have no name fields, so a name cannot reach the database even if
// a future edit forgets to strip it. A test asserts that.

import { z } from 'zod';
import { DQ_MODULES, dqScoreWasTaken } from '@kku/shared';

export const DqExportItemSchema = z.object({
  studentId: z.string().min(1),
  // Present in the payload; parsed so an upstream shape change is
  // visible, but deliberately never carried into a cube row.
  firstname: z.string().optional(),
  lastname: z.string().optional(),
  faculty: z.string().nullable().optional(),
  hasResult: z.boolean().default(false),
  allPassed: z.boolean().default(false),
  modules: z.record(z.string(), z.number()).optional().default({}),
});
export type DqExportItem = z.infer<typeof DqExportItemSchema>;

export const DqExportResponseSchema = z.object({
  items: z.array(z.unknown()),
  totalItems: z.number().optional(),
});

export interface CubeDims {
  facultyName: string;
  facultyId: string | null;
  programId: string | null;
  programName: string | null;
  cohortYearBE: number | null;
}

export interface StudentCubeRow extends CubeDims {
  studentsTested: number;
  studentsWithScores: number;
  studentsAllPassed: number;
}

export interface ModuleCubeRow extends CubeDims {
  moduleKey: string;
  moduleNo: number;
  moduleKind: string;
  takenCount: number;
  scoreSum: number;
  studentsInScope: number;
}

export interface DqAccumulator {
  students: Map<string, StudentCubeRow>;
  modules: Map<string, ModuleCubeRow>;
}

export function emptyAccumulator(): DqAccumulator {
  return { students: new Map(), modules: new Map() };
}

function dimKey(d: CubeDims): string {
  return [d.facultyName, d.programId ?? '', d.cohortYearBE ?? ''].join('|');
}

/**
 * Fold one export item into the accumulator.
 *
 * Counting rules, all measured from the source (see the design doc):
 *  - every item counts as TESTED, whatever its flags;
 *  - an item counts as SCORED only when it actually carries module
 *    scores — 2,772 items claim `hasResult` with an empty payload;
 *  - a module score of 0 means NOT TAKEN: the module still gets a row
 *    (so coverage is reportable) but contributes nothing to takenCount
 *    or scoreSum.
 */
export function accumulate(acc: DqAccumulator, item: DqExportItem, dims: CubeDims): void {
  const k = dimKey(dims);
  const scores = item.modules ?? {};
  const hasScores = Object.keys(scores).length > 0;

  const s = acc.students.get(k) ?? {
    ...dims,
    studentsTested: 0,
    studentsWithScores: 0,
    studentsAllPassed: 0,
  };
  s.studentsTested += 1;
  if (hasScores) s.studentsWithScores += 1;
  if (item.allPassed) s.studentsAllPassed += 1;
  acc.students.set(k, s);

  if (!hasScores) return;

  for (const mod of DQ_MODULES) {
    const raw = scores[mod.key];
    if (raw === undefined) continue;
    const mk = `${k}|${mod.key}`;
    const m = acc.modules.get(mk) ?? {
      ...dims,
      moduleKey: mod.key,
      moduleNo: mod.no,
      moduleKind: mod.kind,
      takenCount: 0,
      scoreSum: 0,
      studentsInScope: 0,
    };
    m.studentsInScope += 1;
    if (dqScoreWasTaken(raw)) {
      m.takenCount += 1;
      m.scoreSum += raw;
    }
    acc.modules.set(mk, m);
  }
}
```

- [ ] **Step 4: Run the tests — expect 10 passing**

- [ ] **Step 5: Commit**

```bash
git add apps/ingestion/src/connectors/sources/kku-dq/transforms.ts apps/ingestion/test/kku-dq/transforms.test.ts
git commit -m "feat(ingestion): kku-dq transforms — aggregate-only, zeros are not-taken"
```

---

## Task 4: The connector

**Files:** Create `apps/ingestion/src/connectors/sources/kku-dq/connector.ts`, `index.ts`; modify `packages/shared/src/ingestion/catalog.ts`, `apps/ingestion/src/connectors/registry.ts`.

- [ ] **Step 1: Add the catalog entry**

In `packages/shared/src/ingestion/catalog.ts`, next to `kku-evaluations`:

```ts
  {
    slug: 'kku-dq',
    name: 'KKU Digital Intelligence (DQ) Student Scores',
    kind: 'API',
    inputFormat: 'JSON',
    // Weekly. The whole export is one 13.7 MB response served in ~3.4 s,
    // so there is no pagination to manage — and results only move as
    // students sit the test.
    cadenceCron: '0 3 * * 1',
    ownerContact: 'KKU LTIC — Learning & Digital Support (ltic.psli@kku.ac.th)',
    notes:
      'Per-student DQ competency results (13 theory + 4 workshop modules, pass mark 70). ' +
      'Aggregated in memory to two cubes; no student names or ids are persisted. ' +
      'Powers /education/student-dq.',
    mocked: false,
  },
```

- [ ] **Step 2: Implement the connector**

Create `apps/ingestion/src/connectors/sources/kku-dq/connector.ts`:

```ts
// ────────────────────────────────────────────────────────────────────────
// KkuDqRealConnector — KKU Digital Intelligence student scores.
//
// One GET returns every student (24,776 / 13.7 MB / ~3.4 s), so there is
// no pagination. Students are resolved to a program IN MEMORY and only
// aggregates are written: the payload carries firstname/lastname and
// neither those nor the student id ever reach the database. Same
// aggregate-at-source posture as kku-hr and kku-registry.
//
// Resolution: hashCitizenId(studentId) → student_program_record
// .student_code_hash → program_id. Measured coverage is cohort-shaped
// (BE 65-68 ≈ 81-90%, BE 64 and older ≈ 7-15%) because that table is an
// AY 2568 enrolment snapshot while this export is cumulative. Unresolved
// students are NOT dropped — they land under a null programId, which the
// dashboard renders as "Program not identified".
// ────────────────────────────────────────────────────────────────────────

import { prisma } from '@kku/db';
import {
  cohortFromStudentId,
  hashCitizenId,
  normaliseDqFaculty,
  type ConnectorContext,
  type HealthStatus,
  type LoadResult,
  type NormalizedRecord,
  type RawRecord,
} from '@kku/shared';

import { ApiConnector } from '../../base/api-connector';
import { NonRetryableError } from '../../base/base-connector';
import {
  DqExportItemSchema,
  DqExportResponseSchema,
  accumulate,
  emptyAccumulator,
  type DqAccumulator,
} from './transforms';

interface RunState {
  fetched: number;
  parsed: number;
  withScores: number;
  matchedProgram: number;
  unmatchedFacultyNames: Set<string>;
  allPassedInconsistent: number;
  acc: DqAccumulator;
}

export class KkuDqRealConnector extends ApiConnector {
  readonly slug = 'kku-dq';
  readonly mocked = false;
  private runState: RunState | null = null;

  async healthCheck(): Promise<HealthStatus> {
    const token = process.env.DQ_API_TOKEN;
    if (!token) {
      return { healthy: false, message: 'DQ_API_TOKEN is not set' };
    }
    return { healthy: true };
  }

  async fetch(_ctx: ConnectorContext): Promise<RawRecord[]> {
    const base = process.env.DQ_API_BASE_URL;
    const token = process.env.DQ_API_TOKEN;
    if (!base || !token) {
      throw new NonRetryableError('DQ_API_BASE_URL / DQ_API_TOKEN not configured');
    }
    const timeout = Number(process.env.DQ_API_REQUEST_TIMEOUT_MS) || 120_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    let payload: unknown;
    try {
      const res = await global.fetch(`${base}/export/student-scores`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (res.status === 401 || res.status === 403) {
        // A rejected token is a configuration fix, not a transient blip —
        // do not burn BullMQ retries on it.
        throw new NonRetryableError(`DQ export rejected the token (HTTP ${res.status})`);
      }
      if (!res.ok) throw new Error(`DQ export failed: HTTP ${res.status}`);
      payload = await res.json();
    } finally {
      clearTimeout(timer);
    }

    const envelope = DqExportResponseSchema.parse(payload);
    this.runState = {
      fetched: envelope.items.length,
      parsed: 0,
      withScores: 0,
      matchedProgram: 0,
      unmatchedFacultyNames: new Set(),
      allPassedInconsistent: 0,
      acc: emptyAccumulator(),
    };

    // Resolve every student in one pass, then discard the raw payload.
    // Batch the hash lookups rather than querying per student: 24,776
    // round-trips would dominate the run.
    const items = envelope.items
      .map((raw) => DqExportItemSchema.safeParse(raw))
      .filter((r): r is { success: true; data: ReturnType<typeof DqExportItemSchema.parse> } => r.success)
      .map((r) => r.data);
    this.runState.parsed = items.length;

    const hashes = items.map((i) => hashCitizenId(i.studentId)).filter((h): h is string => h !== null);
    const records = await prisma.studentProgramRecord.findMany({
      where: { studentCodeHash: { in: hashes }, programId: { not: null } },
      select: { studentCodeHash: true, programId: true },
    });
    const byHash = new Map(records.map((r) => [r.studentCodeHash ?? '', r.programId]));

    const programs = await prisma.program.findMany({
      select: { id: true, nameTh: true, nameEn: true, facultyId: true },
    });
    const programById = new Map(programs.map((p) => [p.id, p]));
    const faculties = await prisma.faculty.findMany({ select: { id: true, nameTh: true } });
    const facultyIdByName = new Map(faculties.map((f) => [f.nameTh, f.id]));

    for (const item of items) {
      const facultyName = normaliseDqFaculty(item.faculty);
      const facultyId = facultyIdByName.get(facultyName) ?? null;
      if (!facultyId) this.runState.unmatchedFacultyNames.add(facultyName);

      const hash = hashCitizenId(item.studentId);
      const programId = hash ? (byHash.get(hash) ?? null) : null;
      if (programId) this.runState.matchedProgram += 1;
      const program = programId ? programById.get(programId) : undefined;

      if (Object.keys(item.modules ?? {}).length > 0) this.runState.withScores += 1;
      // Track the source's self-contradiction so the dashboard can state
      // its size instead of the reader discovering it.
      const m13 = item.modules?.THEORY_MODULE_13;
      if (item.allPassed && typeof m13 === 'number' && m13 > 0 && m13 < 70) {
        this.runState.allPassedInconsistent += 1;
      }

      accumulate(this.runState.acc, item, {
        facultyName,
        facultyId,
        programId,
        programName: program ? program.nameTh : null,
        cohortYearBE: cohortFromStudentId(item.studentId),
      });
    }

    // The accumulator IS the payload from here on. Returning a single
    // marker record keeps the framework's fetch → transform → load shape
    // without building a second 24,776-element array (the double-buffer
    // that froze the evaluations worker).
    return [{ externalId: 'kku-dq-batch', data: {}, sourceTimestamp: new Date() }];
  }

  async transform(_ctx: ConnectorContext, _raw: RawRecord): Promise<NormalizedRecord[]> {
    return [{ externalId: 'kku-dq-batch', payload: {} }];
  }

  async load(ctx: ConnectorContext, _normalized: NormalizedRecord[]): Promise<LoadResult> {
    const state = this.runState;
    if (!state) throw new NonRetryableError('load() called before fetch()');
    const runId = ctx.ingestionRunId;

    const students = [...state.acc.students.values()].map((r) => ({ ...r, ingestionRunId: runId }));
    const modules = [...state.acc.modules.values()].map((r) => ({ ...r, ingestionRunId: runId }));

    // Replace wholesale in one transaction: the cube is a snapshot, and a
    // half-replaced cube would read as a real collapse in student numbers.
    await prisma.$transaction([
      prisma.dqStudentCube.deleteMany({}),
      prisma.dqModuleCube.deleteMany({}),
      prisma.dqStudentCube.createMany({ data: students }),
      prisma.dqModuleCube.createMany({ data: modules }),
    ]);

    ctx.setMetadata?.({
      fetched: state.fetched,
      parsed: state.parsed,
      withScores: state.withScores,
      matchedProgram: state.matchedProgram,
      matchRatePct: state.parsed > 0 ? Math.round((1000 * state.matchedProgram) / state.parsed) / 10 : 0,
      unmatchedFacultyNames: [...state.unmatchedFacultyNames].slice(0, 50),
      allPassedInconsistent: state.allPassedInconsistent,
      studentCubeRows: students.length,
      moduleCubeRows: modules.length,
    });

    this.runState = null;
    return { recordsLoaded: students.length + modules.length, recordsFailed: 0 };
  }
}
```

**Before writing this verbatim, verify three things against the codebase and adapt if they differ — do not invent APIs:**
1. `ConnectorContext` — does it expose `ingestionRunId` and a metadata setter, and under what names? Read `packages/shared/src/ingestion/types.ts` and a real connector's `load()`.
2. `HealthStatus` — the exact shape returned by other connectors' `healthCheck`.
3. `hashCitizenId` — confirm it is exported from `@kku/shared`'s barrel.

Report any adaptation you had to make.

- [ ] **Step 3: Register it**

`apps/ingestion/src/connectors/sources/kku-dq/index.ts`:
```ts
export { KkuDqRealConnector } from './connector';
```

In `apps/ingestion/src/connectors/registry.ts`, import it and add an entry. The registry's `ConnectorEntry` expects a `mock` factory; this source has no mock (it is real from day one), so follow whatever the registry does for other real-only sources — if every entry requires `mock`, add a minimal mock class returning zero records rather than weakening the registry type, and say so in your report.

- [ ] **Step 4: Seed the data source and run it live**

```bash
pnpm db:seed                      # picks up the new catalog entry
pnpm connector:run kku-dq
```

Expected on the current dataset — report your actual numbers:
```
fetched 24776 · parsed 24776 · withScores 19601 · matchedProgram 14765 (59.6%)
```

Then verify the cube reconciles:
```bash
docker exec program-landscape-postgres psql -U kku -d program_landscape -c "
SELECT SUM(students_tested) AS tested, SUM(students_with_scores) AS scored,
       SUM(students_all_passed) AS passed, COUNT(*) AS rows FROM dq_student_cube;
SELECT COUNT(*) AS module_rows, COUNT(DISTINCT module_key) AS modules FROM dq_module_cube;
SELECT ROUND((SUM(score_sum)/NULLIF(SUM(taken_count),0))::numeric,2) AS mean_m13,
       SUM(taken_count) AS taken, SUM(students_in_scope) AS in_scope
FROM dq_module_cube WHERE module_key='THEORY_MODULE_13';"
```
`tested` must equal 24,776 and `scored` 19,601. `modules` must be 17. Module 13's mean must land near **70**, not near 40 — if it is ~40 the zeros are being counted and the transform is wrong.

**Confirm no PII landed:**
```bash
docker exec program-landscape-postgres psql -U kku -d program_landscape -c "\d dq_student_cube" | grep -ci "name\|student_id"
```
Only `faculty_name` / `program_name` columns may match; there must be no student-name or id column.

- [ ] **Step 5: Commit**

```bash
git add apps/ingestion/src/connectors/sources/kku-dq packages/shared/src/ingestion/catalog.ts apps/ingestion/src/connectors/registry.ts
git commit -m "feat(ingestion): kku-dq connector — DQ scores to aggregate cubes"
```

---

## Task 5: Cube queries

**Files:** Create `packages/db/src/student-dq.ts`; modify `packages/db/src/index.ts`.

- [ ] **Step 1: Implement**

```ts
/**
 * Queries over the Student DQ cubes.
 *
 * Every mean is computed as SUM(score_sum) / SUM(taken_count) at the
 * level being displayed — never an average of child means. Modules with
 * no takers return null, never 0: on this dashboard an empty module is
 * a rollout gap, not a competency failure.
 */
import { Prisma } from '@prisma/client';
import { prisma } from './index';

export const STUDENT_DQ_METHODOLOGY_VERSION = 'student-dq.v1';

export interface DqFilter {
  /** Thai faculty names as they appear in the cube. */
  facultyName?: string[];
  cohortYearBE?: number[];
}

export interface DqModuleCell {
  moduleKey: string;
  moduleNo: number;
  moduleKind: string;
  mean: number | null;
  takenCount: number;
  studentsInScope: number;
  /** Share of in-scope students who actually took it, 0-100. */
  coveragePct: number | null;
}

export interface DqDrillRow {
  facultyName: string;
  facultyId: string | null;
  programId: string | null;
  programName: string | null;
  studentsTested: number;
  studentsWithScores: number;
  studentsAllPassed: number;
  overallMean: number | null;
  modules: DqModuleCell[];
}

export interface DqOverview {
  methodologyVersion: string;
  studentsTested: number;
  studentsWithScores: number;
  studentsAllPassed: number;
  facultyCount: number;
  programsResolved: number;
  studentsUnplaced: number;
  modules: DqModuleCell[];
  refreshedAt: Date | null;
  /** From the connector run's metadata — see the coverage panel. */
  coverage: {
    fetched: number;
    withScores: number;
    matchRatePct: number;
    unmatchedFacultyNames: string[];
    allPassedInconsistent: number;
  } | null;
}
```

Then the three functions. `dqDrill` is the load-bearing one — write it exactly like this:

```ts
/** Fresh per call site. Never hoist into a shared const: this repo has a
 *  production incident on reusing one Prisma.Sql across $queryRaw calls
 *  (intermittent `syntax error at or near "$1"`) — see the comment at
 *  packages/db/src/dashboard-overview.ts:184-189. */
function dqWhere(f: DqFilter | undefined, alias: string): Prisma.Sql {
  const col = Prisma.raw(alias); // trusted literal, never user input
  const parts: Prisma.Sql[] = [];
  if (f?.facultyName && f.facultyName.length > 0) {
    parts.push(Prisma.sql`${col}.faculty_name = ANY(${f.facultyName}::text[])`);
  }
  if (f?.cohortYearBE && f.cohortYearBE.length > 0) {
    parts.push(Prisma.sql`${col}.cohort_year_be = ANY(${f.cohortYearBE}::int[])`);
  }
  return parts.length === 0
    ? Prisma.empty
    : Prisma.sql`AND ${Prisma.join(parts, ' AND ')}`;
}

export async function dqDrill(
  filter?: DqFilter,
): Promise<{ methodologyVersion: string; rows: DqDrillRow[] }> {
  // Two grouped scans — students and modules — folded together in TS.
  // Grouping collapses the cohort dimension, which is a filter here, not
  // a display level.
  const students = await prisma.$queryRaw<
    Array<{
      faculty_name: string;
      faculty_id: string | null;
      program_id: string | null;
      program_name: string | null;
      tested: bigint;
      scored: bigint;
      passed: bigint;
    }>
  >`
    SELECT s.faculty_name, MAX(s.faculty_id) AS faculty_id, s.program_id,
           MAX(s.program_name) AS program_name,
           SUM(s.students_tested)::bigint      AS tested,
           SUM(s.students_with_scores)::bigint AS scored,
           SUM(s.students_all_passed)::bigint  AS passed
    FROM dq_student_cube s
    WHERE true ${dqWhere(filter, 's')}
    GROUP BY s.faculty_name, s.program_id
    ORDER BY s.faculty_name
  `;

  const modules = await prisma.$queryRaw<
    Array<{
      faculty_name: string;
      program_id: string | null;
      module_key: string;
      module_no: number;
      module_kind: string;
      taken: bigint;
      score_sum: number;
      in_scope: bigint;
    }>
  >`
    SELECT m.faculty_name, m.program_id, m.module_key, m.module_no, m.module_kind,
           SUM(m.taken_count)::bigint       AS taken,
           SUM(m.score_sum)::float          AS score_sum,
           SUM(m.students_in_scope)::bigint AS in_scope
    FROM dq_module_cube m
    WHERE true ${dqWhere(filter, 'm')}
    GROUP BY m.faculty_name, m.program_id, m.module_key, m.module_no, m.module_kind
  `;

  const key = (facultyName: string, programId: string | null): string =>
    `${facultyName}|${programId ?? ''}`;

  const cells = new Map<string, DqModuleCell[]>();
  for (const r of modules) {
    const k = key(r.faculty_name, r.program_id);
    const list = cells.get(k) ?? [];
    const taken = Number(r.taken);
    const inScope = Number(r.in_scope);
    list.push({
      moduleKey: r.module_key,
      moduleNo: r.module_no,
      moduleKind: r.module_kind,
      // Weighted mean at THIS level — never an average of child means.
      mean: dqModuleMean(r.score_sum, taken),
      takenCount: taken,
      studentsInScope: inScope,
      coveragePct: inScope > 0 ? (100 * taken) / inScope : null,
    });
    cells.set(k, list);
  }

  const rows: DqDrillRow[] = students.map((s) => {
    const mods = (cells.get(key(s.faculty_name, s.program_id)) ?? []).sort(
      (a, b) => a.moduleNo - b.moduleNo,
    );
    // Overall = one weighted mean across every THEORY module, rebuilt
    // from sums so it matches the per-module figures beside it.
    const theory = mods.filter((m) => m.moduleKind === 'THEORY');
    const takenTotal = theory.reduce((a, m) => a + m.takenCount, 0);
    const sumTotal = theory.reduce((a, m) => a + (m.mean ?? 0) * m.takenCount, 0);
    return {
      facultyName: s.faculty_name,
      facultyId: s.faculty_id,
      programId: s.program_id,
      programName: s.program_name,
      studentsTested: Number(s.tested),
      studentsWithScores: Number(s.scored),
      studentsAllPassed: Number(s.passed),
      overallMean: dqModuleMean(sumTotal, takenTotal),
      modules: mods,
    };
  });

  return { methodologyVersion: STUDENT_DQ_METHODOLOGY_VERSION, rows };
}
```

`dqOverview(filter)` is the same two scans without the `GROUP BY` dimensions, plus
`refreshedAt` and `coverage` read from the most recent SUCCEEDED `IngestionRun` for
`data_sources.slug = 'kku-dq'` — so the page never recomputes what the connector already
measured.

`dqRadar` takes an explicit scope and returns both series in one call:

```ts
export interface DqRadarScope {
  facultyName?: string;
  programId?: string;
  cohortYearBE?: number[];
  kind: 'THEORY' | 'WORKSHOP';
}

export interface DqRadarResult {
  methodologyVersion: string;
  scopeLabel: string;
  /** Ordered by moduleNo — the framework's order, not the cube's. */
  scope: DqModuleCell[];
  /** Same modules, same order, computed over every faculty. */
  university: DqModuleCell[];
}

export async function dqRadar(scope: DqRadarScope): Promise<DqRadarResult>;
```

Implement it as two runs of the module scan — one filtered to the scope, one unfiltered —
folded through the same `DqModuleCell` mapping, then reindexed against `DQ_MODULES` of the
requested `kind` so both arrays align by index (which is what `RadarChartSmall`'s
`comparisons` requires) and a module absent from the cube appears as a `null` axis rather
than being dropped from one series and not the other.

- [ ] **Step 2: Verify against the live cube**

Write a scratch script under the scratchpad (not the repo) that calls all three and prints: overall student totals, the faculty count, module 13's mean and coverage, and the top 3 faculties by tested count. Expected: totals match Task 4's SQL exactly, module 13 mean ≈ 70 with coverage ≈ 57%. Delete the script afterwards.

- [ ] **Step 3: Export and commit**

Add `export * from './student-dq';` to `packages/db/src/index.ts`, run `pnpm --filter @kku/db typecheck`, commit:
`feat(db): Student DQ cube queries`

---

## Task 6: API service and controller

**Files:** Create `apps/api/src/education/student-dq.{service,controller}.ts`; modify `apps/api/src/education/education.module.ts`.

- [ ] **Step 1: Service** — a thin DI wrapper over the three `@kku/db` functions, exposing `methodologyVersion`, in the shape of `apps/api/src/education/evaluations.service.ts`.

- [ ] **Step 2: Controller**

```ts
import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import type { SessionUser } from '@kku/shared';
import {
  AuthSession,
  Authorized,
  ZodValidationPipe,
  assertCanSeeFacultyDashboards,
  clampFacultyNameFilter,
} from '../common';
import { StudentDqService } from './student-dq.service';

// Express coerces query strings differently for single vs repeated
// params; normalise both shapes at the schema layer (same helper shape
// as staff-evaluations.controller.ts).
const StringArray = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v): string[] => {
    if (v === undefined) return [];
    if (Array.isArray(v)) return v.filter((x) => x.length > 0);
    return v.length > 0 ? [v] : [];
  });
const NumberArray = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v): number[] => {
    const arr = v === undefined ? [] : Array.isArray(v) ? v : [v];
    return arr.map(Number).filter(Number.isFinite);
  });

const DqQuerySchema = z.object({ facultyName: StringArray, cohortYearBE: NumberArray });
type DqQuery = z.infer<typeof DqQuerySchema>;

const RadarQuerySchema = DqQuerySchema.extend({
  programId: z.string().optional(),
  kind: z.enum(['THEORY', 'WORKSHOP']).default('THEORY'),
});
type RadarQuery = z.infer<typeof RadarQuerySchema>;

// /education/student-dq — KKU Digital Intelligence competency results.
// Scope clamping matches the sibling education endpoints exactly: a
// FACULTY_USER sees their faculty, and a user whose grants resolve to
// nothing gets an empty result via the sentinel, never the university.
@Controller('/education/student-dq')
export class StudentDqController {
  constructor(private readonly dq: StudentDqService) {}

  @Get('overview')
  @Authorized('institution:read:dashboard')
  async overview(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(DqQuerySchema)) q: DqQuery,
  ) {
    await assertCanSeeFacultyDashboards(user);
    const clamped = await clampFacultyNameFilter(q, user);
    return this.dq.overview(clamped === null ? { ...q, facultyName: ['__none__'] } : clamped);
  }

  @Get('drill')
  @Authorized('institution:read:dashboard')
  async drill(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(DqQuerySchema)) q: DqQuery,
  ) {
    await assertCanSeeFacultyDashboards(user);
    const clamped = await clampFacultyNameFilter(q, user);
    return this.dq.drill(clamped === null ? { ...q, facultyName: ['__none__'] } : clamped);
  }

  @Get('radar')
  @Authorized('institution:read:dashboard')
  async radar(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(RadarQuerySchema)) q: RadarQuery,
  ) {
    await assertCanSeeFacultyDashboards(user);
    const clamped = await clampFacultyNameFilter(q, user);
    const facultyName = clamped === null ? ['__none__'] : clamped.facultyName;
    // The university comparison series is computed inside dqRadar over
    // the SAME clamp: a dean's "university" line must mean the scope
    // they are allowed to see, not the whole institution.
    return this.dq.radar({
      facultyName: facultyName[0],
      programId: q.programId,
      cohortYearBE: q.cohortYearBE,
      kind: q.kind,
    });
  }
}
```

**Decide and state one thing while implementing `radar`:** the comparison series is
labelled "University". For a `FACULTY_USER` whose clamp restricts them to one faculty,
that label would be false. Either relabel the series to the clamped scope, or compute the
comparison unclamped and rename it. Pick one, comment it, and say which in your report —
do not leave a line labelled "University" that means something else.

- [ ] **Step 3: Register** both in `education.module.ts` (`controllers` + `providers`, leaving existing entries alone).

- [ ] **Step 4: Verify**

`pnpm --filter api typecheck`, then with the API running:
```bash
curl -s "http://localhost:4000/api/v1/education/student-dq/overview" | head -c 120
```
Expected: an `UNAUTHORIZED` envelope — proving the route is registered and guarded (a 404 means it is not registered).

- [ ] **Step 5: Commit** — `feat(api): /education/student-dq endpoints`

---

## Task 7: The page — KPIs, filters, drill-down

**Files:** Create `apps/web/app/education/student-dq/page.tsx`, `client.tsx`.

- [ ] **Step 1: Server component** — mirror `apps/web/app/education/satisfaction/page.tsx`: `auth()` gate, `canSeeProgramAwareDashboards`, `apiFetchSafe` for overview + drill, `DiagnosticEmptyState` on failure with `surface="student DQ"`, `PageHeader`, `dynamic = 'force-dynamic'`. Read `facultyName` and `cohort` from `searchParams`.

- [ ] **Step 2: Client component**

- KPI strip: Students tested · With scores · Passed (DQ) · Module 13 adoption. Every figure from the response.
- Filter rail (URL state via `router.push`, matching `compensation/client.tsx`): faculty `MultiSelectField`, cohort `MultiSelectField`, a theory/workshop toggle (drives the radar), and a "Clear filters" button.
- Drill-down: shared `DrillDownPivot`, `maxDepth={2}`, columns `Overall` (`decimal1`) · `Passed %` (`decimal1`) · `Tested` (`int`) then one `decimal1` column per module in framework order using `DQ_MODULES` for order and `shortEn` for the header.
  - **Faculty rows must be built from summed `scoreSum`/`takenCount`, not from child means.** The API returns faculty rows already aggregated — use them; do not recompute from children.
  - The `programId === null` child renders last within its faculty with `label: 'Program not identified'` and `emphasis: 'muted'`, plus `badge: { text: 'unplaced', tone: 'muted' }`.
  - A module with `mean === null` renders `—` via the pivot's existing null path. Never 0.
- **`import type` only** from `@kku/shared` in the client component; a runtime import pulls a `node:crypto` barrel and breaks the build. `DQ_MODULES` is a plain data table, so import it in the SERVER component and pass it down as a prop, or re-declare the ordering locally — pick one and comment why.
- Methodology note under the table: the pass mark, that zeros are excluded as not-taken, `student-dq.v1`, and the source refresh timestamp.

- [ ] **Step 3: Verify** — `pnpm --filter web typecheck` and `pnpm --filter web exec eslint app/education/student-dq --ext .ts,.tsx`, both clean. CI lints changed files, so new files must be clean.

- [ ] **Step 4: Commit** — `feat(web): Student DQ dashboard page with faculty → program drill-down`

---

## Task 8: The radar

**Files:** Modify `apps/web/app/education/student-dq/client.tsx`.

- [ ] **Step 1: Add the radar section** below the table, using `RadarChartSmall` from `@kku/ui` (`packages/ui/src/viz/radar.tsx`):

```tsx
<RadarChartSmall
  points={scopePoints}                  // RadarPoint[] — { label: shortEn, value: mean | null }
  comparisons={[{ label: 'University', points: universityPoints }]}
  seriesLabel={scopeLabel}
  width={620}
  height={460}
/>
```

- 13 theory axes by default; the theory/workshop toggle switches to the 4 workshop axes.
- `value` is the module mean or `null` — the primitive already suffixes null axes with `· n/d`, which is exactly the "not taken" signal this dashboard needs.
- Clicking a drill-down row sets the radar scope (faculty or program) and its label; the default scope is the whole (filtered) university.
- Beneath the chart, a coverage line listing any axis whose `coveragePct` is below 50, e.g. "Thinly taken: Generative AI (57% of students)". A thinly-taken module must not read as a strong one.

**Check the primitive's label gutter before assuming 13 axes fit** — `LABEL_GUTTER_PX` is sized for ~8 dimensions at 280px wide. Render it, look at it, and if labels collide, raise the width/height rather than truncating labels. Report what you saw.

- [ ] **Step 2: Coverage panel** — a collapsed `Card` reporting, from the overview response: students tested vs scored, the gap with `hasResult` but no scores, the program match rate with its one-line cohort explanation, the unmatched faculty names count, and the `allPassed` inconsistency count with the sentence that the flag is DQ's own verdict, passed through unchanged.

- [ ] **Step 3: Verify + commit** — typecheck, lint, then `feat(web): Student DQ radar with university comparison`

---

## Task 9: Hub tile, changelog, full verification

**Files:** Modify the Education hub page, `apps/web/app/changelog/page.tsx`.

- [ ] **Step 1: Tile** — add a `/education/student-dq` entry to the Education hub's tile array, matching the existing entries' shape (read the file first; if it has thumbnails like the Staff hub, add one in the same style).

- [ ] **Step 2: Changelog** — a new first entry in `ENTRIES`, matching the file's `ChangelogEntry` shape, covering: the new dashboard; the drill-down and radar; that the pass mark is 70; that module 13 is newly added and only ~57% of students have taken it, so its zeros are treated as "not taken" rather than as failures; that ~40% of tested students are past cohorts who cannot be matched to a current programme and appear under "Program not identified"; and that no student names or ids are stored. Use the live numbers from Task 4, not the ones in this plan, if they differ.

- [ ] **Step 3: Full verification**

```bash
pnpm typecheck        # expect 8/8 clean
pnpm test             # expect the previous total + the new DQ tests
```
`pnpm lint` runs repo-wide and has a known pre-existing backlog — only failures in files this plan touched are yours. If a file you touched has a pre-existing lint error, fix it: CI lints changed files, so it becomes a failure the moment you touch it.

Then render the page signed in and confirm: KPI figures match the Task 4 SQL; a faculty expands to programs plus one "Program not identified" row; module 13's column and axis read ≈ 70 with a 57% coverage note; and the radar's university comparison line is visible.

- [ ] **Step 4: Report, do not deploy.** Summarise files, measured numbers, test counts and anything deferred. **Do not run `pnpm build:release`** — builds happen only when the operator asks.

---

## Done criteria

- [ ] `/education/student-dq` drills Faculty → Program with per-module columns, and every faculty figure is a weighted mean rather than a mean of means.
- [ ] The radar plots the selected scope against the university, with thinly-taken axes marked.
- [ ] Module 13 reads ≈ 70 with ~57% coverage — never ≈ 40.
- [ ] `dq_student_cube` totals reconcile with the connector's fetched count.
- [ ] No student name or id exists anywhere in the database or in any API response.
- [ ] Unplaced students are visible under their faculty, not silently dropped.
