// ────────────────────────────────────────────────────────────────────────────
// Course-code helpers shared between the class-offerings refresh and the
// PROGRAM_DIGEST course materialiser. Pure functions, no side effects —
// safe to import from any script without triggering ingestion work.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Faculties whose courses are general-education by definition. The first
 * two ("สถาบันการสอนวิชาศึกษาทั่วไป" + "สถาบันภาษา") were discovered via
 * the registrar's class-offering probe — they own the GE catalogue.
 */
export const GE_FACULTY_NAMES: ReadonlySet<string> = new Set<string>([
  'สถาบันการสอนวิชาศึกษาทั่วไป', // General Education Teaching Institute
  'สถาบันภาษา', // Language Institute
]);

/**
 * Normalise a course code: strip ALL whitespace, upper-case. Matches both
 * the registrar's "EN241100" and the PROGRAM_DIGEST extraction's
 * "EN 241 100" form so `program_courses.course_code` joins cleanly to
 * `class_offerings.course_code`.
 */
export function normaliseCourseCode(raw: string | null | undefined): string {
  if (!raw) return '';
  return String(raw).replace(/\s+/g, '').toUpperCase();
}

/**
 * Parse the registrar's COURSEUNIT string "A (B-C-D)" where:
 *   A = credits (already in CREDITTOTAL)
 *   B = lecture hours / week
 *   C = laboratory hours / week
 *   D = student self-study hours / week (suggestion only)
 *
 * Returns nulls for both when the string doesn't parse (e.g.,
 * independent-study / thesis / unusual formats).
 */
export function parseCourseUnit(raw: string | null): {
  lectureHrs: number | null;
  labHrs: number | null;
} {
  if (!raw) return { lectureHrs: null, labHrs: null };
  const m = raw.match(/^\s*\d+\s*\(\s*(\d+)\s*-\s*(\d+)\s*-\s*\d+\s*\)\s*$/);
  if (!m) return { lectureHrs: null, labHrs: null };
  return { lectureHrs: parseInt(m[1]!, 10), labHrs: parseInt(m[2]!, 10) };
}

/**
 * Determine general-education status for a class offering. True iff:
 *   - course code starts with "00" (legacy numeric GE codes), OR
 *   - course code starts with "GE" (current GE codes), OR
 *   - owning registry faculty is GE Institute or Language Institute.
 */
export function isGeneralEd(
  normalisedCode: string,
  registryFacultyName: string,
): boolean {
  if (normalisedCode.startsWith('00')) return true;
  if (normalisedCode.startsWith('GE')) return true;
  if (GE_FACULTY_NAMES.has(registryFacultyName.trim())) return true;
  return false;
}

/**
 * Split a KKUMAIL field. Comma-separated with historical duplicates;
 * returns distinct lowercased non-empty values that look email-shaped.
 */
export function splitKkuMail(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const out = new Set<string>();
  for (const part of raw.split(',')) {
    const trimmed = part.trim().toLowerCase();
    if (trimmed && trimmed.includes('@')) out.add(trimmed);
  }
  return [...out];
}
