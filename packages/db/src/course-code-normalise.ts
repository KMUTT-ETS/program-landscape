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
