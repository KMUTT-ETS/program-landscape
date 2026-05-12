// ─────────────────────────────────────────────────────────────────────────────
// Pure transforms for the kku-hr connector.
//
// All functions here are deterministic and have no side effects. The
// connector's fetch() runs the SQL, transform() calls these helpers,
// load() writes the result. Pure transforms keep the unit tests
// runnable without a live SQL Server.
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';

// ── Q1 row schema (per-employee FacultyMember) ────────────────────────────
//
// Returns one row per active academic-staff employee. Names are
// pulled but role-gated downstream (COUNCIL gets aggregates only).
// PII columns (citizen ID raw, email, phone, salary, etc.) NEVER in
// the SELECT projection — see docs/data-sources/kku-hr.md "Q1".

export const Q1RowSchema = z.object({
  EMPLOYEE_HASH: z.string().min(1), // SHA256(EMPLOYEEID), 64 hex chars
  // EMPLOYEEID raw — HR-internal employment number, NOT citizen ID.
  // Confirmed not PII per KKU 2026-05-02; safe to display.
  EMPLOYEE_ID: z.string().nullable(),
  PERSON_HASH: z.string().min(1).nullable(), // SHA256(ID_PEOPLE) — null if ID_PEOPLE blank
  EMP_PREFIX: z.string().nullable(),
  FNAME: z.string().nullable(),
  LNAME: z.string().nullable(),
  EFNAME: z.string().nullable(),
  ELNAME: z.string().nullable(),
  STATUS: z.string().nullable(),
  /** Full BIRTHDAY in 'YYYY-MM-DD' text (was previously LEFT-truncated
   *  to year). Needed for the KKU civil-service retirement-date rule. */
  BIRTH_DATE: z.string().nullable(),
  /** FIRSTHIREDATE — original join date. Authoritative hire date;
   *  supersedes STARTDATE (which can carry 2025 bulk-stamp anomalies
   *  on re-contracted staff). */
  FIRSTHIREDATE: z.string().nullable(),
  STARTDATE: z.string().nullable(), // 'YYYY-MM-DD' or '' (text)
  RESIGNDATE: z.string().nullable(),
  ENDWORKDATE: z.string().nullable(),
  BU1: z.string().nullable(),
  BU2: z.string().nullable(),
  BU3: z.string().nullable(),
  BU4: z.string().nullable(),
  POSITION_TH: z.string().nullable(),
  POSITION_LEVEL_RAW: z.string().nullable(),
  JOB_CODE: z.string().nullable(),
  POSITION_TYPE: z.string().nullable(),
  JOB_FAMILY: z.string().nullable(),
});
export type Q1Row = z.infer<typeof Q1RowSchema>;

// ── Q2 row schema (compensation aggregate) ────────────────────────────────

export const Q2RowSchema = z.object({
  FACULTY_KEY: z.string().min(1),
  DEPARTMENT_KEY: z.string().nullable(),
  POSITION_LEVEL_RAW: z.string().nullable(),
  START_YEAR: z.string().nullable(),
  HEADCOUNT: z.coerce.number().int().nonnegative(),
  SUM_SALARY: z.coerce.number(),
  MEAN_SALARY: z.coerce.number(),
  MIN_SALARY: z.coerce.number(),
  MAX_SALARY: z.coerce.number(),
});
export type Q2Row = z.infer<typeof Q2RowSchema>;

// ── Q3 row schema (Faculty lookup from epm_report) ────────────────────────

export const Q3RowSchema = z.object({
  BU_CODE: z.string().min(1),
  LABEL_TH: z.string().nullable(),
  PARENT: z.string().nullable(),
});
export type Q3Row = z.infer<typeof Q3RowSchema>;

// ── Q4 row schema (Separations from full EmployeeDetail) ──────────────────

export const Q4RowSchema = z.object({
  EMPLOYEE_HASH: z.string().min(1),
  EMPLOYEE_ID: z.string().nullable(),
  PERSON_HASH: z.string().min(1).nullable(),
  STATUS: z.string().nullable(),
  /** ENDWORKDATE comes back as a Date object from mssql-client, not a
   *  text string like the other dates. Most rows present a Date here;
   *  fall back to z.unknown() to avoid validation failures on edge
   *  cases. The transform() handles both. */
  ENDWORKDATE: z.union([z.date(), z.string(), z.null()]),
  FACULTY_KEY: z.string().nullable(),
  POSITION_TYPE: z.string().nullable(),
});
export type Q4Row = z.infer<typeof Q4RowSchema>;

// ── Q5 row schema (Full HCM staff snapshot from EmployeeDetail) ───────────

export const Q5RowSchema = z.object({
  EMPLOYEE_HASH: z.string().min(1),
  EMPLOYEE_ID: z.string().nullable(),
  PERSON_HASH: z.string().min(1).nullable(),
  STATUS: z.string().nullable(),
  /** BIRTHDAY — date format same as Q4's ENDWORKDATE. */
  BIRTHDAY: z.union([z.date(), z.string(), z.null()]),
  /** FIRSTHIREDATE comes back as a Date from mssql-client (same
   *  format as ENDWORKDATE in Q4). */
  FIRSTHIREDATE: z.union([z.date(), z.string(), z.null()]),
  FACULTY_KEY: z.string().nullable(),
  POSITION_TYPE: z.string().nullable(),
});
export type Q5Row = z.infer<typeof Q5RowSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Date parsing — HCM stores dates as 'YYYY-MM-DD' text in CE format.
// Returns null on empty / unparseable strings rather than throwing.
// ─────────────────────────────────────────────────────────────────────────

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseHcmDate(value: string | null): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const m = DATE_RE.exec(trimmed);
  if (!m) return null;
  const [, y, mo, d] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  if (year < 1900 || year > 2100) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  // Use UTC midnight to avoid TZ shifts when stored in @db.Date.
  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * BIRTHDAY is captured as year-only (LEFT(BIRTHDAY, 4)). Returns Jan 1
 * of that year as a UTC date, or null on empty / unparseable input.
 * Year-precision intentional — we don't store full DOB.
 *
 * @deprecated Year-only birthdate is from the legacy LEFT(BIRTHDAY, 4)
 * pull. The connector now reads full BIRTHDAY; keep this function for
 * back-compat with any other caller, but prefer parseHcmDate().
 */
export function parseBirthYear(value: string | null): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^\d{4}$/.test(trimmed)) return null;
  const year = Number(trimmed);
  if (year < 1900 || year > 2100) return null;
  return new Date(Date.UTC(year, 0, 1));
}

/**
 * Compute the KKU mandatory retirement date from a birth date,
 * following the Thai civil-service rule:
 *
 *   "Retirement is on 1 Oct after the staff member is fully 60 years
 *    old. If they become fully 60 on or after 1 Oct of year X, they
 *    retire on 1 Oct of year X+1; otherwise they retire on 1 Oct of
 *    year X (= birthYear + 60)."
 *
 * Equivalent: retire on the first 1 Oct strictly AFTER the 60th
 * birthday (so birthday = 1 Oct exactly falls into next year).
 *
 *   birth month <= Sep         → retire 1 Oct (birthYear + 60)
 *   birth month >= Oct (incl. Oct 1) → retire 1 Oct (birthYear + 61)
 *
 * Returns null when birthDate is null or yields an out-of-bounds year.
 * Operates in UTC to match the @db.Date storage convention.
 */
export function computeRetirementDateFromBirth(birthDate: Date | null): Date | null {
  if (!birthDate) return null;
  const birthY = birthDate.getUTCFullYear();
  const birthM = birthDate.getUTCMonth(); // 0=Jan, 9=Oct, 11=Dec
  if (birthY < 1900 || birthY > 2100) return null;
  // birth month >= October (index 9, 10, 11) → push retirement to next year
  const retireYear = birthM >= 9 ? birthY + 61 : birthY + 60;
  return new Date(Date.UTC(retireYear, 9, 1)); // month index 9 = October
}

/**
 * Composes the Thai display name from prefix + first + last.
 * Falls back to whatever's available; trims internal extra whitespace.
 *
 * EMP_PREFIX from HCM is sometimes a numeric code ("001" = นาย, "002" =
 * นาง, "003" = นางสาว) rather than the actual Thai title. Stripping
 * any all-digits prefix avoids surfacing the code as if it were part
 * of the name. When the prefix is genuinely Thai ("ผศ.", "รศ."), it
 * passes through unchanged.
 */
export function buildNameTh(
  prefix: string | null,
  firstName: string | null,
  lastName: string | null,
): string {
  const cleanedPrefix = (prefix?.trim() ?? '').replace(/^\d+$/, '');
  return [cleanedPrefix, firstName, lastName]
    .map((s) => s?.trim() ?? '')
    .filter((s) => s.length > 0)
    .join(' ');
}

/**
 * Composes the English name from first + last.
 */
export function buildNameEn(
  firstName: string | null,
  lastName: string | null,
): string {
  return [firstName, lastName]
    .map((s) => s?.trim() ?? '')
    .filter((s) => s.length > 0)
    .join(' ');
}

/**
 * Derives `isActive` from STATUS. STATUS='A' is active; anything else
 * (Z=retired, Y=resigned, D=deceased, U=unknown) is not active.
 */
export function deriveIsActive(status: string | null): boolean {
  return status === 'A';
}

/**
 * Tags HCM-sourced employee codes with a `hr_` prefix so they're
 * distinguishable from synthetic seed-data codes ('FM-001' etc).
 * Truncates the SHA256 to 32 hex chars (128 bits — collision-free
 * for 18k employees).
 */
export function buildEmployeeCode(employeeHash: string): string {
  return `hr_${employeeHash.toLowerCase().slice(0, 32)}`;
}
