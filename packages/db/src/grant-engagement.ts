// External grant engagement — the health-score capability driver added in
// health-score.v5.3 (spec docs/superpowers/specs/2026-10-02-grant-engagement-driver-design.md).
//
// Share of a programme's active teaching staff on at least one externally
// funded research or academic-service project (lead or co-investigator) in the
// last three COMPLETE Thai fiscal years, scored linearly to 100 at 60 %.
//
// Gated on readiness gate 11 (30 days of green sync history for the
// kku-research-services source): until the gate opens the driver is null, never
// 0, and says why. Plain Prisma only — health scores are read inside Next.js
// server components, where nested Prisma.sql fragments break.

export const GRANT_ENGAGEMENT_LABEL = 'external_grant_engagement';
export const GRANT_ENGAGEMENT_TARGET = 0.6;
export const GRANTS_SOURCE = 'kku-research-services';

const DAY_MS = 86_400_000;
const BANGKOK_OFFSET_MS = 7 * 3_600_000;
const HISTORY_DAYS = 30;
const MIN_GREEN_DAYS = 25;
const STALE_AFTER_MS = 72 * 3_600_000;

function bangkokParts(d: Date): { year: number; month: number; day: string } {
  const b = new Date(d.getTime() + BANGKOK_OFFSET_MS);
  return { year: b.getUTCFullYear(), month: b.getUTCMonth() + 1, day: b.toISOString().slice(0, 10) };
}

/** Thai fiscal year (BE) of an instant; the fiscal year starts on 1 October (Bangkok). */
export function fiscalYearBe(d: Date): number {
  const { year, month } = bangkokParts(d);
  return year + 543 + (month >= 10 ? 1 : 0);
}

/** The last three complete fiscal years before the one `now` falls in. */
export function grantWindow(now: Date): { fromFyBe: number; toFyBe: number } {
  const current = fiscalYearBe(now);
  return { fromFyBe: current - 3, toFyBe: current - 1 };
}

/** 0–100, linear to GRANT_ENGAGEMENT_TARGET; null when there is nobody to measure. */
export function engagementScore(funded: number, staff: number): number | null {
  if (staff <= 0) return null;
  return Math.max(0, Math.min(100, (funded / staff / GRANT_ENGAGEMENT_TARGET) * 100));
}

export type GrantGate =
  | { open: true; daysOfHistory: number; successfulDaysLast30: number; lastSuccessAt: string }
  | { open: false; reason: 'source-not-synced' }
  | { open: false; reason: 'source-stale'; lastSuccessAt: string }
  | { open: false; reason: 'awaiting-green-history'; daysOfHistory: number; successfulDaysLast30: number };

/**
 * Readiness gate 11 for the grants source: open only when the first success is
 * ≥ 30 days old, ≥ 25 of the last 30 Bangkok days had a success, and the latest
 * success is within 72 h. Reason precedence: not-synced, stale, awaiting history.
 */
export function greenHistoryGate(successTimes: readonly Date[], now: Date): GrantGate {
  if (successTimes.length === 0) return { open: false, reason: 'source-not-synced' };
  const times = successTimes.map((d) => d.getTime());
  const first = Math.min(...times);
  const last = Math.max(...times);
  const lastSuccessAt = new Date(last).toISOString();
  if (now.getTime() - last > STALE_AFTER_MS) return { open: false, reason: 'source-stale', lastSuccessAt };
  const daysOfHistory = Math.floor((now.getTime() - first) / DAY_MS);
  const windowStart = now.getTime() - HISTORY_DAYS * DAY_MS;
  const greenDays = new Set(
    times.filter((t) => t > windowStart && t <= now.getTime()).map((t) => bangkokParts(new Date(t)).day),
  );
  const successfulDaysLast30 = Math.min(greenDays.size, HISTORY_DAYS);
  if (daysOfHistory < HISTORY_DAYS || successfulDaysLast30 < MIN_GREEN_DAYS) {
    return { open: false, reason: 'awaiting-green-history', daysOfHistory, successfulDaysLast30 };
  }
  return { open: true, daysOfHistory, successfulDaysLast30, lastSuccessAt };
}
