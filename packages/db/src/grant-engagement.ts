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

import { prisma } from './index';
import { realDataWhere } from './data-quality';

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
  // A run completed after `now` has not happened yet as far as this instant is concerned.
  const times = successTimes.map((d) => d.getTime()).filter((t) => t <= now.getTime());
  if (times.length === 0) return { open: false, reason: 'source-not-synced' };
  const first = Math.min(...times);
  const last = Math.max(...times);
  const lastSuccessAt = new Date(last).toISOString();
  if (now.getTime() - last > STALE_AFTER_MS) return { open: false, reason: 'source-stale', lastSuccessAt };
  const daysOfHistory = Math.floor((now.getTime() - first) / DAY_MS);
  // Exactly the last 30 Bangkok calendar dates: today and the 29 before it.
  const windowDays = new Set(
    Array.from({ length: HISTORY_DAYS }, (_, i) => bangkokParts(new Date(now.getTime() - i * DAY_MS)).day),
  );
  const successfulDaysLast30 = new Set(
    times.map((t) => bangkokParts(new Date(t)).day).filter((day) => windowDays.has(day)),
  ).size;
  if (daysOfHistory < HISTORY_DAYS || successfulDaysLast30 < MIN_GREEN_DAYS) {
    return { open: false, reason: 'awaiting-green-history', daysOfHistory, successfulDaysLast30 };
  }
  return { open: true, daysOfHistory, successfulDaysLast30, lastSuccessAt };
}

const GATE_TTL_MS = 5 * 60_000;
let gateCache: { at: number; promise: Promise<GrantGate> } | null = null;

/** Test hook: drop the cached gate. */
export function __resetGrantGateCache(): void {
  gateCache = null;
}

async function computeGrantGate(now: Date): Promise<GrantGate> {
  const runs = await prisma.ingestionRun.findMany({
    where: { status: 'SUCCEEDED', completedAt: { not: null }, dataSource: { slug: GRANTS_SOURCE } },
    select: { completedAt: true },
  });
  return greenHistoryGate(
    runs.map((r) => r.completedAt).filter((d): d is Date => d !== null),
    now,
  );
}

/** The green-history gate for the grants source. Against the real clock it is cached
 *  per process for 5 minutes (the in-flight promise is shared, so concurrent cold
 *  callers cost one query and a failure is never cached). An explicit `now` always
 *  computes fresh and never touches the cache. */
export function loadGrantGate(now?: Date): Promise<GrantGate> {
  if (now) return computeGrantGate(now);
  const t = Date.now();
  if (gateCache && t - gateCache.at < GATE_TTL_MS) return gateCache.promise;
  const entry = { at: t, promise: computeGrantGate(new Date(t)) };
  gateCache = entry;
  entry.promise.catch(() => {
    if (gateCache === entry) gateCache = null;
  });
  return entry.promise;
}

/** Staff (of `memberIds`) on at least one project — lead or co-investigator — in the window. */
export async function fundedStaffIds(
  memberIds: readonly string[],
  window: { fromFyBe: number; toFyBe: number },
): Promise<Set<string>> {
  if (memberIds.length === 0) return new Set();
  const rows = await prisma.researchServiceProjectMember.findMany({
    where: {
      facultyMemberId: { in: [...memberIds] },
      project: { fiscalYearBe: { gte: window.fromFyBe, lte: window.toFyBe } },
      ...realDataWhere(),
    },
    select: { facultyMemberId: true },
    distinct: ['facultyMemberId'],
  });
  return new Set(rows.map((r) => r.facultyMemberId).filter((id): id is string => id !== null));
}

export interface GrantEngagementDriver {
  label: typeof GRANT_ENGAGEMENT_LABEL;
  value: number | null;
  raw: Record<string, unknown>;
}

/** The finished capability driver for a set of DISTINCT active staff ids. */
export async function grantEngagementDriver(
  memberIds: readonly string[],
  now?: Date,
): Promise<GrantEngagementDriver> {
  const gate = await loadGrantGate(now);
  if (!gate.open) {
    const { open: _open, ...why } = gate;
    return { label: GRANT_ENGAGEMENT_LABEL, value: null, raw: { ...why, staff: memberIds.length } };
  }
  const window = grantWindow(now ?? new Date());
  const funded = await fundedStaffIds(memberIds, window);
  const fundedStaff = funded.size;
  return {
    label: GRANT_ENGAGEMENT_LABEL,
    value: engagementScore(fundedStaff, memberIds.length),
    raw: {
      fundedStaff,
      staff: memberIds.length,
      share: memberIds.length ? fundedStaff / memberIds.length : null,
      windowFyBe: [window.fromFyBe, window.toFyBe],
      target: GRANT_ENGAGEMENT_TARGET,
      lowerBound: true,
      caveat: 'Lower bound: about 30% of co-investigator ids match no HR record, so some funded staff count as unfunded.',
      gate: { daysOfHistory: gate.daysOfHistory, successfulDaysLast30: gate.successfulDaysLast30 },
    },
  };
}
