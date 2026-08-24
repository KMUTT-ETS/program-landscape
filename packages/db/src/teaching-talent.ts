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

import { Prisma } from '@prisma/client';
import { prisma } from './index';
import { getAcademicYearContext } from './academic-year';

export const TEACHING_TALENT_METHODOLOGY_VERSION = 'teaching-talent.v1';
export const TALENT_THRESHOLD_OPTIONS = [4.0, 4.25, 4.5, 4.75] as const;
export const TALENT_DEFAULT_THRESHOLD = 4.0;
export const TALENT_WINDOW_YEARS = 3;

/** Round to the 2 decimals the UI prints. Talent comparisons run on this
 *  value, never on the raw float — a printed "4.00" beside a missing
 *  badge is not explainable to a dean.
 *
 *  Defined via toFixed because the UI prints with toFixed(2): this
 *  function's whole job is to compare on the value the reader SEES.
 *  Math.round(v * 100) / 100 is not equivalent — it disagrees at
 *  4.005 (4.01 vs the printed 4.00) — and "more correct rounding"
 *  would be the wrong goal here. */
export function displayRating(value: number): number {
  return Number(value.toFixed(2));
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
  // Dedupe first: real call sites always pass years from
  // resolveTalentYears() (already deduped), but this function is
  // exported to three planned call sites. Without this, a duplicated
  // year (e.g. [2566, 2566, 2568] when 2567 is genuinely missing) would
  // let `present.length` reach TALENT_WINDOW_YEARS on only two distinct
  // years, forging a complete window and a false isTalent: true.
  const windowYears = [...new Set(years)];
  const present: number[] = [];
  for (const year of windowYears) {
    const value = byYear[String(year)];
    if (value !== null && value !== undefined) present.push(displayRating(value));
  }
  const minYearRating = present.length > 0 ? Math.min(...present) : null;
  const isTalent =
    windowYears.length === TALENT_WINDOW_YEARS &&
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
  // Safe: the length check above guarantees at least one token exists.
  return { first: tokens[0]!, last: tokens.slice(1).join(' ') };
}

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
  // NO curriculum-mapping join — see the module header.
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
    // Safe: every key in matchedFolded came from a row that also seeded
    // `identity` in the loop above.
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
