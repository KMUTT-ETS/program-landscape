import { prisma } from './index';

export const ACADEMIC_YEAR_SETTING_KEY = 'academic_year.next_start_date';

const BE_OFFSET = 543;
const START_MONTH = 6; // June (1-based)
const START_DAY = 16;
const CACHE_TTL_MS = 60_000;

export interface AcademicYearContext {
  /** The configured (or default) date the next academic year begins. */
  nextStartDate: Date;
  /** BE academic year that has begun as of `now`. */
  currentAcademicYearBE: number;
  /** Latest entry year whose recruitment is finished (== currentAcademicYearBE). */
  latestCompleteEntryYearBE: number;
  /** Entry year still recruiting (== current + 1). */
  inProgressEntryYearBE: number;
  /** True when the configured nextStartDate has already passed — UI prompts a bump. */
  isStale: boolean;
}

function utcDate(yearCE: number, month1: number, day: number): Date {
  return new Date(Date.UTC(yearCE, month1 - 1, day));
}

/**
 * Default next-start date when no setting is stored: the NEXT June-16
 * boundary strictly relative to `now`, so the derived context is correct
 * AND never flagged stale (a computed default needs no operator bump).
 */
export function defaultNextStartDate(now: Date = new Date()): Date {
  const y = now.getUTCFullYear();
  const thisYearStart = utcDate(y, START_MONTH, START_DAY);
  return now.getTime() >= thisYearStart.getTime()
    ? utcDate(y + 1, START_MONTH, START_DAY)
    : thisYearStart;
}

export function deriveAcademicYear(
  nextStartDate: Date,
  now: Date = new Date(),
): AcademicYearContext {
  const nextAY = nextStartDate.getUTCFullYear() + BE_OFFSET;
  const started = now.getTime() >= nextStartDate.getTime();
  const currentAcademicYearBE = started ? nextAY : nextAY - 1;
  return {
    nextStartDate,
    currentAcademicYearBE,
    latestCompleteEntryYearBE: currentAcademicYearBE,
    inProgressEntryYearBE: currentAcademicYearBE + 1,
    isStale: started,
  };
}

export function entryYearComplete(yearBE: number, ctx: AcademicYearContext): boolean {
  return yearBE <= ctx.latestCompleteEntryYearBE;
}
export function entryYearInProgress(yearBE: number, ctx: AcademicYearContext): boolean {
  return yearBE > ctx.latestCompleteEntryYearBE;
}

// ── DB-backed cache ─────────────────────────────────────────────────────
let cache: { nextStartDate: Date; expiresAt: number } | null = null;

export function invalidateAcademicYearCache(): void {
  cache = null;
}

function parseStored(value: string): Date | null {
  const dt = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

async function loadNextStartDate(now: Date): Promise<Date> {
  if (cache && cache.expiresAt > now.getTime()) return cache.nextStartDate;
  let parsed: Date | null = null;
  try {
    const row = await prisma.systemSetting.findUnique({
      where: { key: ACADEMIC_YEAR_SETTING_KEY },
    });
    if (row) parsed = parseStored(row.value);
  } catch {
    // DB unreachable / table missing pre-migration — fall back to default.
  }
  const nextStartDate = parsed ?? defaultNextStartDate(now);
  if (!parsed) {
    // eslint-disable-next-line no-console
    console.warn('[academic-year] no valid setting row — using default June-16 boundary');
  }
  cache = { nextStartDate, expiresAt: now.getTime() + CACHE_TTL_MS };
  return nextStartDate;
}

/** Async, cached (60s). Use from request handlers / scripts. Applies the
 *  operator-set date. Call once near the top of an async path to warm the
 *  cache for any downstream sync accessor use. */
export async function getAcademicYearContext(
  now: Date = new Date(),
): Promise<AcademicYearContext> {
  return deriveAcademicYear(await loadNextStartDate(now), now);
}

/** Synchronous. Uses the warmed cache if present, else the computed default
 *  (whose June-16 boundary already yields the corrected current year). For
 *  deep, synchronous code paths (risk-scoring engine) that cannot await. */
export function academicYearContextSync(now: Date = new Date()): AcademicYearContext {
  const nextStartDate = cache?.nextStartDate ?? defaultNextStartDate(now);
  return deriveAcademicYear(nextStartDate, now);
}
