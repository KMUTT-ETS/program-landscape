# Teaching and Learning Talent dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/staff/teaching-talent` — a Faculty → staff drill-down identifying instructors who scored at or above a threshold in **every** one of the last three completed academic years, plus an XLSX export of the qualifying staff.

**Architecture:** A new `packages/db/src/teaching-talent.ts` owns the metric: pure rule functions (unit-tested without a database) plus one async function running four `$queryRaw` calls. A new controller/service pair in the existing `staff-dashboard` NestJS module exposes a roster route and a POST export route, reusing `/staff/teaching`'s access-control helpers verbatim. The Next.js page renders through the shared `DrillDownPivot`, and a thin Next route handler proxies the workbook bytes to the browser.

**Tech Stack:** TypeScript (strict, no `any`), Prisma `$queryRaw` on PostgreSQL, NestJS, Next.js 14 App Router, Vitest, `xlsx@0.18.5` (already a dependency of `apps/api`), Tailwind design tokens.

**Spec:** `docs/superpowers/specs/2026-08-24-teaching-talent-dashboard-design.md` — read it before Task 1. The single most important property it defines: **this dashboard must never join `program_courses` or `program_faculties`.** `/staff/teaching` does, and that join drops 565 of 1,695 evaluated instructors (33%). Reusing its query would silently delete a third of the roster.

---

## File structure

**Create**

| file | responsibility |
|---|---|
| `packages/db/src/teaching-talent.ts` | Metric: constants, pure rule functions, the roster query |
| `packages/db/test/teaching-talent.test.ts` | Unit tests for the pure functions + the population guard |
| `apps/api/src/staff-dashboard/teaching-talent.service.ts` | DI wrapper + workbook builder |
| `apps/api/src/staff-dashboard/teaching-talent.controller.ts` | 2 routes, tiered access |
| `apps/api/test/teaching-talent-export.test.ts` | Workbook round-trip tests |
| `apps/web/app/staff/teaching-talent/page.tsx` | Server component: auth gate + fetch |
| `apps/web/app/staff/teaching-talent/client.tsx` | Filters, KPI strip, table, coverage panel |
| `apps/web/app/api/staff-talent-export/route.ts` | Streams the xlsx bytes to the browser |

**Modify**

| file | change |
|---|---|
| `packages/db/src/index.ts` | `export * from './teaching-talent';` |
| `apps/api/src/staff-dashboard/staff.module.ts` | Register controller + service |
| `apps/web/app/staff/drill-down-pivot.tsx` | Optional `badge` on `DrillRow`, `decimal2` format |
| `apps/web/app/staff/page.tsx` | New hub tile |
| `apps/web/app/staff/thumbnails.tsx` | `TeachingTalentThumb` |
| `apps/web/app/changelog/page.tsx` | Release entry |

---

## Task 1: Pure rule functions

**Files:**
- Create: `packages/db/src/teaching-talent.ts`
- Create: `packages/db/test/teaching-talent.test.ts`

The three rules that decide who is a talent, isolated from the database so they can be
tested exhaustively. This mirrors `packages/db/src/financial-year.ts`, which is the
house style for "a scoring decision that must be defensible".

- [ ] **Step 1: Write the failing test**

Create `packages/db/test/teaching-talent.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  TALENT_DEFAULT_THRESHOLD,
  TALENT_WINDOW_YEARS,
  classifyTalent,
  resolveTalentYears,
  splitPersonName,
} from '../src/teaching-talent';

describe('resolveTalentYears', () => {
  it('takes the three most recent completed years, ascending', () => {
    // Current academic year is BE 2569, so 2568 is the newest completed one.
    expect(resolveTalentYears([2569, 2568, 2567, 2566, 2565], 2569)).toEqual([
      2566, 2567, 2568,
    ]);
  });

  it('excludes the in-progress year even when it already has data', () => {
    expect(resolveTalentYears([2569, 2568, 2567, 2566], 2569)).not.toContain(2569);
  });

  it('skips a gap rather than inventing a year', () => {
    // 2566 never landed; the window reaches further back instead.
    expect(resolveTalentYears([2568, 2567, 2565], 2569)).toEqual([2565, 2567, 2568]);
  });

  it('returns fewer than three years when the data is thin', () => {
    expect(resolveTalentYears([2568, 2567], 2569)).toEqual([2567, 2568]);
    expect(resolveTalentYears([], 2569)).toEqual([]);
  });

  it('tolerates unsorted input', () => {
    expect(resolveTalentYears([2566, 2569, 2568, 2567], 2569)).toEqual([
      2566, 2567, 2568,
    ]);
  });

  it('exposes the window size it enforces', () => {
    expect(TALENT_WINDOW_YEARS).toBe(3);
    expect(resolveTalentYears([2568, 2567, 2566, 2565], 2569)).toHaveLength(3);
  });
});

describe('classifyTalent', () => {
  const years = [2566, 2567, 2568];

  it('badges an instructor above the bar in all three years', () => {
    const r = classifyTalent(
      { '2566': 4.31, '2567': 4.52, '2568': 4.48 },
      years,
      TALENT_DEFAULT_THRESHOLD,
    );
    expect(r.isTalent).toBe(true);
    expect(r.yearsWithData).toBe(3);
    expect(r.minYearRating).toBe(4.31);
  });

  it('refuses when one year is below the bar', () => {
    const r = classifyTalent(
      { '2566': 4.9, '2567': 3.8, '2568': 4.7 },
      years,
      TALENT_DEFAULT_THRESHOLD,
    );
    expect(r.isTalent).toBe(false);
    expect(r.minYearRating).toBe(3.8);
  });

  it('refuses when a year is missing, however high the others are', () => {
    const r = classifyTalent({ '2567': 4.9, '2568': 4.95 }, years, TALENT_DEFAULT_THRESHOLD);
    expect(r.isTalent).toBe(false);
    expect(r.yearsWithData).toBe(2);
  });

  it('treats a null year as missing', () => {
    const r = classifyTalent(
      { '2566': null, '2567': 4.9, '2568': 4.95 },
      years,
      TALENT_DEFAULT_THRESHOLD,
    );
    expect(r.isTalent).toBe(false);
    expect(r.yearsWithData).toBe(2);
  });

  it('compares on the displayed 2-decimal value, so 3.996 counts as 4.00', () => {
    // The UI prints 4.00 for this instructor. A missing badge next to a
    // printed 4.00 is indefensible in front of a dean.
    const r = classifyTalent(
      { '2566': 3.996, '2567': 4.5, '2568': 4.5 },
      years,
      4.0,
    );
    expect(r.isTalent).toBe(true);
  });

  it('rejects 3.994, which displays as 3.99', () => {
    const r = classifyTalent(
      { '2566': 3.994, '2567': 4.5, '2568': 4.5 },
      years,
      4.0,
    );
    expect(r.isTalent).toBe(false);
  });

  it('respects a higher threshold', () => {
    const scores = { '2566': 4.31, '2567': 4.52, '2568': 4.48 };
    expect(classifyTalent(scores, years, 4.25).isTalent).toBe(true);
    expect(classifyTalent(scores, years, 4.5).isTalent).toBe(false);
  });

  it('never badges anyone when the window itself is short', () => {
    const r = classifyTalent({ '2567': 4.9, '2568': 4.9 }, [2567, 2568], 4.0);
    expect(r.isTalent).toBe(false);
    expect(r.yearsWithData).toBe(2);
  });

  it('returns a null minimum when there is no data at all', () => {
    const r = classifyTalent({}, years, 4.0);
    expect(r.minYearRating).toBeNull();
    expect(r.isTalent).toBe(false);
  });
});

describe('splitPersonName', () => {
  it('splits a two-token Thai name', () => {
    expect(splitPersonName('สมชาย ใจดี')).toEqual({
      first: 'ศิริลักษณ์',
      last: 'อนันต์ณัฐศิริ',
    });
  });

  it('keeps token 1 as the first name and the rest as the surname', () => {
    expect(splitPersonName('สม ชาย ใจดี')).toEqual({ first: 'สม', last: 'ชาย ใจดี' });
  });

  it('puts a single token in the first name and leaves the surname blank', () => {
    expect(splitPersonName('มาลี')).toEqual({ first: 'มาลี', last: '' });
  });

  it('collapses stray whitespace', () => {
    expect(splitPersonName('  ประธาน   ฦาชา  ')).toEqual({
      first: 'ประธาน',
      last: 'ฦาชา',
    });
  });

  it('returns two blanks for an empty name', () => {
    expect(splitPersonName('')).toEqual({ first: '', last: '' });
    expect(splitPersonName('   ')).toEqual({ first: '', last: '' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @kku/db exec vitest run test/teaching-talent.test.ts`
Expected: FAIL — `Failed to resolve import "../src/teaching-talent"`.

- [ ] **Step 3: Write the implementation**

Create `packages/db/src/teaching-talent.ts` with exactly this content for now (the
query lands in Task 2):

```ts
/**
 * Teaching and Learning Talent — sustained student-evaluation quality.
 *
 * A talent is an instructor who scored at or above a threshold in EVERY
 * one of the last three completed academic years. Consistency is the
 * point: one strong semester is noise, three straight years is a signal.
 *
 * ## Why this module does not reuse `evaluations.ts`
 *
 * `instructorsByProgram()` — the query behind /staff/teaching — joins
 * `program_courses ON course_code`. An instructor whose courses are not
 * mapped to a program does not appear in its output at all. Measured on
 * BE 2566–2568: 1,695 instructors have evaluations, only 1,130 survive
 * that join. Reusing it here would silently drop 33% of the roster from
 * a talent list. This module queries the roster directly and MUST NEVER
 * join `program_courses` or `program_faculties`; a test in
 * `packages/db/test/teaching-talent.test.ts` enforces that.
 */

export const TEACHING_TALENT_METHODOLOGY_VERSION = 'teaching-talent.v1';
export const TALENT_THRESHOLD_OPTIONS = [4.0, 4.25, 4.5, 4.75] as const;
export const TALENT_DEFAULT_THRESHOLD = 4.0;
export const TALENT_WINDOW_YEARS = 3;

/** Round to the 2 decimals the UI prints. Talent comparisons run on this
 *  value, never on the raw float — a printed "4.00" beside a missing
 *  badge is not explainable to a dean. */
export function displayRating(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Pick the assessment window: the most recent `TALENT_WINDOW_YEARS`
 * academic years that are both COMPLETED and present in the data.
 *
 * `yearsWithData` may arrive in any order. `currentAcademicYearBE` comes
 * from `getAcademicYearContext()`; the year currently running is excluded
 * because its evaluations are, by construction, partial.
 *
 * Returns ASCENDING (oldest first) — the order the UI renders columns in.
 * Returns fewer than three entries when the data cannot support the rule;
 * callers must then refuse to badge anyone.
 */
export function resolveTalentYears(
  yearsWithData: number[],
  currentAcademicYearBE: number,
): number[] {
  return [...new Set(yearsWithData)]
    .filter((y) => y < currentAcademicYearBE)
    .sort((a, b) => b - a)
    .slice(0, TALENT_WINDOW_YEARS)
    .sort((a, b) => a - b);
}

export interface TalentClassification {
  isTalent: boolean;
  /** How many of the window's years this person actually has a score in. */
  yearsWithData: number;
  /** Lowest yearly score in the window, or null when there is none. */
  minYearRating: number | null;
}

/**
 * Apply the rule to one person's per-year scores.
 *
 * `byYear` is keyed by the academic year as a string. A missing key and a
 * null value mean the same thing: no evidence for that year, which
 * disqualifies — deliberately, because "we have no idea how they taught
 * in 2567" is not the same claim as "they were good in 2567".
 */
export function classifyTalent(
  byYear: Record<string, number | null>,
  years: number[],
  threshold: number,
): TalentClassification {
  const present: number[] = [];
  for (const year of years) {
    const value = byYear[String(year)];
    if (value !== null && value !== undefined) present.push(displayRating(value));
  }
  const minYearRating = present.length > 0 ? Math.min(...present) : null;
  const isTalent =
    years.length === TALENT_WINDOW_YEARS &&
    present.length === TALENT_WINDOW_YEARS &&
    minYearRating !== null &&
    minYearRating >= threshold;
  return { isTalent, yearsWithData: present.length, minYearRating };
}

/**
 * Split a stored full name into first name + surname for the export.
 *
 * `FacultyMember.nameTh` holds "first last" with no honorific prefix (the
 * rank column carries the title separately). Token 1 is the given name;
 * everything after it is the surname, which keeps multi-token Thai
 * surnames intact.
 */
export function splitPersonName(fullName: string): { first: string; last: string } {
  const tokens = fullName.trim().split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return { first: '', last: '' };
  return { first: tokens[0]!, last: tokens.slice(1).join(' ') };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @kku/db exec vitest run test/teaching-talent.test.ts`
Expected: PASS — 17 tests.

- [ ] **Step 5: Export the module and typecheck**

Add to `packages/db/src/index.ts`, immediately after the `export * from './financial-year';` line:

```ts
export * from './teaching-talent';
```

Run: `pnpm --filter @kku/db typecheck`
Expected: no output (success).

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/teaching-talent.ts packages/db/test/teaching-talent.test.ts packages/db/src/index.ts
git commit -m "feat(db): teaching-talent rule functions — 3-year sustained-quality classification"
```

---

## Task 2: The roster query

**Files:**
- Modify: `packages/db/src/teaching-talent.ts` (append)
- Modify: `packages/db/test/teaching-talent.test.ts` (append the population guard)

Four `$queryRaw` calls in one exported function: resolve the window, roll up matched
instructors, roll up the unmatched teachers, count the unattributable rows.

- [ ] **Step 1: Write the failing population-guard test**

Append to `packages/db/test/teaching-talent.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('population guard', () => {
  // This is a source-level assertion on purpose. The realistic failure
  // mode is a future contributor "reusing" the /staff/teaching pivot for
  // consistency — which joins program_courses and would silently delete
  // 565 of 1,695 evaluated instructors (33%) from a talent list.
  const source = readFileSync(
    join(__dirname, '..', 'src', 'teaching-talent.ts'),
    'utf8',
  );
  // Strip comments so the explanatory prose above (which names the tables)
  // does not trip the assertion.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('never joins program_courses — that join drops a third of the roster', () => {
    expect(code).not.toContain('program_courses');
  });

  it('never joins program_faculties — curriculum mapping must not gate the roster', () => {
    expect(code).not.toContain('program_faculties');
  });

  it('gates on real data only', () => {
    expect(code).toContain('ds.mocked = false');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @kku/db exec vitest run test/teaching-talent.test.ts -t "population guard"`
Expected: FAIL on "gates on real data only" — the file has no SQL yet.

- [ ] **Step 3: Write the query**

Append to `packages/db/src/teaching-talent.ts`. Add the imports at the top of the file
(the existing house style — see `packages/db/src/evaluations.ts:1`):

```ts
import { Prisma } from '@prisma/client';
import { prisma } from './client';
import { getAcademicYearContext } from './academic-year';
```

Then append:

```ts
export interface TalentYearCell {
  ratingAvg: number | null;
  respondentCount: number;
}

export interface TalentInstructorRow {
  facultyMemberId: string;
  nameTh: string;
  nameEn: string;
  /** FacultyRank enum value — LECTURER | ASST_PROF | ASSOC_PROF | PROF. */
  rank: string;
  /** Null unless the caller passed `includeContact` — see the roster fn. */
  kkuEmail: string | null;
  facultyId: string;
  facultyName: string;
  isActive: boolean;
  overallRating: number | null;
  totalRespondents: number;
  courseCount: number;
  byYear: Record<string, TalentYearCell>;
  yearsWithData: number;
  minYearRating: number | null;
}

/** Registrar-credited teacher with no FacultyMember row. Identified only
 *  by the email the registrar recorded; `facultyName` is the owning
 *  faculty of the classes they taught, not a home faculty. */
export interface UnmatchedTeacherRow {
  kkuEmail: string;
  facultyName: string | null;
  overallRating: number | null;
  totalRespondents: number;
  byYear: Record<string, TalentYearCell>;
  yearsWithData: number;
  minYearRating: number | null;
}

export interface TeachingTalentResult {
  methodologyVersion: string;
  /** Ascending. Empty when no completed year carries data. */
  years: number[];
  /** False when fewer than three completed years carry data — no one is
   *  badged in that state. */
  windowComplete: boolean;
  rows: TalentInstructorRow[];
  unmatched: {
    teachers: UnmatchedTeacherRow[];
    /** Rows with neither a resolved id nor an email — attributable to
     *  nobody, excluded from every other count on the page. */
    unattributableRowCount: number;
  };
}

export interface TeachingTalentFilter {
  /** Thai faculty names. Undefined = no clamp (university-wide caller). */
  facultyName?: string[];
}

export interface TeachingTalentOptions {
  /** Include staff email on matched rows. Export only — the dashboard has
   *  no use for it, so it never travels to the browser. */
  includeContact?: boolean;
  /** Include the unmatched-teacher aggregate. Off for PROGRAM_USER. */
  includeUnmatched?: boolean;
}

/** Fold (person × year) aggregate rows into one row per person. Shared by
 *  the matched and unmatched paths — the arithmetic is identical, only the
 *  identity columns differ. */
function foldYearCells(
  cells: Array<{ key: string; year: number; ratingAvg: number | null; respondents: number }>,
): Map<string, { byYear: Record<string, TalentYearCell>; totalRespondents: number }> {
  const out = new Map<string, { byYear: Record<string, TalentYearCell>; totalRespondents: number }>();
  for (const cell of cells) {
    let entry = out.get(cell.key);
    if (!entry) {
      entry = { byYear: {}, totalRespondents: 0 };
      out.set(cell.key, entry);
    }
    const yearKey = String(cell.year);
    const existing = entry.byYear[yearKey];
    if (existing && existing.ratingAvg !== null && cell.ratingAvg !== null) {
      // Same person, same year, two source rows (e.g. classes owned by two
      // faculties). Combine respondent-weighted, never by naive mean.
      const totalResp = existing.respondentCount + cell.respondents;
      entry.byYear[yearKey] = {
        ratingAvg:
          totalResp > 0
            ? (existing.ratingAvg * existing.respondentCount +
                cell.ratingAvg * cell.respondents) /
              totalResp
            : null,
        respondentCount: totalResp,
      };
    } else {
      entry.byYear[yearKey] = {
        ratingAvg: cell.ratingAvg,
        respondentCount: cell.respondents,
      };
    }
    entry.totalRespondents += cell.respondents;
  }
  return out;
}

/** Respondent-weighted mean across a person's year cells. Equals the
 *  row-level weighted mean over the window, because each year cell is
 *  itself a weighted mean over its own rows. */
function overallFromYears(byYear: Record<string, TalentYearCell>): number | null {
  let weighted = 0;
  let respondents = 0;
  for (const cell of Object.values(byYear)) {
    if (cell.ratingAvg === null) continue;
    weighted += cell.ratingAvg * cell.respondentCount;
    respondents += cell.respondentCount;
  }
  return respondents > 0 ? weighted / respondents : null;
}

/**
 * Roster for the Teaching and Learning Talent dashboard.
 *
 * Grouped by the instructor's HOME faculty (`faculty_members.faculty_id`).
 * All semesters count (1–4), unlike /staff/teaching which defaults to 1–2.
 * The threshold is NOT applied here: `minYearRating` + `yearsWithData`
 * travel to the caller so the UI can re-badge without a refetch, and the
 * export applies `classifyTalent()` to the same numbers.
 */
export async function teachingTalentRoster(
  filter: TeachingTalentFilter | undefined,
  opts: TeachingTalentOptions = {},
): Promise<TeachingTalentResult> {
  const facultyNames =
    filter?.facultyName && filter.facultyName.length > 0 ? filter.facultyName : undefined;
  const facultyClause = facultyNames
    ? Prisma.sql`AND f.name_th = ANY(${facultyNames}::text[])`
    : Prisma.empty;

  const { currentAcademicYearBE } = await getAcademicYearContext();

  // ── 1. Resolve the window ────────────────────────────────────────────
  // Global (not faculty-clamped) so every user sees the same columns.
  const yearRows = await prisma.$queryRaw<Array<{ acad_year_be: number }>>`
    SELECT DISTINCT e.acad_year_be
    FROM evaluation_response_summaries e
    JOIN ingestion_runs ir ON ir.id = e.ingestion_run_id
    JOIN data_sources ds ON ds.id = ir.data_source_id
    WHERE ds.mocked = false
      AND e.acad_year_be < ${currentAcademicYearBE}
    ORDER BY e.acad_year_be DESC
    LIMIT 12
  `;
  const years = resolveTalentYears(
    yearRows.map((r) => r.acad_year_be),
    currentAcademicYearBE,
  );
  const windowComplete = years.length === TALENT_WINDOW_YEARS;

  if (years.length === 0) {
    return {
      methodologyVersion: TEACHING_TALENT_METHODOLOGY_VERSION,
      years,
      windowComplete,
      rows: [],
      unmatched: { teachers: [], unattributableRowCount: 0 },
    };
  }

  // ── 2. Matched instructors ───────────────────────────────────────────
  // NO program_courses / program_faculties join — see the module header.
  const matched = await prisma.$queryRaw<
    Array<{
      faculty_member_id: string;
      name_th: string;
      name_en: string;
      rank: string;
      kku_email: string | null;
      faculty_id: string;
      faculty_name: string;
      is_active: boolean;
      acad_year_be: number;
      rating_avg: number | null;
      respondents: bigint;
      course_count: bigint;
    }>
  >`
    SELECT
      fm.id                                                  AS faculty_member_id,
      fm.name_th                                             AS name_th,
      fm.name_en                                             AS name_en,
      fm.rank::text                                          AS rank,
      fm.kku_email                                           AS kku_email,
      f.id                                                   AS faculty_id,
      f.name_th                                              AS faculty_name,
      fm.is_active                                           AS is_active,
      e.acad_year_be                                         AS acad_year_be,
      (SUM(e.rating_avg::numeric * e.respondent_count)
         / NULLIF(SUM(e.respondent_count), 0))::float        AS rating_avg,
      COALESCE(SUM(e.respondent_count), 0)::bigint           AS respondents,
      COUNT(DISTINCT e.course_code)::bigint                  AS course_count
    FROM evaluation_response_summaries e
    JOIN ingestion_runs ir ON ir.id = e.ingestion_run_id
    JOIN data_sources ds ON ds.id = ir.data_source_id
    JOIN faculty_members fm ON fm.id = e.faculty_member_id
    JOIN faculties f ON f.id = fm.faculty_id
    WHERE ds.mocked = false
      AND e.faculty_member_id IS NOT NULL
      AND e.acad_year_be = ANY(${years}::int[])
      ${facultyClause}
    GROUP BY fm.id, fm.name_th, fm.name_en, fm.rank, fm.kku_email,
             f.id, f.name_th, fm.is_active, e.acad_year_be
    ORDER BY f.name_th, fm.name_th
  `;

  const matchedFolded = foldYearCells(
    matched.map((r) => ({
      key: r.faculty_member_id,
      year: r.acad_year_be,
      ratingAvg: r.rating_avg,
      respondents: Number(r.respondents),
    })),
  );
  const identity = new Map<string, (typeof matched)[number]>();
  const courseCounts = new Map<string, number>();
  for (const r of matched) {
    if (!identity.has(r.faculty_member_id)) identity.set(r.faculty_member_id, r);
    courseCounts.set(
      r.faculty_member_id,
      Math.max(courseCounts.get(r.faculty_member_id) ?? 0, Number(r.course_count)),
    );
  }

  const rows: TalentInstructorRow[] = [];
  for (const [facultyMemberId, folded] of matchedFolded) {
    const id = identity.get(facultyMemberId)!;
    const ratings: Record<string, number | null> = {};
    for (const [year, cell] of Object.entries(folded.byYear)) ratings[year] = cell.ratingAvg;
    const cls = classifyTalent(ratings, years, TALENT_DEFAULT_THRESHOLD);
    rows.push({
      facultyMemberId,
      nameTh: id.name_th,
      nameEn: id.name_en,
      rank: id.rank,
      kkuEmail: opts.includeContact ? id.kku_email : null,
      facultyId: id.faculty_id,
      facultyName: id.faculty_name,
      isActive: id.is_active,
      overallRating: overallFromYears(folded.byYear),
      totalRespondents: folded.totalRespondents,
      courseCount: courseCounts.get(facultyMemberId) ?? 0,
      byYear: folded.byYear,
      yearsWithData: cls.yearsWithData,
      minYearRating: cls.minYearRating,
    });
  }

  if (!opts.includeUnmatched) {
    return {
      methodologyVersion: TEACHING_TALENT_METHODOLOGY_VERSION,
      years,
      windowComplete,
      rows,
      unmatched: { teachers: [], unattributableRowCount: 0 },
    };
  }

  // ── 3. Teachers with no HR record ────────────────────────────────────
  // Identified only by the registrar's email. `f` here is the class's
  // owning faculty (evaluation_response_summaries.faculty_id), which is
  // populated independently of faculty_member_id. When the caller is
  // faculty-clamped, the ANY() predicate drops NULL-faculty rows on its
  // own — a scoped user must not see a person who may belong elsewhere.
  const unmatchedCells = await prisma.$queryRaw<
    Array<{
      kku_email: string;
      faculty_name: string | null;
      acad_year_be: number;
      rating_avg: number | null;
      respondents: bigint;
    }>
  >`
    SELECT
      lower(trim(e.kkumail_raw))                             AS kku_email,
      f.name_th                                              AS faculty_name,
      e.acad_year_be                                         AS acad_year_be,
      (SUM(e.rating_avg::numeric * e.respondent_count)
         / NULLIF(SUM(e.respondent_count), 0))::float        AS rating_avg,
      COALESCE(SUM(e.respondent_count), 0)::bigint           AS respondents
    FROM evaluation_response_summaries e
    JOIN ingestion_runs ir ON ir.id = e.ingestion_run_id
    JOIN data_sources ds ON ds.id = ir.data_source_id
    LEFT JOIN faculties f ON f.id = e.faculty_id
    WHERE ds.mocked = false
      AND e.faculty_member_id IS NULL
      AND e.kkumail_raw IS NOT NULL
      AND e.acad_year_be = ANY(${years}::int[])
      ${facultyClause}
    GROUP BY lower(trim(e.kkumail_raw)), f.name_th, e.acad_year_be
  `;

  const unmatchedFolded = foldYearCells(
    unmatchedCells.map((r) => ({
      key: r.kku_email,
      year: r.acad_year_be,
      ratingAvg: r.rating_avg,
      respondents: Number(r.respondents),
    })),
  );
  // A teacher may appear under two class faculties; show the one that
  // carries the most respondents.
  const facultyByEmail = new Map<string, { name: string | null; respondents: number }>();
  for (const r of unmatchedCells) {
    const current = facultyByEmail.get(r.kku_email);
    const respondents = Number(r.respondents);
    if (!current || respondents > current.respondents) {
      facultyByEmail.set(r.kku_email, { name: r.faculty_name, respondents });
    }
  }

  const teachers: UnmatchedTeacherRow[] = [];
  for (const [kkuEmail, folded] of unmatchedFolded) {
    const ratings: Record<string, number | null> = {};
    for (const [year, cell] of Object.entries(folded.byYear)) ratings[year] = cell.ratingAvg;
    const cls = classifyTalent(ratings, years, TALENT_DEFAULT_THRESHOLD);
    teachers.push({
      kkuEmail,
      facultyName: facultyByEmail.get(kkuEmail)?.name ?? null,
      overallRating: overallFromYears(folded.byYear),
      totalRespondents: folded.totalRespondents,
      byYear: folded.byYear,
      yearsWithData: cls.yearsWithData,
      minYearRating: cls.minYearRating,
    });
  }

  // ── 4. Rows attributable to nobody ───────────────────────────────────
  const [unattributable] = await prisma.$queryRaw<Array<{ c: bigint }>>`
    SELECT COUNT(*)::bigint AS c
    FROM evaluation_response_summaries e
    JOIN ingestion_runs ir ON ir.id = e.ingestion_run_id
    JOIN data_sources ds ON ds.id = ir.data_source_id
    WHERE ds.mocked = false
      AND e.faculty_member_id IS NULL
      AND e.kkumail_raw IS NULL
      AND e.acad_year_be = ANY(${years}::int[])
  `;

  return {
    methodologyVersion: TEACHING_TALENT_METHODOLOGY_VERSION,
    years,
    windowComplete,
    rows,
    unmatched: {
      teachers,
      unattributableRowCount: Number(unattributable?.c ?? 0),
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @kku/db exec vitest run test/teaching-talent.test.ts`
Expected: PASS — 20 tests.

Run: `pnpm --filter @kku/db typecheck`
Expected: no output.

- [ ] **Step 5: Verify against the live database**

Create a throwaway script at `/tmp/claude-1000/-home-denpong-projects-program-landscape/0516c8d2-24cf-4580-a914-8c2bfb548568/scratchpad/talent-check.ts`:

```ts
import { teachingTalentRoster, classifyTalent } from '@kku/db';

async function main() {
  const r = await teachingTalentRoster(undefined, { includeUnmatched: true });
  console.log('years', r.years, 'windowComplete', r.windowComplete);
  console.log('instructors', r.rows.length);
  console.log(
    'talents@4.0',
    r.rows.filter((row) => classifyTalent(
      Object.fromEntries(Object.entries(row.byYear).map(([y, c]) => [y, c.ratingAvg])),
      r.years, 4.0,
    ).isTalent).length,
  );
  console.log('unmatched teachers', r.unmatched.teachers.length);
  console.log('unattributable rows', r.unmatched.unattributableRowCount);
}
main().then(() => process.exit(0));
```

Run: `pnpm tsx /tmp/claude-1000/-home-denpong-projects-program-landscape/0516c8d2-24cf-4580-a914-8c2bfb548568/scratchpad/talent-check.ts`

Expected (measured 2026-08-24 on dev):
```
years [ 2566, 2567, 2568 ] windowComplete true
instructors 1695
talents@4.0 1243
unmatched teachers 271
unattributable rows 34566
```

**If `instructors` comes back at 1130, the query picked up a `program_courses` join —
stop and fix it.** Delete the scratch script afterwards.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/teaching-talent.ts packages/db/test/teaching-talent.test.ts
git commit -m "feat(db): teaching-talent roster query — full evaluated roster, no curriculum join"
```

---

## Task 3: API service and roster route

**Files:**
- Create: `apps/api/src/staff-dashboard/teaching-talent.service.ts`
- Create: `apps/api/src/staff-dashboard/teaching-talent.controller.ts`
- Modify: `apps/api/src/staff-dashboard/staff.module.ts`

- [ ] **Step 1: Write the service**

Create `apps/api/src/staff-dashboard/teaching-talent.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import {
  TEACHING_TALENT_METHODOLOGY_VERSION,
  teachingTalentRoster,
  type TeachingTalentFilter,
  type TeachingTalentOptions,
  type TeachingTalentResult,
} from '@kku/db';

// Thin DI wrapper over the @kku/db teaching-talent helper. The workbook
// builder lands here in the export task.
@Injectable()
export class TeachingTalentService {
  readonly methodologyVersion = TEACHING_TALENT_METHODOLOGY_VERSION;

  roster(
    filter: TeachingTalentFilter | undefined,
    opts: TeachingTalentOptions = {},
  ): Promise<TeachingTalentResult> {
    return teachingTalentRoster(filter, opts);
  }
}
```

- [ ] **Step 2: Write the controller**

Create `apps/api/src/staff-dashboard/teaching-talent.controller.ts`:

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
  resolveOwnFacultyMember,
} from '../common';
import { TeachingTalentService } from './teaching-talent.service';

// Express coerces query strings differently for single vs repeated params.
// Normalise to string[] at the schema layer (same helper shape as
// staff-evaluations.controller.ts).
const StringArray = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v): string[] => {
    if (v === undefined) return [];
    if (Array.isArray(v)) return v.filter((x) => x.length > 0);
    return v.length > 0 ? [v] : [];
  });

const TalentQuerySchema = z.object({ facultyName: StringArray });
type TalentQuery = z.infer<typeof TalentQuerySchema>;

// ────────────────────────────────────────────────────────────────────
// /staff/teaching-talent — sustained student-evaluation quality.
//
// Visibility tiers match /staff/teaching exactly:
//   PROGRAM_USER    → own row only, no unmatched panel
//   FACULTY_USER    → their faculty's instructors + unmatched teachers
//                     whose CLASS faculty is granted
//   UNIVERSITY_USER / EXECUTIVE / COUNCIL / ADMIN → everyone
//
// Unlike /staff/teaching this endpoint does NOT go through
// program_courses, so instructors whose courses are unmapped are
// included. That is the point of the dashboard — see the @kku/db module
// header for the measured 33% gap.
// ────────────────────────────────────────────────────────────────────

@Controller('/staff/teaching-talent')
export class TeachingTalentController {
  constructor(private readonly talent: TeachingTalentService) {}

  @Get()
  @Authorized('institution:read:dashboard')
  async roster(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(TalentQuerySchema)) q: TalentQuery,
  ) {
    await assertCanSeeFacultyDashboards(user);

    if (user.role === 'PROGRAM_USER') {
      // Own row only. No unmatched panel — a program user cannot action a
      // roster gap, and the panel names people outside their scope.
      const me = await resolveOwnFacultyMember(user);
      const result = await this.talent.roster(undefined, { includeUnmatched: false });
      return {
        ...result,
        rows: me ? result.rows.filter((r) => r.facultyMemberId === me.id) : [],
        scope: 'own' as const,
      };
    }

    const clamped = await clampFacultyNameFilter(q, user);
    if (clamped === null) {
      // No grants resolve — return an honest empty rather than everything.
      return {
        ...(await this.talent.roster({ facultyName: ['__none__'] }, { includeUnmatched: true })),
        scope: 'scoped' as const,
      };
    }
    const result = await this.talent.roster(
      { facultyName: clamped.facultyName },
      { includeUnmatched: true },
    );
    return { ...result, scope: 'full' as const };
  }
}
```

- [ ] **Step 3: Register both in the module**

In `apps/api/src/staff-dashboard/staff.module.ts`, add the imports and extend the
arrays (leave the existing entries untouched):

```ts
import { TeachingTalentController } from './teaching-talent.controller';
import { TeachingTalentService } from './teaching-talent.service';
```

```ts
  controllers: [StaffController, StaffEvaluationsController, TeachingTalentController],
  providers: [
    StaffService,
    TeachingWorkloadService,
    StaffEvaluationsService,
    TeachingTalentService,
    CacheService,
  ],
```

- [ ] **Step 4: Typecheck and smoke the route**

Run: `pnpm --filter api typecheck`
Expected: no output.

Start the API if it is not running (`pnpm dev` from the repo root), then:

Run: `curl -s "http://localhost:4000/api/v1/staff/teaching-talent" | head -c 200`
Expected: `{"data":null,"meta":...,"error":{"code":"UNAUTHORIZED"...` — the route exists
and is guarded. (An authenticated check happens in the browser at Task 6.)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/staff-dashboard/teaching-talent.service.ts apps/api/src/staff-dashboard/teaching-talent.controller.ts apps/api/src/staff-dashboard/staff.module.ts
git commit -m "feat(api): /staff/teaching-talent roster route with tiered visibility"
```

---

## Task 4: XLSX export

**Files:**
- Create: `apps/api/src/staff-dashboard/teaching-talent-workbook.ts`
- Create: `apps/api/test/teaching-talent-export.test.ts`
- Modify: `apps/api/src/staff-dashboard/teaching-talent.service.ts`
- Modify: `apps/api/src/staff-dashboard/teaching-talent.controller.ts`

The workbook builder is a pure function over a `TeachingTalentResult` so it can be
tested without a database or an HTTP request.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/teaching-talent-export.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import type { TeachingTalentResult } from '@kku/db';
import { buildTalentWorkbook } from '../src/staff-dashboard/teaching-talent-workbook';

const YEARS = [2566, 2567, 2568];

function cell(ratingAvg: number | null, respondentCount = 100) {
  return { ratingAvg, respondentCount };
}

const FIXTURE: TeachingTalentResult = {
  methodologyVersion: 'teaching-talent.v1',
  years: YEARS,
  windowComplete: true,
  rows: [
    {
      facultyMemberId: 'fm-1',
      nameTh: 'สมชาย ใจดี',
      nameEn: 'Somchai Jaidi',
      rank: 'ASSOC_PROF',
      kkuEmail: 'somchai@kku.ac.th',
      facultyId: 'fac-1',
      facultyName: 'คณะแพทยศาสตร์',
      isActive: true,
      overallRating: 4.62,
      totalRespondents: 300,
      courseCount: 4,
      byYear: { '2566': cell(4.55), '2567': cell(4.6), '2568': cell(4.7) },
      yearsWithData: 3,
      minYearRating: 4.55,
    },
    {
      facultyMemberId: 'fm-2',
      nameTh: 'สมหญิง แสงทอง',
      nameEn: 'Somying Saengthong',
      rank: 'ASST_PROF',
      kkuEmail: 'somying@kku.ac.th',
      facultyId: 'fac-1',
      facultyName: 'คณะแพทยศาสตร์',
      isActive: true,
      overallRating: 4.3,
      totalRespondents: 300,
      courseCount: 2,
      byYear: { '2566': cell(4.1), '2567': cell(4.4), '2568': cell(4.4) },
      yearsWithData: 3,
      minYearRating: 4.1,
    },
    {
      facultyMemberId: 'fm-3',
      nameTh: 'มาลี',
      nameEn: 'Mali',
      rank: 'LECTURER',
      kkuEmail: null,
      facultyId: 'fac-2',
      facultyName: 'คณะวิศวกรรมศาสตร์',
      isActive: true,
      overallRating: 4.9,
      totalRespondents: 200,
      courseCount: 1,
      byYear: { '2567': cell(4.9), '2568': cell(4.9) },
      yearsWithData: 2,
      minYearRating: 4.9,
    },
  ],
  unmatched: {
    teachers: [
      {
        kkuEmail: 'ghost@kku.ac.th',
        facultyName: 'คณะวิทยาศาสตร์',
        overallRating: 4.8,
        totalRespondents: 150,
        byYear: { '2566': cell(4.8, 50), '2567': cell(4.8, 50), '2568': cell(4.8, 50) },
        yearsWithData: 3,
        minYearRating: 4.8,
      },
      {
        kkuEmail: 'weak@kku.ac.th',
        facultyName: null,
        overallRating: 3.5,
        totalRespondents: 60,
        byYear: { '2566': cell(3.5, 20), '2567': cell(3.5, 20), '2568': cell(3.5, 20) },
        yearsWithData: 3,
        minYearRating: 3.5,
      },
    ],
    unattributableRowCount: 34566,
  },
};

function read(buf: Buffer) {
  const wb = XLSX.read(buf, { type: 'buffer' });
  return {
    names: wb.SheetNames,
    rows: (sheet: string): unknown[][] =>
      XLSX.utils.sheet_to_json(wb.Sheets[sheet]!, { header: 1 }) as unknown[][],
  };
}

describe('buildTalentWorkbook', () => {
  it('produces the three sheets in order', () => {
    const wb = read(buildTalentWorkbook(FIXTURE, { threshold: 4.0, facultyName: [] }));
    expect(wb.names).toEqual(['Talent', 'Unmatched', 'About']);
  });

  it('writes the agreed Talent columns in order', () => {
    const wb = read(buildTalentWorkbook(FIXTURE, { threshold: 4.0, facultyName: [] }));
    expect(wb.rows('Talent')[0]).toEqual([
      'Faculty',
      'Academic rank',
      'First name',
      'Last name',
      'Email',
      'Overall score',
      'Full name (EN)',
    ]);
  });

  it('exports only talents, splitting the Thai name', () => {
    const rows = read(buildTalentWorkbook(FIXTURE, { threshold: 4.0, facultyName: [] })).rows(
      'Talent',
    );
    // fm-3 has only 2 of 3 years — excluded however high the scores are.
    expect(rows).toHaveLength(3); // header + fm-1 + fm-2
    expect(rows[1]).toEqual([
      'คณะแพทยศาสตร์',
      'รองศาสตราจารย์',
      'ศิริลักษณ์',
      'อนันต์ณัฐศิริ',
      'somchai@kku.ac.th',
      4.62,
      'Somchai Jaidi',
    ]);
  });

  it('writes the score as a number, not a string', () => {
    const rows = read(buildTalentWorkbook(FIXTURE, { threshold: 4.0, facultyName: [] })).rows(
      'Talent',
    );
    expect(typeof rows[1]![5]).toBe('number');
  });

  it('raising the threshold shrinks the Talent sheet', () => {
    const rows = read(buildTalentWorkbook(FIXTURE, { threshold: 4.25, facultyName: [] })).rows(
      'Talent',
    );
    // fm-2's weakest year is 4.10 — below 4.25.
    expect(rows).toHaveLength(2); // header + fm-1
  });

  it('blanks the email cell rather than writing null', () => {
    // A talent whose HR record carries no email — the cell must be empty,
    // not the string "null".
    const noEmail: TeachingTalentResult = {
      ...FIXTURE,
      rows: [{ ...FIXTURE.rows[0]!, kkuEmail: null }],
    };
    const rows = read(buildTalentWorkbook(noEmail, { threshold: 4.0, facultyName: [] })).rows(
      'Talent',
    );
    expect(rows[1]![4]).toBe('');
  });

  it('splits a single-token name into first name only', () => {
    const oneToken: TeachingTalentResult = {
      ...FIXTURE,
      rows: [{ ...FIXTURE.rows[0]!, nameTh: 'มาลี' }],
    };
    const rows = read(buildTalentWorkbook(oneToken, { threshold: 4.0, facultyName: [] })).rows(
      'Talent',
    );
    expect(rows[1]![2]).toBe('มาลี');
    expect(rows[1]![3]).toBe('');
  });

  it('keeps unmatched teachers out of the Talent sheet', () => {
    const rows = read(buildTalentWorkbook(FIXTURE, { threshold: 4.0, facultyName: [] })).rows(
      'Talent',
    );
    const flat = rows.flat().join('|');
    expect(flat).not.toContain('ghost@kku.ac.th');
  });

  it('flags would-qualify on the Unmatched sheet and tracks the threshold', () => {
    const at40 = read(buildTalentWorkbook(FIXTURE, { threshold: 4.0, facultyName: [] })).rows(
      'Unmatched',
    );
    expect(at40[0]).toEqual([
      'Email',
      'Faculty (class owner)',
      'BE 2566',
      'BE 2567',
      'BE 2568',
      'Respondents',
      'Overall score',
      'Would qualify',
    ]);
    expect(at40[1]![0]).toBe('ghost@kku.ac.th');
    expect(at40[1]![7]).toBe('yes');
    expect(at40[2]![7]).toBe('no');

    const at49 = read(buildTalentWorkbook(FIXTURE, { threshold: 4.75, facultyName: [] })).rows(
      'Unmatched',
    );
    expect(at49[1]![7]).toBe('yes'); // 4.80 still clears 4.75
  });

  it('records window, threshold and both counts on About', () => {
    const about = read(buildTalentWorkbook(FIXTURE, { threshold: 4.25, facultyName: ['คณะแพทยศาสตร์'] })).rows(
      'About',
    );
    const flat = about.map((r) => r.join('=')).join('\n');
    expect(flat).toContain('teaching-talent.v1');
    expect(flat).toContain('BE 2566–2568');
    expect(flat).toContain('4.25');
    expect(flat).toContain('คณะแพทยศาสตร์');
    expect(flat).toContain('34566');
  });

  it('returns header-only sheets rather than throwing when nobody qualifies', () => {
    const wb = read(buildTalentWorkbook(FIXTURE, { threshold: 4.75, facultyName: [] }));
    expect(wb.rows('Talent')).toHaveLength(1);
    expect(wb.names).toEqual(['Talent', 'Unmatched', 'About']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter api exec vitest run test/teaching-talent-export.test.ts`
Expected: FAIL — cannot resolve `../src/staff-dashboard/teaching-talent-workbook`.

- [ ] **Step 3: Write the workbook builder**

Create `apps/api/src/staff-dashboard/teaching-talent-workbook.ts`:

```ts
import * as XLSX from 'xlsx';
import {
  classifyTalent,
  displayRating,
  splitPersonName,
  type TeachingTalentResult,
} from '@kku/db';

// Thai rank labels. The web app has its own maps
// (apps/web/src/lib/profile-data.ts) but apps/api cannot import from
// apps/web, so the labels are restated here.
const RANK_LABEL_TH: Record<string, string> = {
  LECTURER: 'อาจารย์',
  ASST_PROF: 'ผู้ช่วยศาสตราจารย์',
  ASSOC_PROF: 'รองศาสตราจารย์',
  PROF: 'ศาสตราจารย์',
};

export interface TalentWorkbookOptions {
  threshold: number;
  /** Faculty filter in force, for the About sheet. Empty = all faculties. */
  facultyName: string[];
  /** Injectable for deterministic tests. */
  generatedAt?: Date;
}

function ratingsOf(byYear: TeachingTalentResult['rows'][number]['byYear']) {
  const out: Record<string, number | null> = {};
  for (const [year, cell] of Object.entries(byYear)) out[year] = cell.ratingAvg;
  return out;
}

function score(value: number | null): number | string {
  return value === null ? '' : displayRating(value);
}

export function buildTalentWorkbook(
  result: TeachingTalentResult,
  opts: TalentWorkbookOptions,
): Buffer {
  const { years, unmatched } = result;
  const threshold = opts.threshold;
  const windowLabel =
    years.length > 0 ? `BE ${years[0]}–${years[years.length - 1]}` : 'no complete years';

  // ── Sheet 1: Talent ──────────────────────────────────────────────────
  const talents = result.rows
    .filter((r) => classifyTalent(ratingsOf(r.byYear), years, threshold).isTalent)
    .sort(
      (a, b) =>
        a.facultyName.localeCompare(b.facultyName, 'th') ||
        (b.overallRating ?? 0) - (a.overallRating ?? 0),
    );

  const talentRows: Array<Array<string | number>> = [
    [
      'Faculty',
      'Academic rank',
      'First name',
      'Last name',
      'Email',
      'Overall score',
      'Full name (EN)',
    ],
  ];
  for (const r of talents) {
    const name = splitPersonName(r.nameTh);
    talentRows.push([
      r.facultyName,
      RANK_LABEL_TH[r.rank] ?? r.rank,
      name.first,
      name.last,
      r.kkuEmail ?? '',
      score(r.overallRating),
      r.nameEn,
    ]);
  }
  const talentSheet = XLSX.utils.aoa_to_sheet(talentRows);
  talentSheet['!cols'] = [
    { wch: 28 }, { wch: 22 }, { wch: 18 }, { wch: 22 },
    { wch: 28 }, { wch: 13 }, { wch: 28 },
  ];

  // ── Sheet 2: Unmatched ───────────────────────────────────────────────
  // The reconciliation worklist. These teachers were evaluated but have no
  // HR record, so they cannot be named or exported as talents. Fixing this
  // means adding them to the kku-hr roster, not editing this dashboard.
  const unmatchedRows: Array<Array<string | number>> = [
    [
      'Email',
      'Faculty (class owner)',
      ...years.map((y) => `BE ${y}`),
      'Respondents',
      'Overall score',
      'Would qualify',
    ],
  ];
  const sortedUnmatched = [...unmatched.teachers].sort((a, b) => {
    const aq = classifyTalent(ratingsOf(a.byYear), years, threshold).isTalent ? 1 : 0;
    const bq = classifyTalent(ratingsOf(b.byYear), years, threshold).isTalent ? 1 : 0;
    return bq - aq || (b.overallRating ?? 0) - (a.overallRating ?? 0);
  });
  for (const t of sortedUnmatched) {
    unmatchedRows.push([
      t.kkuEmail,
      t.facultyName ?? '',
      ...years.map((y) => score(t.byYear[String(y)]?.ratingAvg ?? null)),
      t.totalRespondents,
      score(t.overallRating),
      classifyTalent(ratingsOf(t.byYear), years, threshold).isTalent ? 'yes' : 'no',
    ]);
  }
  const unmatchedSheet = XLSX.utils.aoa_to_sheet(unmatchedRows);
  unmatchedSheet['!cols'] = [
    { wch: 30 }, { wch: 28 },
    ...years.map(() => ({ wch: 11 })),
    { wch: 13 }, { wch: 13 }, { wch: 14 },
  ];

  // ── Sheet 3: About ───────────────────────────────────────────────────
  const aboutSheet = XLSX.utils.aoa_to_sheet([
    ['Field', 'Value'],
    ['Report', 'KKU Teaching and Learning Talent'],
    [
      'Rule',
      `Student-evaluation score of at least ${threshold.toFixed(2)} in every one of the last ${years.length} completed academic years`,
    ],
    ['Assessment window', windowLabel],
    ['Threshold', threshold],
    ['Semesters included', 'All (1, 2, summer and special terms)'],
    ['Faculty filter', opts.facultyName.length > 0 ? opts.facultyName.join(', ') : 'All faculties'],
    ['Instructors assessed', result.rows.length],
    ['Talents exported', talents.length],
    ['Evaluated teachers with no HR record', unmatched.teachers.length],
    ['Evaluation rows credited to no identifiable person', unmatched.unattributableRowCount],
    ['Methodology version', result.methodologyVersion],
    ['Generated at', (opts.generatedAt ?? new Date()).toISOString()],
  ]);
  aboutSheet['!cols'] = [{ wch: 44 }, { wch: 60 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, talentSheet, 'Talent');
  XLSX.utils.book_append_sheet(wb, unmatchedSheet, 'Unmatched');
  XLSX.utils.book_append_sheet(wb, aboutSheet, 'About');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/** `kku-teaching-talent-BE2566-2568-min4.00.xlsx` */
export function talentWorkbookFilename(years: number[], threshold: number): string {
  const window =
    years.length > 0 ? `BE${years[0]}-${years[years.length - 1]}` : 'no-window';
  return `kku-teaching-talent-${window}-min${threshold.toFixed(2)}.xlsx`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter api exec vitest run test/teaching-talent-export.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: Add the export route**

Append to `apps/api/src/staff-dashboard/teaching-talent.service.ts` (add the imports at
the top of the file):

```ts
import { TALENT_THRESHOLD_OPTIONS } from '@kku/db';
import { buildTalentWorkbook, talentWorkbookFilename } from './teaching-talent-workbook';
```

```ts
  async export(args: {
    facultyName: string[];
    threshold: number;
  }): Promise<{ filename: string; base64: string; rowCount: number; byteSize: number }> {
    const result = await teachingTalentRoster(
      { facultyName: args.facultyName },
      { includeContact: true, includeUnmatched: true },
    );
    const buffer = buildTalentWorkbook(result, {
      threshold: args.threshold,
      facultyName: args.facultyName,
    });
    // rowCount counts talents, not spreadsheet rows — it is what the audit
    // log and the About sheet both report.
    const rowCount = result.rows.filter((r) =>
      classifyTalent(
        Object.fromEntries(
          Object.entries(r.byYear).map(([y, c]) => [y, c.ratingAvg]),
        ),
        result.years,
        args.threshold,
      ).isTalent,
    ).length;
    return {
      filename: talentWorkbookFilename(result.years, args.threshold),
      base64: buffer.toString('base64'),
      rowCount,
      byteSize: buffer.byteLength,
    };
  }
```

Add `classifyTalent` and `teachingTalentRoster` to the existing `@kku/db` import in
that file, and re-export the threshold list for the controller's schema:

```ts
export const ALLOWED_TALENT_THRESHOLDS: readonly number[] = TALENT_THRESHOLD_OPTIONS;
```

Append to `apps/api/src/staff-dashboard/teaching-talent.controller.ts` (extend the
`@nestjs/common` import with `Body`, `ForbiddenException` and `Post`, and add
`AuditLog` to the `../common` import):

```ts
  // POST, not GET: the AuditLogInterceptor records request.body, so the
  // audit row captures exactly which filter and threshold produced the
  // file. Same posture as POST /programs/:id/export-detail-pdf.
  @Post('export')
  @Authorized('institution:read:dashboard')
  @AuditLog({ action: 'export.teaching_talent', entityType: 'StaffExport' })
  async exportXlsx(
    @AuthSession() user: SessionUser,
    @Body(new ZodValidationPipe(TalentExportSchema)) body: TalentExportBody,
  ) {
    await assertCanSeeFacultyDashboards(user);
    if (user.role === 'PROGRAM_USER') {
      // A single-row talent export has no use, and the button is hidden.
      throw new ForbiddenException('Talent export requires faculty scope');
    }
    const clamped = await clampFacultyNameFilter(
      { facultyName: body.facultyName },
      user,
    );
    const facultyName = clamped === null ? ['__none__'] : clamped.facultyName;
    return this.talent.export({ facultyName, threshold: body.threshold });
  }
```

with this schema beside `TalentQuerySchema`:

```ts
const TalentExportSchema = z.object({
  facultyName: z.array(z.string()).default([]),
  // Constrained to the published options — a crafted `threshold: 0` would
  // otherwise export the entire roster as "talent".
  threshold: z
    .number()
    .refine((n) => ALLOWED_TALENT_THRESHOLDS.includes(n), {
      message: 'threshold must be one of 4, 4.25, 4.5, 4.75',
    }),
});
type TalentExportBody = z.infer<typeof TalentExportSchema>;
```

and import `ALLOWED_TALENT_THRESHOLDS` from `./teaching-talent.service`.

- [ ] **Step 6: Typecheck and commit**

Run: `pnpm --filter api typecheck && pnpm --filter api exec vitest run test/teaching-talent-export.test.ts`
Expected: no typecheck output; 10 tests pass.

```bash
git add apps/api/src/staff-dashboard/teaching-talent-workbook.ts apps/api/src/staff-dashboard/teaching-talent.service.ts apps/api/src/staff-dashboard/teaching-talent.controller.ts apps/api/test/teaching-talent-export.test.ts
git commit -m "feat(api): teaching-talent xlsx export with unmatched worklist + about sheet"
```

---

## Task 5: DrillDownPivot — badge and 2-decimal format

**Files:**
- Modify: `apps/web/app/staff/drill-down-pivot.tsx`

Two small additions to the shared staff table so the talent page does not need a second
table implementation that would drift from the first.

- [ ] **Step 1: Extend the types**

In `apps/web/app/staff/drill-down-pivot.tsx`, replace the `DrillRow` and `DrillColumn`
interfaces (lines 12–24) with:

```ts
export interface DrillRowBadge {
  text: string;
  tone: 'success' | 'muted';
}

export interface DrillRow {
  label: string;
  emphasis?: 'warn' | 'success' | 'muted';
  /** Optional chip rendered after the label — e.g. a Talent marker. */
  badge?: DrillRowBadge;
  metrics: Record<string, number | null>;
  children?: DrillRow[];
}

export interface DrillColumn {
  key: string;
  label: string;
  format?: 'int' | 'decimal1' | 'decimal2' | 'thb' | 'raw';
  align?: 'left' | 'right';
}
```

- [ ] **Step 2: Handle the new format**

In the same file, in `fmt()`, add the `decimal2` branch immediately after the
`decimal1` branch:

```ts
  if (format === 'decimal2') return value.toFixed(2);
```

- [ ] **Step 3: Render the badge**

In `PivotRow`, replace the label `<td>` body so both the expandable and leaf branches
render the badge. The `<td>` becomes:

```tsx
        <td className="px-2 py-1" style={{ paddingLeft: 8 + padPx }}>
          {hasChildren ? (
            <button
              type="button"
              onClick={() => toggle(path)}
              className="inline-flex items-center gap-1 hover:text-accent"
            >
              <ChevronRight
                className={`h-3 w-3 transition-transform ${isOpen ? 'rotate-90' : ''}`}
              />
              <span className="truncate" title={row.label}>
                {row.label}
              </span>
            </button>
          ) : (
            <span className="ml-4 truncate" title={row.label}>
              {row.label}
            </span>
          )}
          {row.badge && (
            <span
              className={`ml-2 inline-block rounded px-1.5 py-0.5 text-[0.6rem] font-medium ${
                row.badge.tone === 'success'
                  ? 'bg-success-subtle text-success-default'
                  : 'bg-surface-2 text-text-tertiary'
              }`}
            >
              {row.badge.text}
            </span>
          )}
        </td>
```

Note the token names: `--color-success-default` exists, plain `--color-success` does
not — a wrong token renders as a black block.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: no output. (No existing caller passes `badge`, and `decimal2` is additive, so
`/staff/compensation`, `/staff/research` and `/staff/faculty-by-program` are unaffected.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/staff/drill-down-pivot.tsx
git commit -m "feat(web): DrillDownPivot supports row badges and 2-decimal columns"
```

---

## Task 6: The page

**Files:**
- Create: `apps/web/app/staff/teaching-talent/page.tsx`
- Create: `apps/web/app/staff/teaching-talent/client.tsx`

- [ ] **Step 1: Write the server component**

Create `apps/web/app/staff/teaching-talent/page.tsx`:

```tsx
import { redirect } from 'next/navigation';
import { canSeeProgramAwareDashboards, type SessionUser } from '@kku/shared';
import { auth } from '@/lib/auth';
import { apiFetchSafe } from '@/lib/api-client';
import { AuthedAppShell } from '@/components/shell/app-shell-server';
import { DiagnosticEmptyState } from '@/components/diagnostic-empty-state';
import { PageHeader } from '@kku/ui';
import { StaffBackLink } from '../back-link';
import { TeachingTalentClient, type TalentResponse } from './client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Teaching and learning talent — Staff' };

type SP = Record<string, string | string[] | undefined>;
function arr(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

export default async function TeachingTalentPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) redirect('/signin');
  const role = user.effectiveRole ?? user.role;
  if (!canSeeProgramAwareDashboards(role)) redirect('/no-access');

  const sp = await searchParams;
  const facultyName = arr(sp.facultyName);
  const thresholdRaw = Number(Array.isArray(sp.threshold) ? sp.threshold[0] : sp.threshold);
  const threshold = [4, 4.25, 4.5, 4.75].includes(thresholdRaw) ? thresholdRaw : 4;
  const talentsOnly = (Array.isArray(sp.talentsOnly) ? sp.talentsOnly[0] : sp.talentsOnly) === '1';

  const qs = new URLSearchParams();
  facultyName.forEach((v) => qs.append('facultyName', v));
  const res = await apiFetchSafe<TalentResponse>(
    `/staff/teaching-talent${qs.toString() ? `?${qs}` : ''}`,
  );

  return (
    <AuthedAppShell user={user}>
      <StaffBackLink />
      <PageHeader
        title="Teaching and learning talent"
        subtitle="Instructors students rate highly year after year. A talent cleared the threshold in every one of the last three completed academic years — sustained quality, not one good semester. Every evaluated instructor is included, whether or not their courses are mapped to a curriculum."
      />
      {res.ok ? (
        <TeachingTalentClient
          data={res.data}
          initialFilters={{ facultyName, threshold, talentsOnly }}
        />
      ) : (
        <DiagnosticEmptyState surface="teaching talent" error={res.error} />
      )}
    </AuthedAppShell>
  );
}
```

- [ ] **Step 2: Write the client component**

Create `apps/web/app/staff/teaching-talent/client.tsx`:

```tsx
'use client';

// /staff/teaching-talent — sustained student-evaluation quality.
//
// The threshold is applied HERE, not on the server: the API returns each
// person's per-year ratings, so moving the selector re-badges instantly
// with no refetch. The export route applies the same rule server-side.

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@kku/ui';
import { ChevronDown, ChevronRight, Download } from 'lucide-react';
import { MultiSelectField } from '../multi-select';
import { DrillDownPivot, type DrillColumn, type DrillRow } from '../drill-down-pivot';

const THRESHOLDS = [4, 4.25, 4.5, 4.75] as const;
const WINDOW_YEARS = 3;

const RANK_ABBREV_TH: Record<string, string> = {
  LECTURER: 'อ.',
  ASST_PROF: 'ผศ.',
  ASSOC_PROF: 'รศ.',
  PROF: 'ศ.',
};

interface YearCell {
  ratingAvg: number | null;
  respondentCount: number;
}

interface InstructorRow {
  facultyMemberId: string;
  nameTh: string;
  nameEn: string;
  rank: string;
  facultyId: string;
  facultyName: string;
  isActive: boolean;
  overallRating: number | null;
  totalRespondents: number;
  courseCount: number;
  byYear: Record<string, YearCell>;
  yearsWithData: number;
  minYearRating: number | null;
}

interface UnmatchedRow {
  kkuEmail: string;
  facultyName: string | null;
  overallRating: number | null;
  totalRespondents: number;
  byYear: Record<string, YearCell>;
  yearsWithData: number;
  minYearRating: number | null;
}

export interface TalentResponse {
  methodologyVersion: string;
  years: number[];
  windowComplete: boolean;
  rows: InstructorRow[];
  unmatched: { teachers: UnmatchedRow[]; unattributableRowCount: number };
  scope?: 'own' | 'scoped' | 'full';
}

/** Mirrors classifyTalent() in @kku/db — compare on the displayed value.
 *  (Duplicated deliberately: @kku/shared and @kku/db have no exports map,
 *  so a runtime import from a client component pulls a node:crypto barrel
 *  and breaks the build. Same posture as apps/web/src/lib/format-cohort.ts.) */
function isTalent(byYear: Record<string, YearCell>, years: number[], threshold: number): boolean {
  if (years.length !== WINDOW_YEARS) return false;
  for (const year of years) {
    const rating = byYear[String(year)]?.ratingAvg;
    if (rating === null || rating === undefined) return false;
    if (Math.round(rating * 100) / 100 < threshold) return false;
  }
  return true;
}

function weightedMean(values: Array<{ rating: number | null; respondents: number }>): number | null {
  let weighted = 0;
  let respondents = 0;
  for (const v of values) {
    if (v.rating === null) continue;
    weighted += v.rating * v.respondents;
    respondents += v.respondents;
  }
  return respondents > 0 ? weighted / respondents : null;
}

export function TeachingTalentClient({
  data,
  initialFilters,
}: {
  data: TalentResponse;
  initialFilters: { facultyName: string[]; threshold: number; talentsOnly: boolean };
}) {
  const router = useRouter();
  const [faculty, setFaculty] = React.useState<string[]>(initialFilters.facultyName);
  const [threshold, setThreshold] = React.useState<number>(initialFilters.threshold);
  const [talentsOnly, setTalentsOnly] = React.useState<boolean>(initialFilters.talentsOnly);
  const [coverageOpen, setCoverageOpen] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);
  const [exportError, setExportError] = React.useState<string | null>(null);

  const { years, rows, unmatched } = data;
  const ownScope = data.scope === 'own';

  const push = (next: { faculty?: string[]; threshold?: number; talentsOnly?: boolean }) => {
    const params = new URLSearchParams();
    (next.faculty ?? faculty).forEach((v) => params.append('facultyName', v));
    const t = next.threshold ?? threshold;
    if (t !== 4) params.set('threshold', String(t));
    if (next.talentsOnly ?? talentsOnly) params.set('talentsOnly', '1');
    router.push(`/staff/teaching-talent${params.toString() ? `?${params}` : ''}`);
  };

  const talentIds = React.useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (isTalent(r.byYear, years, threshold)) set.add(r.facultyMemberId);
    return set;
  }, [rows, years, threshold]);

  const eligibleCount = React.useMemo(
    () => rows.filter((r) => r.yearsWithData === WINDOW_YEARS).length,
    [rows],
  );
  const unmatchedQualifying = React.useMemo(
    () => unmatched.teachers.filter((t) => isTalent(t.byYear, years, threshold)).length,
    [unmatched.teachers, years, threshold],
  );

  const facultyOptions = React.useMemo(
    () => [...new Set(rows.map((r) => r.facultyName))].map((f) => ({ value: f, label: f })),
    [rows],
  );

  const columns: DrillColumn[] = React.useMemo(
    () => [
      { key: 'overall', label: 'Overall', format: 'decimal2' },
      { key: 'respondents', label: 'Respondents', format: 'int' },
      ...years.map((y): DrillColumn => ({ key: `y${y}`, label: `BE ${y}`, format: 'decimal2' })),
    ],
    [years],
  );

  const drillRows: DrillRow[] = React.useMemo(() => {
    const byFaculty = new Map<string, InstructorRow[]>();
    for (const r of rows) {
      if (talentsOnly && !talentIds.has(r.facultyMemberId)) continue;
      const list = byFaculty.get(r.facultyName) ?? [];
      list.push(r);
      byFaculty.set(r.facultyName, list);
    }
    return [...byFaculty.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], 'th'))
      .map(([facultyName, members]) => {
        const facultyMetrics: DrillRow['metrics'] = {
          overall: weightedMean(
            members.map((m) => ({ rating: m.overallRating, respondents: m.totalRespondents })),
          ),
          respondents: members.reduce((a, m) => a + m.totalRespondents, 0),
          talents: members.filter((m) => talentIds.has(m.facultyMemberId)).length,
        };
        for (const y of years) {
          facultyMetrics[`y${y}`] = weightedMean(
            members.map((m) => ({
              rating: m.byYear[String(y)]?.ratingAvg ?? null,
              respondents: m.byYear[String(y)]?.respondentCount ?? 0,
            })),
          );
        }
        return {
          label: facultyName,
          badge: {
            text: `${facultyMetrics.talents} talent${facultyMetrics.talents === 1 ? '' : 's'} / ${members.filter((m) => m.yearsWithData === WINDOW_YEARS).length} eligible`,
            tone: 'muted' as const,
          },
          metrics: facultyMetrics,
          children: members
            .sort((a, b) => (b.overallRating ?? 0) - (a.overallRating ?? 0))
            .map((m): DrillRow => {
              const metrics: DrillRow['metrics'] = {
                overall: m.overallRating,
                respondents: m.totalRespondents,
              };
              for (const y of years) metrics[`y${y}`] = m.byYear[String(y)]?.ratingAvg ?? null;
              const talent = talentIds.has(m.facultyMemberId);
              return {
                label: `${RANK_ABBREV_TH[m.rank] ?? ''} ${m.nameTh}`.trim(),
                emphasis: talent ? 'success' : undefined,
                badge: talent
                  ? { text: 'Talent', tone: 'success' }
                  : m.yearsWithData < WINDOW_YEARS
                    ? { text: `${m.yearsWithData}/${WINDOW_YEARS} years`, tone: 'muted' }
                    : undefined,
                metrics,
              };
            }),
        };
      });
  }, [rows, years, talentIds, talentsOnly]);

  async function runExport() {
    setExporting(true);
    setExportError(null);
    try {
      const res = await fetch('/api/staff-talent-export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facultyName: faculty, threshold }),
      });
      if (!res.ok) throw new Error(`Export failed (HTTP ${res.status})`);
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') ?? '';
      const match = /filename="([^"]+)"/.exec(disposition);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = match?.[1] ?? 'kku-teaching-talent.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError((err as Error).message);
    } finally {
      setExporting(false);
    }
  }

  const windowLabel =
    years.length > 0 ? `BE ${years[0]}–${years[years.length - 1]}` : 'no complete years';

  return (
    <div className="flex flex-col gap-4">
      {!data.windowComplete && (
        <Card>
          <p className="text-xs text-warning-default">
            The talent rule needs {WINDOW_YEARS} completed academic years. Only{' '}
            {years.length} carry evaluation data ({windowLabel}), so nobody is badged. The
            table below still shows the years available.
          </p>
        </Card>
      )}

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <MultiSelectField
            label="Faculty"
            options={facultyOptions}
            selected={faculty}
            onChange={(vs) => {
              setFaculty(vs);
              push({ faculty: vs });
            }}
          />
          <div className="flex flex-col gap-1">
            <span className="text-[0.65rem] uppercase tracking-wide text-text-tertiary">
              Talent threshold
            </span>
            <div className="flex gap-1">
              {THRESHOLDS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setThreshold(t);
                    push({ threshold: t });
                  }}
                  className={`rounded border px-2 py-1 text-xs ${
                    threshold === t
                      ? 'border-accent bg-accent-subtle text-accent'
                      : 'border-border-subtle bg-surface-1 text-text-secondary hover:bg-surface-2'
                  }`}
                >
                  {t.toFixed(2)}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs text-text-secondary">
            <input
              type="checkbox"
              checked={talentsOnly}
              onChange={(e) => {
                setTalentsOnly(e.target.checked);
                push({ talentsOnly: e.target.checked });
              }}
            />
            Talents only
          </label>
          {!ownScope && (
            <button
              type="button"
              onClick={runExport}
              disabled={exporting || talentIds.size === 0}
              className="ml-auto inline-flex items-center gap-1.5 rounded border border-border-subtle bg-surface-1 px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-2 disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              {exporting ? 'Preparing…' : `Export ${talentIds.size} talents (xlsx)`}
            </button>
          )}
        </div>
        {exportError && <p className="mt-2 text-xs text-danger-default">{exportError}</p>}
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Talents" value={String(talentIds.size)} hint={`at ${threshold.toFixed(2)} and above`} />
        <Kpi label="Eligible" value={String(eligibleCount)} hint={`have all ${WINDOW_YEARS} years`} />
        <Kpi label="Instructors assessed" value={String(rows.length)} hint="any evaluation in window" />
        <Kpi label="Window" value={windowLabel} hint="completed academic years" />
      </div>

      <Card>
        <DrillDownPivot
          rows={drillRows}
          columns={columns}
          rowHeaderLabel="Faculty / staff"
          maxDepth={2}
        />
      </Card>

      {!ownScope && (
        <Card>
          <button
            type="button"
            onClick={() => setCoverageOpen((v) => !v)}
            className="flex w-full items-center gap-1.5 text-left text-xs font-medium hover:text-accent"
          >
            {coverageOpen ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            Coverage — {unmatched.teachers.length} evaluated teachers have no HR record
            {unmatchedQualifying > 0 && `, ${unmatchedQualifying} of whom would qualify`}
          </button>
          <p className="mt-2 text-xs text-text-secondary">
            {rows.length} evaluated instructors are in the table above. A further{' '}
            {unmatched.teachers.length} teachers were evaluated but match no HR record, so they
            cannot be named or exported.{' '}
            {unmatched.unattributableRowCount.toLocaleString('en-US')} evaluation rows are
            credited to no identifiable person. Fixing this means adding these people to the
            HR-sourced roster (the <code>kku-hr</code> connector), not editing this dashboard.
          </p>
          {coverageOpen && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-border-subtle text-left text-[0.65rem] uppercase tracking-wide text-text-tertiary">
                    <th className="px-2 py-1.5 font-medium">Email</th>
                    <th className="px-2 py-1.5 font-medium">Faculty (class owner)</th>
                    {years.map((y) => (
                      <th key={y} className="px-2 py-1.5 text-right font-medium">
                        BE {y}
                      </th>
                    ))}
                    <th className="px-2 py-1.5 text-right font-medium">Respondents</th>
                    <th className="px-2 py-1.5 text-right font-medium">Overall</th>
                    <th className="px-2 py-1.5 font-medium">Would qualify</th>
                  </tr>
                </thead>
                <tbody>
                  {[...unmatched.teachers]
                    .sort((a, b) => {
                      const aq = isTalent(a.byYear, years, threshold) ? 1 : 0;
                      const bq = isTalent(b.byYear, years, threshold) ? 1 : 0;
                      return bq - aq || (b.overallRating ?? 0) - (a.overallRating ?? 0);
                    })
                    .map((t) => (
                      <tr key={t.kkuEmail} className="border-b border-border-subtle">
                        <td className="px-2 py-1">{t.kkuEmail}</td>
                        <td className="px-2 py-1">{t.facultyName ?? '—'}</td>
                        {years.map((y) => (
                          <td key={y} className="px-2 py-1 text-right font-tabular">
                            {t.byYear[String(y)]?.ratingAvg?.toFixed(2) ?? '—'}
                          </td>
                        ))}
                        <td className="px-2 py-1 text-right font-tabular">
                          {t.totalRespondents.toLocaleString('en-US')}
                        </td>
                        <td className="px-2 py-1 text-right font-tabular">
                          {t.overallRating?.toFixed(2) ?? '—'}
                        </td>
                        <td className="px-2 py-1">
                          {isTalent(t.byYear, years, threshold) ? 'yes' : 'no'}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <p className="text-xs text-text-tertiary">
        A talent scored {threshold.toFixed(2)} or above in every one of the last{' '}
        {WINDOW_YEARS} completed academic years ({windowLabel}), across all semesters,
        respondent-weighted. Grouped by the instructor&apos;s home faculty — curriculum
        mapping does not gate this list. Methodology {data.methodologyVersion}. For the
        question-by-question detail behind any rating, see Teaching evaluations.
      </p>
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card>
      <p className="text-[0.65rem] uppercase tracking-wide text-text-tertiary">{label}</p>
      <p className="mt-1 text-xl font-semibold font-tabular">{value}</p>
      <p className="mt-0.5 text-[0.65rem] text-text-tertiary">{hint}</p>
    </Card>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/staff/teaching-talent/
git commit -m "feat(web): teaching-talent dashboard page with threshold selector and coverage panel"
```

---

## Task 7: The export route handler

**Files:**
- Create: `apps/web/app/api/staff-talent-export/route.ts`

- [ ] **Step 1: Write the route**

Create `apps/web/app/api/staff-talent-export/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { apiFetch } from '@/lib/api-client';
import { auth } from '@/lib/auth';
import type { SessionUser } from '@kku/shared';

// Teaching-talent XLSX export — POSTs to the API, which returns the
// workbook base64-encoded inside the standard response envelope, then
// streams the decoded bytes to the browser. Proxying (rather than handing
// the browser an API URL) keeps the download rooted at the dev server's
// own origin — the same reason admin-program-export proxies its PDF.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body: unknown = await req.json().catch(() => null);
  const parsed =
    body && typeof body === 'object'
      ? (body as { facultyName?: unknown; threshold?: unknown })
      : {};
  const facultyName = Array.isArray(parsed.facultyName)
    ? parsed.facultyName.filter((v): v is string => typeof v === 'string')
    : [];
  const threshold = typeof parsed.threshold === 'number' ? parsed.threshold : 4;

  const result = await apiFetch<{
    filename: string;
    base64: string;
    rowCount: number;
    byteSize: number;
  }>('/staff/teaching-talent/export', {
    method: 'POST',
    body: JSON.stringify({ facultyName, threshold }),
  });

  const bytes = Buffer.from(result.base64, 'base64');
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${result.filename}"`,
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'private, no-store',
    },
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: no output.

- [ ] **Step 3: Verify end to end in the browser**

Start the stack if it is not running: `pnpm dev` (repo root). Sign in, then open
`http://localhost:3000/staff/teaching-talent`.

Check all of the following:
1. The KPI strip reads **Talents 1243 · Eligible 1339 · Instructors assessed 1695 ·
   Window BE 2566–2568** (an admin / university-wide account, no faculty filter).
   **If "Instructors assessed" reads 1130, a curriculum join crept in — stop.**
2. Clicking `4.50` changes Talents to **592** without a full page reload flash.
3. Expanding a faculty shows staff rows; talent rows are tinted and badged.
4. The coverage line reads **271 evaluated teachers have no HR record, 98 of whom
   would qualify** at threshold 4.00; expanding lists them.
5. Clicking Export downloads a `.xlsx`; opening it shows three sheets, Thai names split
   across First/Last name, and the About sheet's window and threshold.
6. Verify the audit row landed:
   ```bash
   docker exec program-landscape-postgres psql -U kku -d program_landscape \
     -c "SELECT action, payload_json FROM audit_logs WHERE action='export.teaching_talent' ORDER BY created_at DESC LIMIT 1;"
   ```
   Expected: one row whose payload carries the `threshold` and `facultyName` used.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/api/staff-talent-export/route.ts
git commit -m "feat(web): stream the teaching-talent xlsx through a same-origin route"
```

---

## Task 8: Hub tile and thumbnail

**Files:**
- Modify: `apps/web/app/staff/thumbnails.tsx`
- Modify: `apps/web/app/staff/page.tsx`

- [ ] **Step 1: Add the thumbnail**

Append to `apps/web/app/staff/thumbnails.tsx` (it already defines `Frame` and
`PALETTE` used by the sibling thumbs):

```tsx
export function TeachingTalentThumb() {
  // Three years of bars per person; the middle person clears the line in
  // all three, so they carry the star.
  const people = [
    { x: 24, bars: [30, 22, 34], star: false },
    { x: 92, bars: [40, 44, 42], star: true },
    { x: 160, bars: [20, 34, 16], star: false },
  ];
  return (
    <Frame>
      <text x={120} y={14} textAnchor="middle" fontSize="9" fontWeight="600" fill={PALETTE.ink} opacity={0.7}>
        Three years above the bar
      </text>
      {/* Threshold line */}
      <line x1={12} y1={70} x2={228} y2={70} stroke={PALETTE.ink} strokeWidth={0.8} strokeDasharray="3 2" opacity={0.5} />
      {people.map((p) => (
        <g key={p.x}>
          {p.bars.map((h, i) => (
            <rect
              key={i}
              x={p.x + i * 16}
              y={100 - h}
              width={12}
              height={h}
              rx={2}
              fill={p.star ? PALETTE.accent : PALETTE.ink}
              opacity={p.star ? 0.85 : 0.3}
            />
          ))}
          {p.star && (
            <polygon
              points="0,-4 1.2,-1.3 4,-1.3 1.7,0.6 2.6,3.6 0,1.8 -2.6,3.6 -1.7,0.6 -4,-1.3 -1.2,-1.3"
              transform={`translate(${p.x + 22}, 40)`}
              fill={PALETTE.warm}
              opacity={0.95}
            />
          )}
        </g>
      ))}
    </Frame>
  );
}
```

`Frame` (a local component wrapping a `240 × 120` SVG) and `PALETTE` (`bg`, `ink`,
`accent`, `pop`, `cool`, `warm`, `ok`) are defined at the top of that file — verified,
no import needed. These thumbnails use literal hex from `PALETTE` rather than design
tokens, matching the six existing thumbs; that is the established exception in this
one file.

- [ ] **Step 2: Add the tile**

In `apps/web/app/staff/page.tsx`, add `Award` to the `lucide-react` import, add
`TeachingTalentThumb` to the `./thumbnails` import, and append this entry to `TILES`
after the `/staff/teaching` entry:

```ts
  {
    href: '/staff/teaching-talent',
    icon: Award,
    title: 'Teaching and learning talent',
    blurb:
      'Who students rate highly year after year. A talent cleared the chosen bar in every one of the last three completed academic years — sustained quality, not one good semester. Covers every evaluated instructor, mapped to a curriculum or not, and exports the qualifying list to Excel.',
    Thumb: TeachingTalentThumb,
    programAware: true,
  },
```

- [ ] **Step 3: Verify**

Run: `pnpm --filter web typecheck`
Expected: no output.

Open `http://localhost:3000/staff` — the new tile renders with its thumbnail and links
to the dashboard.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/staff/page.tsx apps/web/app/staff/thumbnails.tsx
git commit -m "feat(web): teaching-talent tile on the staff hub"
```

---

## Task 9: Changelog and full verification

**Files:**
- Modify: `apps/web/app/changelog/page.tsx`

- [ ] **Step 1: Add the changelog entry**

In `apps/web/app/changelog/page.tsx`, insert this as the **first** element of the
`ENTRIES` array, above the `v1.7.0` entry. Replace the counts with the numbers your own
browser check produced in Task 7 if they differ.

```ts
  {
    date: '2026-08-24',
    version: 'v1.8.0 · Teaching and learning talent',
    title:
      'A new Staff dashboard identifies instructors students rate highly year after year — and, unlike the evaluation dashboard, it covers every evaluated instructor rather than only those whose courses are mapped to a curriculum',
    audience: ['Executive', 'Analyst', 'Admin'],
    bullets: [
      'New "Teaching and learning talent" dashboard (Staff → Teaching and learning talent): drill from faculty to individual staff, showing each person’s overall student-evaluation score, how many students answered, and their score in each of the last three completed academic years.',
      'A talent is someone who scored at or above the chosen bar in EVERY one of those three years — sustained quality, not one good semester. Someone with only two years of evidence is shown with their years and marked "2/3 years", never badged, so a new arrival is never mistaken for an underperformer.',
      'The bar is adjustable (4.00, 4.25, 4.50, 4.75) because Thai evaluation scores cluster high: at 4.00 the list runs to 1,243 people, at 4.50 to 592, at 4.75 to 139. The filter, the bar and the talents-only toggle all live in the page address, so a particular view can be shared as a link.',
      'This dashboard counts every evaluated instructor — 1,695 of them — where Teaching evaluations shows only the 1,130 whose courses are mapped to a program. A third of the teaching roster was invisible to that view; it is not invisible here.',
      'Export to Excel: the qualifying staff with faculty, academic rank, first and last name, email and overall score, ready for HR, awards and development programmes.',
      'The page reports its own coverage rather than hiding it: 271 teachers were evaluated but match no HR record (98 of whom would qualify), and a further body of evaluation rows is credited to no identifiable person. They are listed as a reconciliation worklist on the page and in the export, so the gap can be fixed at source.',
      'All semesters count, including summer and special terms, and every score is weighted by how many students answered.',
    ],
  },
```

If the user later tags this work under a different version, update the `version` string
to match — nothing else in the entry depends on it.

- [ ] **Step 2: Run the full check**

Run: `pnpm check`
Expected: lint, typecheck and the full test suite pass. Two notes:

- `pnpm lint` runs repo-wide and has a known pre-existing backlog. Only failures in the
  files this plan touched are yours. If a file you touched has a pre-existing lint error
  (unregistered rule directives, invalid escapes), fix it — CI lints changed files, so
  it becomes a failure the moment you touch the file.
- Test count should be the previous total plus the 20 db tests and 10 api tests added
  here.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/changelog/page.tsx
git commit -m "docs(changelog): teaching and learning talent dashboard"
```

- [ ] **Step 4: Report, do not deploy**

Summarise for the user: files added, the measured numbers from the browser check, test
counts, and anything deferred. **Do not run `pnpm build:release`** — builds happen only
when the user explicitly asks.

---

## Done criteria

- [ ] `/staff/teaching-talent` lists 1,695 instructors (not 1,130) with a working
      threshold selector, talents-only toggle and faculty filter, all URL-shareable.
- [ ] The population guard test passes and would fail if a `program_courses` join were
      reintroduced.
- [ ] Export downloads a three-sheet workbook; the audit row records threshold and
      faculty filter.
- [ ] The coverage panel reports the 271 unmatched teachers and the unattributable row
      count from live data, never hard-coded.
- [ ] `pnpm check` passes; no existing `/staff/teaching` behaviour changed.
