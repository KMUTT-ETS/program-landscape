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
  /** Peak distinct courses in a single window year — NOT distinct across the window. */
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

/**
 * Faculty-name WHERE fragment, built FRESH at every call site.
 *
 * Do not hoist this into a shared `const` and splice the same object into
 * several `$queryRaw` calls: this repo has an incident on exactly that
 * pattern — intermittent `syntax error at or near "$1"` from parameter-index
 * drift in Prisma's SQL builder (see `dashboard-overview.ts:184-189`). The
 * sibling `evaluations.ts` `scopeClause()` is the house pattern.
 *
 * `facultyNameColumn` also has to be per-call because the alias `f` does
 * NOT mean the same thing everywhere: in the matched query it is the
 * instructor's HOME faculty (via `faculty_members.faculty_id`), in the
 * unmatched/unattributable queries it is the CLASS's owning faculty (via
 * `evaluation_response_summaries.faculty_id`). Naming the column at each
 * site makes each query state what it clamps on.
 *
 * `facultyNameColumn` is a trusted literal written by this module, never
 * user input — the faculty NAMES are parameterised.
 */
function facultyClauseFor(
  names: string[] | undefined,
  facultyNameColumn: string,
): Prisma.Sql {
  if (!names) return Prisma.empty;
  return Prisma.sql`AND ${Prisma.raw(facultyNameColumn)} = ANY(${names}::text[])`;
}

/** Fold (person × year) aggregate rows into one row per person. Shared by
 *  the matched and unmatched paths — the arithmetic is identical, only the
 *  identity columns differ.
 *
 *  Exported for test: the merge branch (same key, same year, two source
 *  rows) is only reachable on the unmatched path in production. */
export function foldYearCells(
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
export function overallFromYears(byYear: Record<string, TalentYearCell>): number | null {
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
/**
 * Resolve the assessment window: the most recent completed academic years
 * that carry data, capped at `TALENT_WINDOW_YEARS`.
 *
 * Shared by the roster and by the single-person stamp on /profile. They
 * MUST assess the same years — a profile that claimed a badge the
 * dashboard withholds (or vice versa) would be worse than no badge at
 * all. Deliberately global, never faculty-clamped, so every caller sees
 * the same window.
 */
async function resolveWindow(): Promise<{ years: number[]; windowComplete: boolean }> {
  const { currentAcademicYearBE } = await getAcademicYearContext();
  const yearRows = await prisma.$queryRaw<Array<{ acad_year_be: number }>>`
    SELECT DISTINCT e.acad_year_be
    FROM evaluation_response_summaries e
    JOIN ingestion_runs ir ON ir.id = e.ingestion_run_id
    JOIN data_sources ds ON ds.id = ir.data_source_id
    WHERE ds.mocked = false
      AND e.acad_year_be < ${currentAcademicYearBE}
      -- Explicit lower bound: DISTINCT resolves before LIMIT, so without a
      -- range predicate a hash-aggregate plan scans the whole table to learn
      -- three integers. Twelve years is far more history than the 3-year
      -- window needs, so this can never truncate the answer.
      AND e.acad_year_be >= ${currentAcademicYearBE - 12}
    ORDER BY e.acad_year_be DESC
    LIMIT 12
  `;
  const years = resolveTalentYears(
    yearRows.map((r) => r.acad_year_be),
    currentAcademicYearBE,
  );
  return { years, windowComplete: years.length === TALENT_WINDOW_YEARS };
}

export async function teachingTalentRoster(
  filter: TeachingTalentFilter | undefined,
  opts: TeachingTalentOptions = {},
): Promise<TeachingTalentResult> {
  const facultyNames =
    filter?.facultyName && filter.facultyName.length > 0 ? filter.facultyName : undefined;

  // ── 1. Resolve the window ────────────────────────────────────────────
  const { years, windowComplete } = await resolveWindow();

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
      ${facultyClauseFor(facultyNames, 'f.name_th')}
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
  //
  // Arithmetic consequence of that clamp, worth stating plainly: a matched
  // instructor keeps ALL their rows no matter which faculty owned the
  // class (they are clamped on their HOME faculty), whereas an unmatched
  // teacher is clamped on the CLASS's faculty. So under a faculty filter
  // the two populations on this page are measured over different
  // denominators — matched ratings are university-wide per person,
  // unmatched ratings cover only the filtered faculty's classes.
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
      ${facultyClauseFor(facultyNames, 'f.name_th')}
    GROUP BY lower(trim(e.kkumail_raw)), f.name_th, e.acad_year_be
    ORDER BY f.name_th, lower(trim(e.kkumail_raw))
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
  // carries the most respondents. Totals are accumulated ACROSS the
  // window's years before comparing — comparing single (faculty × year)
  // cells would let 1 year × 50 respondents beat 3 years × 40.
  const facultyTotals = new Map<string, Map<string | null, number>>();
  for (const r of unmatchedCells) {
    let perFaculty = facultyTotals.get(r.kku_email);
    if (!perFaculty) {
      perFaculty = new Map<string | null, number>();
      facultyTotals.set(r.kku_email, perFaculty);
    }
    perFaculty.set(r.faculty_name, (perFaculty.get(r.faculty_name) ?? 0) + Number(r.respondents));
  }
  const facultyByEmail = new Map<string, string | null>();
  for (const [email, perFaculty] of facultyTotals) {
    let best: string | null = null;
    let bestRespondents = -1;
    for (const [name, respondents] of perFaculty) {
      if (respondents > bestRespondents) {
        best = name;
        bestRespondents = respondents;
      }
    }
    facultyByEmail.set(email, best);
  }

  const teachers: UnmatchedTeacherRow[] = [];
  for (const [kkuEmail, folded] of unmatchedFolded) {
    const ratings: Record<string, number | null> = {};
    for (const [year, cell] of Object.entries(folded.byYear)) ratings[year] = cell.ratingAvg;
    const cls = classifyTalent(ratings, years, TALENT_DEFAULT_THRESHOLD);
    teachers.push({
      kkuEmail,
      facultyName: facultyByEmail.get(kkuEmail) ?? null,
      overallRating: overallFromYears(folded.byYear),
      totalRespondents: folded.totalRespondents,
      byYear: folded.byYear,
      yearsWithData: cls.yearsWithData,
      minYearRating: cls.minYearRating,
    });
  }

  // ── 4. Rows attributable to nobody ───────────────────────────────────
  // Clamped on the CLASS's faculty, exactly like the unmatched query above
  // (same NULL-faculty trade-off). This panel's whole job is honest
  // coverage, so a dean scoped to one faculty must not read a
  // university-wide "credited to nobody" figure beside their own clamped
  // roster.
  const [unattributable] = await prisma.$queryRaw<Array<{ c: bigint }>>`
    SELECT COUNT(*)::bigint AS c
    FROM evaluation_response_summaries e
    JOIN ingestion_runs ir ON ir.id = e.ingestion_run_id
    JOIN data_sources ds ON ds.id = ir.data_source_id
    LEFT JOIN faculties f ON f.id = e.faculty_id
    WHERE ds.mocked = false
      AND e.faculty_member_id IS NULL
      AND e.kkumail_raw IS NULL
      AND e.acad_year_be = ANY(${years}::int[])
      ${facultyClauseFor(facultyNames, 'f.name_th')}
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

// ── Single-person verdict — the /profile stamp ────────────────────────────

export interface TeachingTalentStamp {
  methodologyVersion: string;
  /** The assessment window, ascending. Same years the dashboard uses. */
  years: number[];
  windowComplete: boolean;
  /** True only when the person cleared `threshold` in EVERY window year. */
  isTalent: boolean;
  yearsWithData: number;
  minYearRating: number | null;
  overallRating: number | null;
  /** Individual answers to evaluation questions, NOT a student headcount —
   *  the source table is one row per (year, semester, class, question,
   *  instructor). See the same caveat on the dashboard and the export. */
  totalResponses: number;
  threshold: number;
}

/**
 * Whether one staff member is a Teaching and Learning Talent.
 *
 * Same rule, same window and same provenance gate as
 * `teachingTalentRoster()`, but a single-person aggregate rather than the
 * ~1,700-row roster — /profile needs one verdict, not a table. The rule
 * itself is `classifyTalent()` in both paths, so the stamp on a profile
 * and the badge on the dashboard cannot disagree.
 *
 * Returns `null` when the person has no evaluation rows in the window at
 * all: "we have no evidence" is a different statement from "assessed and
 * did not qualify", and the caller renders nothing for it either way.
 */
export async function teachingTalentForFacultyMember(
  facultyMemberId: string,
): Promise<TeachingTalentStamp | null> {
  const { years, windowComplete } = await resolveWindow();
  if (years.length === 0) return null;

  const rows = await prisma.$queryRaw<
    Array<{ acad_year_be: number; rating_avg: number | null; responses: bigint }>
  >`
    SELECT
      e.acad_year_be                                         AS acad_year_be,
      (SUM(e.rating_avg::numeric * e.respondent_count)
         / NULLIF(SUM(e.respondent_count), 0))::float        AS rating_avg,
      COALESCE(SUM(e.respondent_count), 0)::bigint           AS responses
    FROM evaluation_response_summaries e
    JOIN ingestion_runs ir ON ir.id = e.ingestion_run_id
    JOIN data_sources ds ON ds.id = ir.data_source_id
    WHERE ds.mocked = false
      AND e.faculty_member_id = ${facultyMemberId}
      AND e.acad_year_be = ANY(${years}::int[])
    GROUP BY e.acad_year_be
  `;
  if (rows.length === 0) return null;

  const byYear: Record<string, number | null> = {};
  let totalResponses = 0;
  let weighted = 0;
  let weightedResponses = 0;
  for (const row of rows) {
    byYear[String(row.acad_year_be)] = row.rating_avg;
    const responses = Number(row.responses);
    totalResponses += responses;
    if (row.rating_avg !== null) {
      weighted += row.rating_avg * responses;
      weightedResponses += responses;
    }
  }

  const classified = classifyTalent(byYear, years, TALENT_DEFAULT_THRESHOLD);
  return {
    methodologyVersion: TEACHING_TALENT_METHODOLOGY_VERSION,
    years,
    windowComplete,
    isTalent: windowComplete && classified.isTalent,
    yearsWithData: classified.yearsWithData,
    minYearRating: classified.minYearRating,
    overallRating: weightedResponses > 0 ? weighted / weightedResponses : null,
    totalResponses,
    threshold: TALENT_DEFAULT_THRESHOLD,
  };
}
