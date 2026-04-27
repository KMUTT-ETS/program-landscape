// ────────────────────────────────────────────────────────────────────────────
// Pure transforms for the kku-registry connector.
//
// All functions here are deterministic and have no side effects — connector
// fetch() runs the SQL, transform() calls these helpers, load() writes the
// result. Keeping the transforms pure means the unit tests don't need a
// running Oracle DB.
// ────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';

// Buddhist Era → Common Era. KKU Registrar emits cohort years in BE
// (เช่น 2563 = 2020 CE).
//
// Sanity bounds: [2400, 2700] = CE [1857, 2157]. KKU was founded in
// 1964 (BE 2507); the registrar's data goes back as far as BE 2488
// (1945) — likely legacy alumni or pre-merger data — so we don't
// reject those. The bounds primarily catch the "forgot to convert
// from CE to BE" bug — a Gregorian year like 2024 fails the lower
// bound (2024 < 2400).
export function buddhistToCommonEra(yearBE: number): number {
  if (!Number.isInteger(yearBE) || yearBE < 2400 || yearBE > 2700) {
    throw new Error(
      `Year out of expected Buddhist-Era range [2400, 2700]: ${yearBE}. ` +
        `If this is a Common-Era year, the connector forgot to convert.`,
    );
  }
  return yearBE - 543;
}

// ── Q1 row schema (raw status counts) ──────────────────────────────────

export const Q1RowSchema = z.object({
  FACULTY_NAME: z.string().min(1),
  PROGRAM_NAME: z.string().min(1),
  PROGRAM_LEVEL: z.string().nullable(),
  MAJOR: z.string().nullable(),
  COHORT_YEAR_BE: z.number().int(),
  STATUS: z.string().nullable(),
  STATUS_CODE: z.number().int().nullable(),
  N: z.coerce.number().int().nonnegative(),
});
export type Q1Row = z.infer<typeof Q1RowSchema>;

// ── Q2 row schema (demographic histograms) ─────────────────────────────

export const Q2RowSchema = z.object({
  FACULTY_NAME: z.string().min(1),
  PROGRAM_NAME: z.string().min(1),
  PROGRAM_LEVEL: z.string().nullable(),
  MAJOR: z.string().nullable(),
  COHORT_YEAR_BE: z.number().int(),
  GENDER: z.string().nullable(),
  HOME_PROVINCE: z.string().nullable(),
  NATION: z.string().nullable(),
  N: z.coerce.number().int().nonnegative(),
});
export type Q2Row = z.infer<typeof Q2RowSchema>;

// ── Mapping-key normalisation ──────────────────────────────────────────
//
// The mapping-table unique key is (facultyName, programName, level, major).
// MAJOR has trailing whitespace in some rows; PROGRAM_LEVEL is sometimes
// null. Normalise to a canonical form so the lookup is stable.

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
  return `${k.registryFacultyName} | ${k.registryProgramName} | ${k.registryLevel} | ${k.registryMajor}`;
}

// ── Demographic-breakdown JSON shape ───────────────────────────────────
//
// What we materialise into StudentDemographic.breakdownJson per (program,
// cohort) tuple. Histograms are { value: count } objects so the cockpit
// can render them without re-aggregating.

export interface DemographicBreakdown {
  cohortSize: number;
  gender: Record<string, number>;
  homeProvince: Record<string, number>;
  nationality: Record<string, number>;
  // Captured-at timestamp from the run, plus the raw query row count
  // for analyst sanity-checking against IngestionRun stats.
  source: {
    capturedAt: string;
    rowCount: number;
  };
}

/**
 * Aggregate a list of Q2 rows (already same-program-same-cohort) into a
 * single breakdown JSON. Empty / "-" / null categorical values are
 * coalesced to "(unknown)" so the downstream histogram renderer doesn't
 * have to invent its own placeholder.
 */
export function buildBreakdown(rows: Q2Row[], capturedAt: string): DemographicBreakdown {
  const gender: Record<string, number> = {};
  const homeProvince: Record<string, number> = {};
  const nationality: Record<string, number> = {};
  let total = 0;

  for (const row of rows) {
    const n = row.N;
    total += n;
    bump(gender, normaliseCategorical(row.GENDER), n);
    bump(homeProvince, normaliseCategorical(row.HOME_PROVINCE), n);
    bump(nationality, normaliseCategorical(row.NATION), n);
  }

  return {
    cohortSize: total,
    gender,
    homeProvince,
    nationality,
    source: { capturedAt, rowCount: rows.length },
  };
}

function bump(map: Record<string, number>, key: string, by: number): void {
  map[key] = (map[key] ?? 0) + by;
}

function normaliseCategorical(value: string | null | undefined): string {
  if (!value) return '(unknown)';
  const trimmed = value.trim();
  if (!trimmed || trimmed === '-') return '(unknown)';
  return trimmed;
}

// ── Cohort-funnel rollup ───────────────────────────────────────────────

export interface FunnelCounts {
  /** Cohort size BEFORE excluding never-enrolled — used for sanity. */
  cohortTotal: number;
  /** People who actually started classes (cohort - never_enrolled). */
  enrolled: number;
  /** Currently active (still studying). */
  active: number;
  /** Graduated (any time). */
  graduatedTotal: number;
  /** Terminated after starting classes. */
  dropouts: number;
  /** Admitted but never started. */
  neverEnrolled: number;
  /** Statuses the bucket map didn't recognise — surfaced in run metadata. */
  uncategorised: number;
  /** Raw codes that were uncategorised, for debugging. */
  unknownStatusCodes: number[];
}

import { bucketForStatusCode, STATUS_BUCKET_MAP } from './status-mapping';

/**
 * Roll up Q1 rows for a single (program, cohort) tuple into our funnel
 * shape. Rows MUST be pre-filtered to one tuple — the function does not
 * group; it sums.
 */
export function rollupFunnel(rows: Q1Row[]): FunnelCounts {
  let active = 0;
  let graduatedTotal = 0;
  let dropouts = 0;
  let neverEnrolled = 0;
  let uncategorised = 0;
  const unknownCodes = new Set<number>();

  for (const row of rows) {
    const bucket = bucketForStatusCode(row.STATUS_CODE);
    const n = row.N;
    switch (bucket) {
      case 'ACTIVE':
        active += n;
        break;
      case 'GRADUATED':
        graduatedTotal += n;
        break;
      case 'DROPOUT':
        dropouts += n;
        break;
      case 'NEVER_ENROLLED':
        neverEnrolled += n;
        break;
      case 'UNCATEGORISED':
        uncategorised += n;
        if (row.STATUS_CODE !== null && !STATUS_BUCKET_MAP.has(row.STATUS_CODE)) {
          unknownCodes.add(row.STATUS_CODE);
        }
        break;
    }
  }

  const cohortTotal = active + graduatedTotal + dropouts + neverEnrolled + uncategorised;
  return {
    cohortTotal,
    enrolled: cohortTotal - neverEnrolled,
    active,
    graduatedTotal,
    dropouts,
    neverEnrolled,
    uncategorised,
    unknownStatusCodes: [...unknownCodes].sort((a, b) => a - b),
  };
}
