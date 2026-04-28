// ─────────────────────────────────────────────────────────────────────────────
// Pure transforms for the kku-finance connector. No side effects; tests
// run without a live Oracle / SQL Server.
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';

// ── Q1 row schema (tuition aggregate per program × ACADYEAR) ──────────────

export const Q1RowSchema = z.object({
  FACULTY_NAME: z.string().min(1),
  PROGRAM_NAME: z.string().min(1),
  PROGRAM_LEVEL: z.string().nullable(),
  MAJOR: z.string().nullable(),
  COHORT_YEAR_BE: z.number().int(),
  STUDENT_COUNT: z.coerce.number().int().nonnegative(),
  TUITION_SUM: z.coerce.number().nonnegative(),
});
export type Q1Row = z.infer<typeof Q1RowSchema>;

// ── Q2 row schema (budget aggregate per division × fund × year) ────────────

export const Q2RowSchema = z.object({
  DIVISION_NAME: z.string().min(1),
  FUND_NAME: z.string().nullable(),
  FISCAL_YEAR_BE: z.coerce.number().int(),
  SNAPSHOT_NAME: z.string().nullable(),
  TOTAL_BUDGET: z.coerce.number(),
  TOTAL_COMMITMENT: z.coerce.number(),
  TOTAL_OBLIGATION: z.coerce.number(),
  TOTAL_EXPENDITURE: z.coerce.number(),
  FUNDS_AVAILABLE: z.coerce.number(),
});
export type Q2Row = z.infer<typeof Q2RowSchema>;

// ── BE → CE conversion ────────────────────────────────────────────────────
//
// Same bounds as kku-registry: [2400, 2700]. Catches "forgot to
// convert" CE-leak bugs (a Gregorian 2024 fails 2024 < 2400).

export function buddhistToCommonEra(yearBE: number): number {
  if (!Number.isInteger(yearBE) || yearBE < 2400 || yearBE > 2700) {
    throw new Error(
      `Year out of expected Buddhist-Era range [2400, 2700]: ${yearBE}. ` +
        `If this is a Common-Era year, the connector forgot to convert.`,
    );
  }
  return yearBE - 543;
}

// ── Mapping-key normalisation ──────────────────────────────────────────────
//
// Reuses the same (faculty, program, level, major) tuple as kku-registry's
// RegistryProgramMapping bridge. Trim whitespace on every field; map null
// PROGRAM_LEVEL / MAJOR to '' so the empty-case still de-dupes.

export interface MappingKey {
  registryFacultyName: string;
  registryProgramName: string;
  registryLevel: string;
  registryMajor: string;
}

export function normaliseMappingKey(row: {
  FACULTY_NAME: string;
  PROGRAM_NAME: string;
  PROGRAM_LEVEL: string | null;
  MAJOR: string | null;
}): MappingKey {
  return {
    registryFacultyName: row.FACULTY_NAME.trim(),
    registryProgramName: row.PROGRAM_NAME.trim(),
    registryLevel: (row.PROGRAM_LEVEL ?? '').trim(),
    registryMajor: (row.MAJOR ?? '').trim(),
  };
}

export function mappingKeyToString(k: MappingKey): string {
  return `${k.registryFacultyName}|${k.registryProgramName}|${k.registryLevel}|${k.registryMajor}`;
}

// ── Division-name → faculty-name normalisation ────────────────────────────
//
// BudgetData.DIVISION_NAME has 51 distinct values, many of which are
// sub-units of a parent faculty:
//   "คณะแพทยศาสตร์"
//   "คณะแพทยศาสตร์ - โรงพยาบาลศรีนครินทร์"
//   "คณะแพทยศาสตร์ - ศูนย์หัวใจสิริกิติ์ ภาคตะวันออกเฉียงเหนือ"
//
// We strip ` - <suffix>` to get the parent faculty name; the original
// (un-stripped) division name is preserved in `FacultyBudget.divisionName`
// for transparency on the largest spending sub-units (e.g., the ~฿7.6B
// at Srinagarind Hospital is reported separately from the faculty
// proper).

export function extractRootFacultyName(divisionName: string): string {
  const trimmed = divisionName.trim();
  const dashIdx = trimmed.indexOf(' - ');
  return dashIdx === -1 ? trimmed : trimmed.slice(0, dashIdx).trim();
}
