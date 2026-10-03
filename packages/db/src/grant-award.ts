// External-grant award — health-score.v5.4
// (spec docs/superpowers/specs/2026-10-03-external-grant-financial-award-design.md).
//
// Up to +10 points added to the Financial dimension AFTER its drivers are
// averaged: grant baht per active teaching staff member per year, over the last
// three COMPLETE Thai fiscal years, on a log curve from ฿0.1 M (0) to ฿3 M (+10).
// An award, never a penalty: no grant is +0, and the award never touches data
// completeness. Plain Prisma only — health scores are read inside Next.js server
// components, where nested Prisma.sql fragments break.

import { prisma } from './index';
import { realDataWhere } from './data-quality';

export const GRANT_AWARD_LABEL = 'external_grant_award';
export const GRANT_AWARD_FLOOR_THB = 100_000;
export const GRANT_AWARD_CAP_THB = 3_000_000;
export const GRANT_AWARD_MAX_POINTS = 10;
export const GRANTS_SOURCE = 'kku-research-services';
export const GRANT_AWARD_CAVEAT =
  'Lower bound: about 30% of co-investigator ids match no HR record, so some programmes are understated.';

const BANGKOK_OFFSET_MS = 7 * 3_600_000;

/** Thai fiscal year (BE) of an instant; the fiscal year starts on 1 October (Bangkok). */
export function fiscalYearBe(d: Date): number {
  const b = new Date(d.getTime() + BANGKOK_OFFSET_MS);
  return b.getUTCFullYear() + 543 + (b.getUTCMonth() + 1 >= 10 ? 1 : 0);
}

/** The last three complete fiscal years before the one `now` falls in. */
export function grantWindow(now: Date): { fromFyBe: number; toFyBe: number } {
  const current = fiscalYearBe(now);
  return { fromFyBe: current - 3, toFyBe: current - 1 };
}

/** Award points (0–10) for grant baht per active teaching staff member per year. */
export function awardPoints(bahtPerStaffPerYear: number): number {
  const x = bahtPerStaffPerYear;
  if (!Number.isFinite(x) || x <= GRANT_AWARD_FLOOR_THB) return 0;
  const span = Math.log(GRANT_AWARD_CAP_THB / GRANT_AWARD_FLOOR_THB);
  return Math.min(GRANT_AWARD_MAX_POINTS, (GRANT_AWARD_MAX_POINTS * Math.log(x / GRANT_AWARD_FLOOR_THB)) / span);
}

export interface GrantAward {
  label: typeof GRANT_AWARD_LABEL;
  points: number | null;
  baseScore: number | null;
  raw: Record<string, unknown>;
}

export type GrantAwardInput = Omit<GrantAward, 'baseScore'>;

/**
 * Apply the award to a finished Financial score. A null base stays null and earns
 * nothing; null points (source not synced, no staff) leave the score unchanged.
 * Completeness and drivers are never touched.
 */
export function withAward<T extends { score: number | null }>(
  score: T,
  award: GrantAwardInput,
): T & { award: GrantAward } {
  if (score.score === null) {
    return { ...score, award: { ...award, points: null, baseScore: null } };
  }
  const next = award.points === null ? score.score : Math.min(100, score.score + award.points);
  return { ...score, score: next, award: { ...award, baseScore: score.score } };
}

const SOURCE_TTL_MS = 5 * 60_000;
let sourceCache: { at: number; promise: Promise<boolean> } | null = null;

/** Test hook: drop the cached source check. */
export function __resetGrantSourceCache(): void {
  sourceCache = null;
}

/** True once the grants source has at least one successful run on this server.
 *  Cached per process for 5 minutes; concurrent cold callers share one query and
 *  a failure is never cached. */
export function loadGrantSourceSynced(): Promise<boolean> {
  const t = Date.now();
  if (sourceCache && t - sourceCache.at < SOURCE_TTL_MS) return sourceCache.promise;
  const entry = {
    at: t,
    promise: prisma.ingestionRun
      .count({ where: { status: 'SUCCEEDED', dataSource: { slug: GRANTS_SOURCE } } })
      .then((n) => n > 0),
  };
  sourceCache = entry;
  entry.promise.catch(() => {
    if (sourceCache === entry) sourceCache = null;
  });
  return entry.promise;
}

/** The award for a set of DISTINCT active teaching staff ids. Each in-window
 *  project with any of them on it counts once, whole budget. */
export async function grantAward(memberIds: readonly string[], now?: Date): Promise<GrantAwardInput> {
  if (!(await loadGrantSourceSynced())) {
    return { label: GRANT_AWARD_LABEL, points: null, raw: { reason: 'source-not-synced' } };
  }
  const ids = [...new Set(memberIds)];
  if (ids.length === 0) {
    return { label: GRANT_AWARD_LABEL, points: null, raw: { reason: 'no-active-staff' } };
  }
  const window = grantWindow(now ?? new Date());
  const projects = await prisma.researchServiceProject.findMany({
    where: {
      fiscalYearBe: { gte: window.fromFyBe, lte: window.toFyBe },
      members: { some: { facultyMemberId: { in: ids }, ...realDataWhere() } },
      ...realDataWhere(),
    },
    select: { id: true, budgetThb: true },
  });
  const years = window.toFyBe - window.fromFyBe + 1;
  const total = projects.reduce((s, p) => s + (p.budgetThb === null ? 0 : Number(p.budgetThb)), 0);
  const bahtPerYear = total / years;
  const bahtPerStaffPerYear = bahtPerYear / ids.length;
  return {
    label: GRANT_AWARD_LABEL,
    points: awardPoints(bahtPerStaffPerYear),
    raw: {
      bahtPerStaffPerYear,
      bahtPerYear,
      staff: ids.length,
      projects: projects.length,
      windowFyBe: [window.fromFyBe, window.toFyBe],
      floorThb: GRANT_AWARD_FLOOR_THB,
      capThb: GRANT_AWARD_CAP_THB,
      maxPoints: GRANT_AWARD_MAX_POINTS,
      caveat: GRANT_AWARD_CAVEAT,
    },
  };
}
