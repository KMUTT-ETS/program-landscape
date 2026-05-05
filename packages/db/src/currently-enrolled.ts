// ─────────────────────────────────────────────────────────────────────────────
// Currently-enrolled student count.
//
// Sourced from `education_student_cube` filtered to status_code 10-39 — the
// registrar's "Current student" group (current normal / on-leave / awaiting
// graduation / abroad / awaiting publication / etc.). This is the number KKU
// publishes officially; matches the public registry stat exactly (36,133 at
// university scope, 2026-05).
//
// Why this and not `enrollment_metrics.enrolled` summed per-program-latest:
//   - `enrolled` in EnrollmentMetric represents *intake* per academic year
//     (~2.5k/yr), not the headcount of every student currently studying. The
//     headline KPI on Council-facing surfaces should be the headcount.
//   - The cube already aggregates with the registrar's official status
//     taxonomy and is refreshed by `pnpm education:refresh`.
//
// The cube doesn't carry a `program_id` — it scopes by `faculty_name` (Thai).
// So:
//   - university scope: full cube SUM
//   - faculty scope: filter by Faculty.nameTh
//   - department / program scope: not supported by the cube — falls back to
//     EnrollmentMetric per-program-latest (intake proxy).
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from './index';
import type { ScopeLevel } from './scope';
import { STUDENT_STATUS_GROUP_RANGES } from './student-status';

/** Inclusive status-code bounds for "currently enrolled" — pulled from the
 *  canonical CURRENT range so this helper and the Education dashboard's
 *  Student-info pivot can never drift. */
const CURRENT = STUDENT_STATUS_GROUP_RANGES.CURRENT;

/**
 * Returns the count of currently-enrolled students at the given scope. Uses
 * `education_student_cube` for university + faculty scope (exact match to the
 * KKU public stat). Falls back to per-program-latest EnrollmentMetric sum at
 * deeper scopes where the cube can't disambiguate.
 *
 * Returns null when no signal is available at the requested scope.
 */
export async function currentlyEnrolledStudents(
  scope: ScopeLevel,
  scopeId: string | null,
): Promise<number | null> {
  if (scope === 'university') {
    const rows = await prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT COALESCE(SUM(student_count), 0)::bigint AS total
      FROM education_student_cube
      WHERE status_code BETWEEN ${CURRENT.min} AND ${CURRENT.max};
    `;
    return Number(rows[0]?.total ?? 0n);
  }

  if (scope === 'faculty' && scopeId) {
    const facultyRow = await prisma.faculty.findUnique({
      where: { id: scopeId },
      select: { nameTh: true },
    });
    if (!facultyRow) return null;
    const rows = await prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT COALESCE(SUM(student_count), 0)::bigint AS total
      FROM education_student_cube
      WHERE status_code BETWEEN ${CURRENT.min} AND ${CURRENT.max}
        AND faculty_name = ${facultyRow.nameTh};
    `;
    return Number(rows[0]?.total ?? 0n);
  }

  // Department / program scope — cube has no program_id, so fall back to the
  // EnrollmentMetric per-program-latest sum. This is a different number
  // (intake, not headcount), but at this scope it's the best signal we have.
  if (scope === 'department' && scopeId) {
    const rows = await prisma.$queryRaw<Array<{ total: bigint }>>`
      WITH latest AS (
        SELECT program_id, MAX(academic_year) AS max_year
        FROM enrollment_metrics GROUP BY program_id
      )
      SELECT COALESCE(SUM(em.enrolled), 0)::bigint AS total
      FROM enrollment_metrics em
      JOIN latest l ON l.program_id = em.program_id AND em.academic_year = l.max_year
      JOIN programs p ON p.id = em.program_id
        AND p.status = 'ACTIVE'
        AND p.sequence_no_from_sheet IS NOT NULL
        AND p.department_id = ${scopeId};
    `;
    return Number(rows[0]?.total ?? 0n);
  }
  if (scope === 'program' && scopeId) {
    const rows = await prisma.$queryRaw<Array<{ enrolled: number | null }>>`
      SELECT em.enrolled::int AS enrolled
      FROM enrollment_metrics em
      WHERE em.program_id = ${scopeId}
      ORDER BY em.academic_year DESC
      LIMIT 1;
    `;
    return rows[0]?.enrolled ?? null;
  }
  return null;
}
