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
