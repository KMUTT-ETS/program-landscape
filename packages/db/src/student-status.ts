// ─────────────────────────────────────────────────────────────────────────────
// KKU registrar student-status taxonomy.
//
// Single source of truth for the three status groups that drive both:
//   - Education dashboard's Student Info pivot (per-status breakdown)
//   - Home + Cockpit "Currently enrolled" KPI tile (CURRENT-group sum)
//
// Bands per the registrar's coding (see `education_student_cube.status_code`):
//   < 10  = INCOMING — admitted, reported in, on quota / waitlist (not yet
//           studying)
//   10-39 = CURRENT  — currently enrolled in some form (active, on leave,
//           retaining status, suspended, abroad on joint program, awaiting
//           publication, awaiting graduation council approval)
//   ≥ 40  = FORMER   — graduated, withdrawn, dismissed, deceased, etc.
//
// The CURRENT range is what KKU publishes as the official "current student
// count" figure. At university scope it sums to 36,133 (2026-05).
// ─────────────────────────────────────────────────────────────────────────────

export type StudentStatusGroup = 'INCOMING' | 'CURRENT' | 'FORMER';

export interface StudentStatusGroupRange {
  min: number;
  max: number;
  label: string;
}

export const STUDENT_STATUS_GROUP_RANGES: Record<
  StudentStatusGroup,
  StudentStatusGroupRange
> = {
  INCOMING: { min: 0, max: 9, label: 'Incoming students (status < 10)' },
  CURRENT: { min: 10, max: 39, label: 'Current students (status 10–39)' },
  FORMER: { min: 40, max: 999, label: 'Former students (status ≥ 40)' },
};

export function studentStatusGroupOf(code: number): StudentStatusGroup {
  if (code < 10) return 'INCOMING';
  if (code < 40) return 'CURRENT';
  return 'FORMER';
}
