// Inputs the Relevance dimension reads that are expensive or shared:
// the LinkedIn-via-MHESI skill alignment of every programme (memoised), and
// the programme's intake as a share of the projected regional cohort.

import { prisma } from '../index';
import { realDataWhere } from '../data-quality';
import { NATIONAL_REGION, projectionRegionForInstitution } from '../projection-region';
import { eligibleProjectionRegions, pickProjectionSource } from '../projection-source';
import { HEALTH_SCORE_TUNING } from './tuning';

const KMITL_DEMAND_THRESHOLD_PCT = HEALTH_SCORE_TUNING.relevance.linkedInSkillDemandThresholdPct;
const KMITL_QUADRANT_FALLBACK = [
  { dataScope: 'THAILAND' as const, dataSource: 'JOB_POSTINGS' as const },
  { dataScope: 'GLOBAL' as const,   dataSource: 'JOB_POSTINGS' as const },
  { dataScope: 'THAILAND' as const, dataSource: 'PROFILES' as const },
  { dataScope: 'GLOBAL' as const,   dataSource: 'PROFILES' as const },
] as const;

// Per-process memo with 60s TTL. The map is the same for every program
// + scope (it's a global program-skill ↔ KMITL-demand alignment), so
// when computeHealthScores runs in a fan-out (cockpit/matrix calls it
// once per program, ~297 times) we don't redo this expensive scan-of-
// all-programSkills 297 times. 60s window: long enough to coalesce a
// request burst, short enough to pick up new ProgramSkill rows from the
// AI extraction queue. Reset implicitly on Prisma client recreation
// (dev hot reload). Verified prod 2026-05-10: cockpit/matrix was
// hitting Postgres connection limit due to the per-program fan-out.
let _kmitlAlignmentCache: { at: number; map: Map<string, number> } | null = null;
const KMITL_ALIGNMENT_TTL_MS = 60_000;

export async function computeKmitlProgramAlignment(): Promise<Map<string, number>> {
  const now = Date.now();
  if (_kmitlAlignmentCache && now - _kmitlAlignmentCache.at < KMITL_ALIGNMENT_TTL_MS) {
    return _kmitlAlignmentCache.map;
  }
  const map = await _computeKmitlProgramAlignmentImpl();
  _kmitlAlignmentCache = { at: now, map };
  return map;
}

async function _computeKmitlProgramAlignmentImpl(): Promise<Map<string, number>> {
  const programSkills = await prisma.programSkill.findMany({
    select: { programId: true, skillId: true },
  });
  if (programSkills.length === 0) return new Map();
  const skillsByProgram = new Map<string, Set<string>>();
  for (const ps of programSkills) {
    const set = skillsByProgram.get(ps.programId) ?? new Set();
    set.add(ps.skillId);
    skillsByProgram.set(ps.programId, set);
  }
  const out = new Map<string, number>();
  const programIds = [...skillsByProgram.keys()];
  for (const quadrant of KMITL_QUADRANT_FALLBACK) {
    const remaining = programIds.filter((id) => !out.has(id));
    if (remaining.length === 0) break;
    const demandRows = await prisma.kmitlCareerSkillDemand.findMany({
      where: {
        dataScope: quadrant.dataScope,
        dataSource: quadrant.dataSource,
        percentage: { gte: KMITL_DEMAND_THRESHOLD_PCT },
        skillId: { not: null },
        ...realDataWhere(),
      },
      select: { skillId: true },
      distinct: ['skillId'],
    });
    if (demandRows.length === 0) continue;
    const demanded = new Set(demandRows.map((r) => r.skillId!).filter(Boolean));
    for (const pid of remaining) {
      const skills = skillsByProgram.get(pid)!;
      let matched = 0;
      for (const sid of skills) if (demanded.has(sid)) matched++;
      if (matched > 0 && skills.size > 0) out.set(pid, (matched / skills.size) * 100);
    }
  }
  return out;
}

export interface RequiredShareResult {
  share: number | null;
  /** The projection region used; null when none resolved. */
  region: string | null;
  /** The projection source used; null when none was picked. */
  source?: string | null;
  /** Why the share is null, when it is. */
  reason: string | null;
}

// The demographic curve in the driver (tuning.ts
// `demographicRequiredShareForZero`) is calibrated for a REGIONAL cohort, so the
// national 'TH' series is never substituted: an unset or unmatched region
// leaves the driver null (a data gap, not a score).
export async function computeRequiredShareAt10Y(
  programId: string,
  level: 'BACHELOR' | 'MASTER' | 'DOCTORAL' | 'HIGHER_GRAD_DIPLOMA',
): Promise<RequiredShareResult> {
  const cohort = level === 'BACHELOR' ? '18-22' : '23-29';
  const targetYear = new Date().getUTCFullYear() + 10;
  // Regions carried by an eligible source (national row now and at +10); the
  // best source for the resolved region is picked below.
  const regions = await eligibleProjectionRegions({ cohort });
  const region = projectionRegionForInstitution(regions);
  if (region === NATIONAL_REGION) {
    return {
      share: null,
      region: null,
      source: null,
      reason:
        'region-not-set: set the organisation region to one of the projection regions (' +
        regions.filter((r) => r !== NATIONAL_REGION).join(', ') +
        ')',
    };
  }
  const source = await pickProjectionSource({ cohort, needRegion: region });
  if (!source) return { share: null, region, source: null, reason: 'no-projection' };
  const projection = await prisma.demographicProjection.findFirst({
    where: {
      region,
      ageCohort: cohort,
      year: targetYear,
      source,
    },
    select: { population: true },
  });
  if (!projection || projection.population <= 0) return { share: null, region, source, reason: 'no-projection' };
  const enrollment = await prisma.enrollmentMetric.findMany({
    where: { programId, ...realDataWhere() },
    orderBy: { academicYear: 'desc' },
    take: 2,
    select: { enrolled: true },
  });
  if (enrollment.length === 0) return { share: null, region, source, reason: 'no-enrollment' };
  // Use the prior year if it's higher (in-progress current year is
  // partial — enrolled count would be too small).
  const baseline = enrollment.length >= 2 && enrollment[1]!.enrolled > enrollment[0]!.enrolled
    ? enrollment[1]!.enrolled
    : enrollment[0]!.enrolled;
  if (baseline === 0) return { share: null, region, source, reason: 'no-enrollment' };
  return { share: baseline / projection.population, region, source, reason: null };
}
