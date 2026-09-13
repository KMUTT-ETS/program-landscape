import { prisma } from './index';
import { realDataWhere } from './data-quality';
import {
  aggregateProgramJobThaiDemand,
  distinctiveDemand,
  isEligibleJobThaiLink,
  OCCUPATION_SKILL_DEMAND_FLOOR,
  type ProgramJobThaiDemand,
} from './jobthai-bridge';
import { DEMAND_SOURCE_JOBTHAI, demandMatchSourceWhere } from './demand-match-sources';

// ─────────────────────────────────────────────────────────────────────────────
// JobThai read helpers.
//
// Everything here filters through realDataWhere(), so a row written without an
// ingestion_run_id is invisible — which is deliberate, and the reason
// job_postings gained that column on 2026-09-13.
//
// CAVEATS THAT TRAVEL WITH EVERY FIGURE FROM THIS SOURCE, measured over the
// 2026-09 drop (47,631 postings):
//   - 37.0% Bangkok, 3.3% across the 20 Northeast provinces, Khon Kaen 304.
//     This describes the national labour market, not KKU's region.
//   - 0.8% mention a postgraduate qualification and only 41 state one as the
//     minimum, so it is near-blind to 179 of KKU's 297 programmes.
//   - No salary, no employer name, no posting date in the source.
// ─────────────────────────────────────────────────────────────────────────────

export const JOBTHAI_SOURCE = 'jobthai';

/** The 20 Northeast provinces, for the regional caveat and Isan-scoped reads. */
export const ISAN_PROVINCES = [
  'ขอนแก่น', 'นครราชสีมา', 'อุดรธานี', 'อุบลราชธานี', 'ร้อยเอ็ด', 'มหาสารคาม',
  'กาฬสินธุ์', 'สกลนคร', 'เลย', 'หนองคาย', 'ชัยภูมิ', 'บุรีรัมย์', 'สุรินทร์',
  'ศรีสะเกษ', 'ยโสธร', 'อำนาจเจริญ', 'หนองบัวลำภู', 'นครพนม', 'มุกดาหาร', 'บึงกาฬ',
] as const;

export interface JobThaiCoverage {
  totalPostings: number;
  bangkokPostings: number;
  isanPostings: number;
  khonKaenPostings: number;
  postgraduateMinimumPostings: number;
  withFieldOfStudy: number;
  distinctOccupations: number;
  estimatedDatePostings: number;
}

/**
 * The numbers a provenance drawer needs. Computed rather than hardcoded so the
 * caveat cannot drift away from the data after a new drop lands.
 */
export async function jobThaiCoverage(): Promise<JobThaiCoverage> {
  const where = { source: JOBTHAI_SOURCE, ...realDataWhere() };
  const [total, bangkok, isan, khonKaen, postgrad, estimated, occupations] = await Promise.all([
    prisma.jobPosting.count({ where }),
    prisma.jobPosting.count({ where: { ...where, province: 'กรุงเทพมหานคร' } }),
    prisma.jobPosting.count({ where: { ...where, province: { in: [...ISAN_PROVINCES] } } }),
    prisma.jobPosting.count({ where: { ...where, province: 'ขอนแก่น' } }),
    prisma.jobPosting.count({ where: { ...where, minEducationLevel: { in: ['MASTER', 'DOCTORATE'] } } }),
    prisma.jobPosting.count({ where: { ...where, postedDateEstimated: true } }),
    prisma.jobThaiOccupation.count(),
  ]);
  const withField = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*)::bigint AS n FROM job_postings
    WHERE source = ${JOBTHAI_SOURCE} AND array_length(required_fields_raw, 1) > 0`;
  return {
    totalPostings: total,
    bangkokPostings: bangkok,
    isanPostings: isan,
    khonKaenPostings: khonKaen,
    postgraduateMinimumPostings: postgrad,
    withFieldOfStudy: Number(withField[0]?.n ?? 0),
    distinctOccupations: occupations,
    estimatedDatePostings: estimated,
  };
}

export interface OccupationSummary {
  id: string;
  code: string;
  category: string;
  subcategory: string;
  postingCount: number;
  skillCount: number;
  topSkills: Array<{ skillId: string; nameTh: string; nameEn: string; share: number; postingCount: number }>;
}

/** Occupations with their most-demanded skills, biggest first. */
export async function listJobThaiOccupations(limit = 50, topSkillsPer = 8): Promise<OccupationSummary[]> {
  const rows = await prisma.jobThaiOccupation.findMany({
    orderBy: { postingCount: 'desc' },
    take: limit,
    select: {
      id: true, code: true, category: true, subcategory: true, postingCount: true,
      _count: { select: { skills: true } },
      skills: {
        orderBy: { postingCount: 'desc' },
        take: topSkillsPer,
        select: { skillId: true, share: true, postingCount: true, skill: { select: { nameTh: true, nameEn: true } } },
      },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    category: r.category,
    subcategory: r.subcategory,
    postingCount: r.postingCount,
    skillCount: r._count.skills,
    topSkills: r.skills.map((s) => ({
      skillId: s.skillId,
      nameTh: s.skill.nameTh,
      nameEn: s.skill.nameEn,
      share: s.share,
      postingCount: s.postingCount,
    })),
  }));
}

/** Most-demanded fields of study, for the programme bridge in Plan B. */
export async function topFieldsOfStudy(limit = 40): Promise<Array<{ field: string; postings: number }>> {
  const rows = await prisma.$queryRaw<Array<{ field: string; postings: bigint }>>`
    SELECT unnest(required_fields_raw) AS field, COUNT(*)::bigint AS postings
    FROM job_postings
    WHERE source = ${JOBTHAI_SOURCE}
    GROUP BY 1
    ORDER BY 2 DESC
    LIMIT ${limit}`;
  return rows.map((r) => ({ field: r.field, postings: Number(r.postings) }));
}

// ── Per-programme skill demand ─────────────────────────────────────────────
//
// ONE loader for the two consumers that must agree: the health score's
// `jobthai_demand_alignment` driver and the Deep-Dive Skills coverage section.
// The aggregation rule itself is the pure `aggregateProgramJobThaiDemand`.

let _genericCache: { at: number; generic: Set<string>; occupationCount: number } | null = null;
const GENERIC_CACHE_TTL_MS = 10 * 60 * 1000;

/** Skills most occupations demand — recomputed from the data, cached briefly. */
export async function jobThaiGenericSkills(): Promise<{ generic: Set<string>; occupationCount: number }> {
  const now = Date.now();
  if (_genericCache && now - _genericCache.at < GENERIC_CACHE_TTL_MS) return _genericCache;
  const [rows, occupationCount] = await Promise.all([
    prisma.jobThaiOccupationSkill.findMany({
      where: { share: { gte: OCCUPATION_SKILL_DEMAND_FLOOR } },
      select: { jobThaiOccupationId: true, skillId: true, share: true },
    }),
    prisma.jobThaiOccupation.count(),
  ]);
  const { generic } = distinctiveDemand(
    rows.map((r) => ({ occupationId: r.jobThaiOccupationId, skillId: r.skillId, share: r.share })),
    occupationCount,
  );
  _genericCache = { at: now, generic, occupationCount };
  return _genericCache;
}

/** Test seam — the cache is per-process. */
export function invalidateJobThaiGenericSkillsCache(): void {
  _genericCache = null;
}

export interface ProgramJobThaiDemandDetail extends ProgramJobThaiDemand {
  /** The eligible occupations, most postings first — the "which jobs" evidence. */
  linkedOccupations: Array<{
    occupationId: string;
    category: string;
    subcategory: string;
    linkSource: string;
    score: number;
    postingCount: number;
  }>;
}

export async function programJobThaiDemand(programId: string): Promise<ProgramJobThaiDemandDetail> {
  const links = await prisma.programJobThaiLink.findMany({
    where: { programId, ...realDataWhere() },
    select: {
      jobThaiOccupationId: true, linkSource: true, score: true, postingCount: true,
      occupation: { select: { category: true, subcategory: true } },
    },
    orderBy: { postingCount: 'desc' },
  });
  const linkInputs = links.map((l) => ({
    occupationId: l.jobThaiOccupationId,
    linkSource: l.linkSource,
    score: l.score,
    postingCount: l.postingCount,
  }));
  const eligibleIds = linkInputs
    .filter(isEligibleJobThaiLink)
    .map((l) => l.occupationId);

  const [{ generic }, occupationSkills] = await Promise.all([
    jobThaiGenericSkills(),
    eligibleIds.length === 0
      ? Promise.resolve([])
      : prisma.jobThaiOccupationSkill.findMany({
          where: { jobThaiOccupationId: { in: eligibleIds } },
          select: { jobThaiOccupationId: true, skillId: true, share: true },
        }),
  ]);

  const aggregate = aggregateProgramJobThaiDemand({
    links: linkInputs,
    occupationSkills: occupationSkills.map((r) => ({ occupationId: r.jobThaiOccupationId, skillId: r.skillId, share: r.share })),
    generic,
  });
  const eligible = new Set(eligibleIds);
  return {
    ...aggregate,
    linkedOccupations: links
      .filter((l) => eligible.has(l.jobThaiOccupationId))
      .map((l) => ({
        occupationId: l.jobThaiOccupationId,
        category: l.occupation.category,
        subcategory: l.occupation.subcategory,
        linkSource: l.linkSource,
        score: l.score,
        postingCount: l.postingCount,
      })),
  };
}

export interface JobThaiSkillMatch {
  skillId: string;
  matched: boolean;
  relevant: boolean;
  relatedness: number | null;
  matchSource: string | null;
  evidenceQuote: string | null;
  matchedTaughtSkillId: string | null;
  /** demand-match.v4 fit class; null on rows written by v3. */
  fit: string | null;
  fitReason: string | null;
}

export interface ProgramJobThaiSkillCoverage {
  demand: ProgramJobThaiDemandDetail;
  /** Non-generic demanded skills sent to the AI curriculum check, highest share first. */
  checklist: string[];
  /** AI decisions for checklist skills, tagged as JobThai demand. Empty until the check runs. */
  matches: Map<string, JobThaiSkillMatch>;
}

/**
 * Demand plus the AI curriculum decisions for it. Read by BOTH the
 * `jobthai_demand_alignment` driver and the Deep-Dive Skills coverage section.
 */
export async function programJobThaiSkillCoverage(programId: string): Promise<ProgramJobThaiSkillCoverage> {
  const demand = await programJobThaiDemand(programId);
  const checklist = demand.status === 'ok' ? demand.demand.filter((d) => !d.generic).map((d) => d.skillId) : [];
  const rows = checklist.length === 0
    ? []
    : await prisma.programDemandMatch.findMany({
        where: { programId, skillId: { in: checklist }, ...demandMatchSourceWhere(DEMAND_SOURCE_JOBTHAI), ...realDataWhere() },
        select: {
          skillId: true, matched: true, relevant: true, relatedness: true,
          matchSource: true, evidenceQuote: true, matchedTaughtSkillId: true,
          fit: true, fitReason: true,
        },
      });
  return {
    demand,
    checklist,
    matches: new Map(rows.map((r) => [r.skillId, {
      skillId: r.skillId,
      matched: r.matched,
      relevant: r.relevant,
      relatedness: r.relatedness ?? null,
      matchSource: r.matchSource ?? null,
      evidenceQuote: r.evidenceQuote ?? null,
      matchedTaughtSkillId: r.matchedTaughtSkillId ?? null,
      fit: r.fit ?? null,
      fitReason: r.fitReason ?? null,
    }])),
  };
}
