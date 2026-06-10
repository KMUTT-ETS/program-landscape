import { Prisma } from '@prisma/client';
import type { ScopeLevel } from '@kku/shared';
import { prisma } from './index';
import { programIdsForScope, computeSkillGap, type SkillGapResult } from './gap-analysis';
import { classifySkill } from './program-deep-dive';

// ─────────────────────────────────────────────────────────────────────────────
// Multi-lens Gap Analyzer (gap-lenses.v1)
//
// Seven scope-aware "gap" lenses computed from real data, plus a Composite
// Gap Index that normalises each per-program lens to a 0–100 severity
// (higher = wider gap) and averages the available ones — null-excluded,
// same posture as the health score. One batched query per data domain
// (NOT a 297× per-program fan-out) keeps the university view fast.
//
//   1 skill        — KMITL/LinkedIn demand vs KKU graduate supply (reused)
//   2 content      — peer-review contentGaps (program_peer_reviews JSONB)
//   3 aiReadiness  — curriculum AI integration + AI-displaceable exposure
//   4 recruitment  — fill-rate-vs-plan, competition, registration yield
//   5 staff        — succession risk, aging, research/head, senior share
//   6 demographic  — super-critical (<1.5 applicants/seat) as cohort shrinks
//   7 whiteSpace   — skills ≥N peers teach that NO KKU program covers (portfolio)
// ─────────────────────────────────────────────────────────────────────────────

export const GAP_LENSES_VERSION = 'gap-lenses.v1';

const SUPER_CRITICAL_RATIO = 1.5;
const PUBS_PER_HEAD_TARGET = 2; // 3-yr publications/active faculty considered healthy
const HORIZON_YEARS = 15; // demographic look-ahead

export type GapLensKey =
  | 'skill'
  | 'content'
  | 'aiReadiness'
  | 'recruitment'
  | 'staff'
  | 'demographic';

export interface ProgramGapProfile {
  programId: string;
  code: string;
  nameEn: string;
  nameTh: string;
  facultyId: string;
  facultyNameEn: string;
  content: { major: number; moderate: number; minor: number; total: number; reviewed: boolean };
  ai: {
    curriculumIntegration: number | null;
    skillResilience: number | null;
    displaceableShare: number | null;
    aiNative: number;
    aiAugmented: number;
    aiDisplaceable: number;
    neutral: number;
  };
  recruitment: {
    entryYearBE: number;
    planPerYear: number;
    regReported: number;
    applicants: number;
    fillRateVsPlan: number;
    competitionRatio: number;
    registrationYield: number | null;
  } | null;
  staff: {
    active: number;
    seniorShare: number;
    successionRiskPct: number;
    avgAgeYears: number | null;
    pubsLast3y: number;
    pubsPerHead: number;
  } | null;
  demographic: {
    competitionNow: number;
    superCriticalYear: number | null;
    contraction15yPct: number;
  } | null;
  skill: { relevant: number; covered: number; gaps: number; coveragePct: number } | null;
  /** Per-lens 0–100 gap severity (higher = worse); null = no data. */
  subScores: Record<GapLensKey, number | null>;
  composite: number | null;
}

export interface GapAnalysisResult {
  methodologyVersion: string;
  scope: ScopeLevel;
  scopeId: string | null;
  generatedAt: string;
  programCount: number;
  composite: {
    weights: Record<GapLensKey, number>;
    rows: ProgramGapProfile[]; // ranked by composite desc
    facultyHeatmap: Array<{
      facultyId: string;
      facultyNameEn: string;
      programCount: number;
      avgComposite: number | null;
      subScores: Record<GapLensKey, number | null>;
    }>;
  };
  content: {
    reviewedPrograms: number;
    severity: { major: number; moderate: number; minor: number };
    topTopics: Array<{ topic: string; total: number; major: number; moderate: number; minor: number }>;
    worstPrograms: Array<GapProgRef & { major: number; total: number }>;
  };
  aiReadiness: {
    scoredPrograms: number;
    avgResilience: number | null;
    avgIntegration: number | null;
    skillMix: { aiNative: number; aiAugmented: number; aiDisplaceable: number; neutral: number };
    worstPrograms: Array<GapProgRef & { skillResilience: number; curriculumIntegration: number; aiNative: number; aiDisplaceable: number }>;
  };
  recruitment: {
    coveredPrograms: number;
    underFilling: Array<GapProgRef & { entryYearBE: number; fillRateVsPlan: number; competitionRatio: number; registrationYield: number | null }>;
  };
  staff: {
    coveredPrograms: number;
    atRisk: Array<GapProgRef & { active: number; successionRiskPct: number; avgAgeYears: number | null; seniorShare: number; pubsPerHead: number }>;
  };
  demographic: {
    coveredPrograms: number;
    contraction15yPct: number;
    superCritical: Array<GapProgRef & { competitionNow: number; superCriticalYear: number | null }>;
  };
  whiteSpace: {
    // Market demand KKU does not serve — high-demand skills with little/no KKU
    // graduate supply (potential new-program / track areas). Plus systemic
    // content topics flagged across many programs.
    marketGaps: Array<{ skillId: string; nameEn: string; nameTh: string; demand: number; topCareers: string[] }>;
    systemicTopics: Array<{ topic: string; programCount: number; majorCount: number; sampleFaculties: string[] }>;
    minPrograms: number;
    staffExpertiseNote: string;
  };
  skill: SkillGapResult;
}

/** Shared program reference for lens tables — /programs name style. */
interface GapProgRef {
  programId: string;
  code: string;
  nameEn: string;
  nameTh: string;
  facultyNameEn: string;
}

// ── normalisers (0–100 gap severity; higher = worse) ───────────────────────
const clamp = (n: number) => Math.max(0, Math.min(100, n));

function contentScore(p: ProgramGapProfile): number | null {
  if (!p.content.reviewed) return null;
  return clamp((p.content.major * 3 + p.content.moderate * 2 + p.content.minor) * 7);
}
function aiScore(p: ProgramGapProfile): number | null {
  // Gap severity from AI-readiness. Use skill RESILIENCE (50 = neutral mix;
  // <50 = more AI-displaceable than AI-native/augmented) as the primary
  // signal — it discriminates far better than curriculum integration, which
  // is near-0 for almost every program. Higher gap = less AI-resilient.
  if (p.ai.skillResilience === null) return null;
  const lowResilience = 100 - p.ai.skillResilience;
  const lowIntegration = p.ai.curriculumIntegration === null ? 0 : (100 - p.ai.curriculumIntegration) * 0.3;
  return clamp(0.7 * lowResilience + lowIntegration);
}
function recruitmentScore(p: ProgramGapProfile): number | null {
  if (!p.recruitment) return null;
  const underFill = clamp((1 - p.recruitment.fillRateVsPlan) * 100);
  const weakDemand = clamp(((SUPER_CRITICAL_RATIO - p.recruitment.competitionRatio) / SUPER_CRITICAL_RATIO) * 100);
  return clamp(0.5 * underFill + 0.5 * weakDemand);
}
function staffScore(p: ProgramGapProfile): number | null {
  if (!p.staff) return null;
  const succession = clamp(p.staff.successionRiskPct);
  const lowSenior = clamp(100 - p.staff.seniorShare);
  const lowResearch = clamp(((PUBS_PER_HEAD_TARGET - p.staff.pubsPerHead) / PUBS_PER_HEAD_TARGET) * 100);
  return clamp(0.4 * succession + 0.3 * lowSenior + 0.3 * lowResearch);
}
function demographicScore(p: ProgramGapProfile): number | null {
  if (!p.demographic) return null;
  const y = p.demographic.superCriticalYear;
  if (y === null) return clamp(((SUPER_CRITICAL_RATIO - p.demographic.competitionNow) / SUPER_CRITICAL_RATIO) * 60);
  const now = new Date().getUTCFullYear();
  const yearsAway = y - now;
  if (yearsAway <= 0) return 100;
  return clamp(((HORIZON_YEARS - yearsAway) / HORIZON_YEARS) * 100);
}
function skillScore(p: ProgramGapProfile): number | null {
  if (!p.skill) return null;
  return clamp(100 - p.skill.coveragePct);
}

export async function computeGapAnalysis(
  scope: ScopeLevel,
  scopeId: string | null,
): Promise<GapAnalysisResult> {
  const ids = await programIdsForScope(scope, scopeId ?? undefined);
  const idArr = Prisma.join(ids.length > 0 ? ids : ['__none__']);
  const nowYear = new Date().getUTCFullYear();
  const since3y = nowYear - 3;

  // Program meta.
  const programs = await prisma.program.findMany({
    where: { id: { in: ids } },
    select: { id: true, code: true, nameEn: true, nameTh: true, facultyId: true, level: true, faculty: { select: { nameEn: true } } },
  });

  // ── Batched per-domain queries (run concurrently) ────────────────────────
  const [
    contentRows,
    skillRows,
    recruitRows,
    staffRows,
    pubRows,
    demandRows,
    demoCurveRows,
    skillResult,
    systemicTopicRows,
  ] = await Promise.all([
    // content gaps per program × severity
    prisma.$queryRaw<Array<{ pid: string; sev: string; n: bigint }>>(Prisma.sql`
      SELECT ppr.program_id AS pid, lower(g->>'severity') AS sev, count(*) AS n
      FROM program_peer_reviews ppr,
           jsonb_array_elements(ppr.payload_json->'contentGaps') g
      WHERE ppr.program_id IN (${idArr})
      GROUP BY 1, 2`),
    // program skills (name + weight) for AI classification
    prisma.$queryRaw<Array<{ pid: string; name: string; weight: number }>>(Prisma.sql`
      SELECT ps.program_id AS pid, s.name_en AS name, ps.weight AS weight
      FROM program_skills ps JOIN skills s ON s.id = ps.skill_id
      WHERE ps.program_id IN (${idArr})`),
    // recruitment — latest complete year per program (plan + funnel)
    prisma.$queryRaw<Array<{ pid: string; y: number; plan: number; reported: number; applicants: number; send_ch: number }>>(Prisma.sql`
      WITH agg AS (
        SELECT program_id AS pid, acad_year_be AS y,
               MAX(plan_per_year)::int AS plan,
               COALESCE(SUM(reg_reported), 0)::int AS reported,
               COALESCE(SUM(total_applicants), 0)::int AS applicants,
               COALESCE(SUM(send_clearinghouse), 0)::int AS send_ch
        FROM admission_campaign_stats
        WHERE program_id IN (${idArr}) AND plan_per_year IS NOT NULL
        GROUP BY 1, 2
      )
      SELECT DISTINCT ON (pid) pid, y, plan, reported, applicants, send_ch
      FROM agg
      WHERE plan > 0 AND reported > 0 AND applicants > 0
      ORDER BY pid, y DESC`),
    // staff aggregates per program
    prisma.$queryRaw<Array<{ pid: string; active: bigint; senior: bigint; retiring5: bigint; avg_age: number | null }>>(Prisma.sql`
      SELECT pf.program_id AS pid,
             count(*) FILTER (WHERE fm.is_active) AS active,
             count(*) FILTER (WHERE fm.is_active AND fm.rank IN ('PROF','ASSOC_PROF')) AS senior,
             count(*) FILTER (WHERE fm.is_active AND fm.retirement_date IS NOT NULL AND fm.retirement_date < (now() + interval '5 years')) AS retiring5,
             avg(date_part('year', age(fm.date_of_birth))) FILTER (WHERE fm.is_active AND fm.date_of_birth IS NOT NULL) AS avg_age
      FROM program_faculties pf JOIN faculty_members fm ON fm.id = pf.faculty_member_id
      WHERE pf.program_id IN (${idArr})
      GROUP BY 1`),
    // publications (last 3y) per program's active faculty
    prisma.$queryRaw<Array<{ pid: string; pubs: bigint }>>(Prisma.sql`
      SELECT pf.program_id AS pid, count(ro.id) AS pubs
      FROM program_faculties pf
      JOIN faculty_members fm ON fm.id = pf.faculty_member_id AND fm.is_active
      JOIN research_outputs ro ON ro.faculty_member_id = fm.id AND ro.year >= ${since3y}
      WHERE pf.program_id IN (${idArr})
      GROUP BY 1`),
    // demand-match coverage per program
    prisma.$queryRaw<Array<{ pid: string; relevant: bigint; covered: bigint }>>(Prisma.sql`
      SELECT program_id AS pid,
             count(*) FILTER (WHERE relevant) AS relevant,
             count(*) FILTER (WHERE relevant AND matched) AS covered
      FROM program_demand_matches
      WHERE program_id IN (${idArr})
      GROUP BY 1`),
    // national 18-22 cohort decline curve (for demographic ceiling)
    prisma.$queryRaw<Array<{ year: number; population: number; region: string }>>(Prisma.sql`
      SELECT year, population, region
      FROM demographic_projections
      WHERE age_cohort = '18-22' AND source LIKE 'NESDC-PopProj%'
      ORDER BY year`),
    computeSkillGap({ scope, scopeId: scopeId ?? undefined, limit: 200, excludeSoftSkills: true }),
    // systemic white-spaces: topics ≥3 in-scope programs are flagged missing
    prisma.$queryRaw<Array<{ topic: string; programs: bigint; major: bigint; faculties: string[] }>>(Prisma.sql`
      SELECT g->>'topic' AS topic,
             count(DISTINCT ppr.program_id) AS programs,
             count(*) FILTER (WHERE lower(g->>'severity') = 'major') AS major,
             (array_agg(DISTINCT f.name_en))[1:3] AS faculties
      FROM program_peer_reviews ppr
      JOIN programs p ON p.id = ppr.program_id
      LEFT JOIN faculties f ON f.id = p.faculty_id,
           jsonb_array_elements(ppr.payload_json->'contentGaps') g
      WHERE ppr.program_id IN (${idArr})
      GROUP BY 1
      HAVING count(DISTINCT ppr.program_id) >= 3
      ORDER BY programs DESC, major DESC
      LIMIT 25`),
  ]);

  // ── index the batched results by program ─────────────────────────────────
  const contentByPid = new Map<string, { major: number; moderate: number; minor: number; total: number }>();
  for (const r of contentRows) {
    const c = contentByPid.get(r.pid) ?? { major: 0, moderate: 0, minor: 0, total: 0 };
    const n = Number(r.n);
    if (r.sev === 'major') c.major += n;
    else if (r.sev === 'moderate') c.moderate += n;
    else c.minor += n;
    c.total += n;
    contentByPid.set(r.pid, c);
  }
  const reviewedPids = new Set(contentRows.map((r) => r.pid));

  const aiByPid = new Map<string, { aiNative: number; aiAugmented: number; aiDisplaceable: number; neutral: number; nativeW: number; dispW: number; totalW: number }>();
  for (const r of skillRows) {
    const a = aiByPid.get(r.pid) ?? { aiNative: 0, aiAugmented: 0, aiDisplaceable: 0, neutral: 0, nativeW: 0, dispW: 0, totalW: 0 };
    const cls = classifySkill(r.name ?? '');
    const w = r.weight ?? 0;
    a.totalW += w;
    if (cls === 'aiNative') { a.aiNative++; a.nativeW += w; }
    else if (cls === 'aiAugmented') a.aiAugmented++;
    else if (cls === 'aiDisplaceable') { a.aiDisplaceable++; a.dispW += w; }
    else a.neutral++;
    aiByPid.set(r.pid, a);
  }

  const recruitByPid = new Map(recruitRows.map((r) => [r.pid, r]));
  const staffByPid = new Map(staffRows.map((r) => [r.pid, r]));
  const pubsByPid = new Map(pubRows.map((r) => [r.pid, Number(r.pubs)]));
  const demandByPid = new Map(demandRows.map((r) => [r.pid, r]));

  // demographic decline curve: pick the national region (largest population)
  let curve = new Map<number, number>();
  if (demoCurveRows.length > 0) {
    const byRegion = new Map<string, Array<{ year: number; population: number }>>();
    for (const r of demoCurveRows) {
      const arr = byRegion.get(r.region) ?? [];
      arr.push({ year: r.year, population: r.population });
      byRegion.set(r.region, arr);
    }
    let best: Array<{ year: number; population: number }> = [];
    let bestPop = -1;
    for (const arr of byRegion.values()) {
      const maxPop = Math.max(...arr.map((x) => x.population));
      if (maxPop > bestPop) { bestPop = maxPop; best = arr; }
    }
    curve = new Map(best.map((x) => [x.year, x.population]));
  }
  const popNow = curve.get(nowYear) ?? null;
  const popAt = (y: number): number | null => {
    if (curve.has(y)) return curve.get(y)!;
    // nearest available year ≥ y, else last
    const years = [...curve.keys()].sort((a, b) => a - b);
    const ge = years.find((yr) => yr >= y);
    return ge !== undefined ? curve.get(ge)! : (years.length ? curve.get(years[years.length - 1]!)! : null);
  };

  // ── assemble per-program profiles ────────────────────────────────────────
  const profiles: ProgramGapProfile[] = programs.map((pg) => {
    const c = contentByPid.get(pg.id) ?? { major: 0, moderate: 0, minor: 0, total: 0 };
    const reviewed = reviewedPids.has(pg.id);

    const a = aiByPid.get(pg.id);
    const curriculumIntegration = a && a.totalW > 0 ? clamp((a.nativeW / a.totalW) * 400) : null;
    const totalSkills = a ? a.aiNative + a.aiAugmented + a.aiDisplaceable + a.neutral : 0;
    const displaceableShare = a && totalSkills > 0 ? a.aiDisplaceable / totalSkills : null;
    // Skill resilience (mirrors the deep-dive AI-readiness scorer): 50 = neutral
    // mix; >50 = more AI-native/augmented than AI-displaceable.
    const skillResilience = a && totalSkills > 0
      ? clamp(50 + ((a.aiNative + a.aiAugmented - a.aiDisplaceable) / totalSkills) * 50)
      : null;

    const rec = recruitByPid.get(pg.id);
    const recruitment = rec
      ? {
          entryYearBE: rec.y,
          planPerYear: rec.plan,
          regReported: rec.reported,
          applicants: rec.applicants,
          fillRateVsPlan: rec.plan > 0 ? rec.reported / rec.plan : 0,
          competitionRatio: rec.plan > 0 ? rec.applicants / rec.plan : 0,
          registrationYield: rec.send_ch > 0 ? rec.reported / rec.send_ch : null,
        }
      : null;

    const st = staffByPid.get(pg.id);
    const active = st ? Number(st.active) : 0;
    const staff = st && active > 0
      ? {
          active,
          seniorShare: (Number(st.senior) / active) * 100,
          successionRiskPct: (Number(st.retiring5) / active) * 100,
          avgAgeYears: st.avg_age !== null ? Math.round(st.avg_age) : null,
          pubsLast3y: pubsByPid.get(pg.id) ?? 0,
          pubsPerHead: (pubsByPid.get(pg.id) ?? 0) / active,
        }
      : null;

    // demographic ceiling
    let demographic: ProgramGapProfile['demographic'] = null;
    if (recruitment && popNow && popNow > 0) {
      const competitionNow = recruitment.competitionRatio;
      let superCriticalYear: number | null = null;
      for (let y = nowYear; y <= nowYear + HORIZON_YEARS; y++) {
        const pop = popAt(y);
        if (pop === null) break;
        const projComp = competitionNow * (pop / popNow);
        if (projComp < SUPER_CRITICAL_RATIO) { superCriticalYear = y; break; }
      }
      const pop15 = popAt(nowYear + 15);
      const contraction15yPct = pop15 !== null ? Math.max(0, (1 - pop15 / popNow) * 100) : 0;
      demographic = { competitionNow, superCriticalYear, contraction15yPct };
    }

    const dm = demandByPid.get(pg.id);
    const relevant = dm ? Number(dm.relevant) : 0;
    const skill = dm && relevant > 0
      ? { relevant, covered: Number(dm.covered), gaps: relevant - Number(dm.covered), coveragePct: (Number(dm.covered) / relevant) * 100 }
      : null;

    const profile: ProgramGapProfile = {
      programId: pg.id,
      code: pg.code,
      nameEn: pg.nameEn,
      nameTh: pg.nameTh,
      facultyId: pg.facultyId,
      facultyNameEn: pg.faculty?.nameEn ?? '—',
      content: { ...c, reviewed },
      ai: {
        curriculumIntegration,
        skillResilience,
        displaceableShare,
        aiNative: a?.aiNative ?? 0,
        aiAugmented: a?.aiAugmented ?? 0,
        aiDisplaceable: a?.aiDisplaceable ?? 0,
        neutral: a?.neutral ?? 0,
      },
      recruitment,
      staff,
      demographic,
      skill,
      subScores: { skill: null, content: null, aiReadiness: null, recruitment: null, staff: null, demographic: null },
      composite: null,
    };

    profile.subScores = {
      skill: skillScore(profile),
      content: contentScore(profile),
      aiReadiness: aiScore(profile),
      recruitment: recruitmentScore(profile),
      staff: staffScore(profile),
      demographic: demographicScore(profile),
    };
    const present = (Object.values(profile.subScores).filter((v) => v !== null) as number[]);
    profile.composite = present.length > 0 ? present.reduce((s, v) => s + v, 0) / present.length : null;
    return profile;
  });

  const ranked = [...profiles].sort((a, b) => (b.composite ?? -1) - (a.composite ?? -1));

  // faculty heatmap
  const byFaculty = new Map<string, ProgramGapProfile[]>();
  for (const p of profiles) {
    const arr = byFaculty.get(p.facultyId) ?? [];
    arr.push(p);
    byFaculty.set(p.facultyId, arr);
  }
  const LENS_KEYS: GapLensKey[] = ['skill', 'content', 'aiReadiness', 'recruitment', 'staff', 'demographic'];
  const avg = (vals: Array<number | null>): number | null => {
    const v = vals.filter((x): x is number => x !== null);
    return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
  };
  const facultyHeatmap = [...byFaculty.entries()]
    .map(([facultyId, arr]) => ({
      facultyId,
      facultyNameEn: arr[0]!.facultyNameEn,
      programCount: arr.length,
      avgComposite: avg(arr.map((p) => p.composite)),
      subScores: Object.fromEntries(LENS_KEYS.map((k) => [k, avg(arr.map((p) => p.subScores[k]))])) as Record<GapLensKey, number | null>,
    }))
    .sort((a, b) => (b.avgComposite ?? -1) - (a.avgComposite ?? -1));

  // ── lens summaries ───────────────────────────────────────────────────────
  // content topics across scope
  const topicMap = new Map<string, { total: number; major: number; moderate: number; minor: number }>();
  const topicRows = await prisma.$queryRaw<Array<{ topic: string; sev: string; n: bigint }>>(Prisma.sql`
    SELECT g->>'topic' AS topic, lower(g->>'severity') AS sev, count(*) AS n
    FROM program_peer_reviews ppr, jsonb_array_elements(ppr.payload_json->'contentGaps') g
    WHERE ppr.program_id IN (${idArr})
    GROUP BY 1, 2`);
  for (const r of topicRows) {
    const t = topicMap.get(r.topic) ?? { total: 0, major: 0, moderate: 0, minor: 0 };
    const n = Number(r.n);
    t.total += n;
    if (r.sev === 'major') t.major += n;
    else if (r.sev === 'moderate') t.moderate += n;
    else t.minor += n;
    topicMap.set(r.topic, t);
  }
  const topTopics = [...topicMap.entries()]
    .map(([topic, v]) => ({ topic, ...v }))
    .sort((a, b) => b.major - a.major || b.total - a.total)
    .slice(0, 15);
  const sev = { major: 0, moderate: 0, minor: 0 };
  for (const p of profiles) { sev.major += p.content.major; sev.moderate += p.content.moderate; sev.minor += p.content.minor; }

  const mix = profiles.reduce(
    (m, p) => ({ aiNative: m.aiNative + p.ai.aiNative, aiAugmented: m.aiAugmented + p.ai.aiAugmented, aiDisplaceable: m.aiDisplaceable + p.ai.aiDisplaceable, neutral: m.neutral + p.ai.neutral }),
    { aiNative: 0, aiAugmented: 0, aiDisplaceable: 0, neutral: 0 },
  );
  const aiScored = profiles.filter((p) => p.ai.skillResilience !== null);
  const ref = (p: ProgramGapProfile): GapProgRef => ({
    programId: p.programId, code: p.code, nameEn: p.nameEn, nameTh: p.nameTh, facultyNameEn: p.facultyNameEn,
  });

  // Market white-spaces: high labour-market demand with little/no KKU supply.
  const marketGaps = skillResult.rows
    .filter((r) => r.demand > 0 && r.supply < r.demand * 0.25)
    .sort((a, b) => b.demand - a.demand)
    .slice(0, 20)
    .map((r) => ({ skillId: r.skillId, nameEn: r.nameEn, nameTh: r.nameTh, demand: Math.round(r.demand), topCareers: r.topDemandingEmployers.slice(0, 3) }));

  return {
    methodologyVersion: GAP_LENSES_VERSION,
    scope,
    scopeId: scopeId ?? null,
    generatedAt: new Date().toISOString(),
    programCount: profiles.length,
    composite: {
      weights: { skill: 1, content: 1, aiReadiness: 1, recruitment: 1, staff: 1, demographic: 1 },
      rows: ranked,
      facultyHeatmap,
    },
    content: {
      reviewedPrograms: reviewedPids.size,
      severity: sev,
      topTopics,
      worstPrograms: [...profiles]
        .filter((p) => p.content.reviewed)
        .sort((a, b) => b.content.major - a.content.major || b.content.total - a.content.total)
        .slice(0, 12)
        .map((p) => ({ ...ref(p), major: p.content.major, total: p.content.total })),
    },
    aiReadiness: {
      scoredPrograms: aiScored.length,
      avgResilience: aiScored.length ? Math.round(aiScored.reduce((s, p) => s + (p.ai.skillResilience ?? 0), 0) / aiScored.length) : null,
      avgIntegration: aiScored.length ? Math.round(aiScored.reduce((s, p) => s + (p.ai.curriculumIntegration ?? 0), 0) / aiScored.length) : null,
      skillMix: mix,
      worstPrograms: [...aiScored]
        .sort((a, b) => (a.ai.skillResilience ?? 0) - (b.ai.skillResilience ?? 0))
        .slice(0, 12)
        .map((p) => ({ ...ref(p), skillResilience: Math.round(p.ai.skillResilience ?? 0), curriculumIntegration: Math.round(p.ai.curriculumIntegration ?? 0), aiNative: p.ai.aiNative, aiDisplaceable: p.ai.aiDisplaceable })),
    },
    recruitment: {
      coveredPrograms: profiles.filter((p) => p.recruitment).length,
      underFilling: profiles
        .filter((p) => p.recruitment)
        .sort((a, b) => (recruitmentScore(b) ?? 0) - (recruitmentScore(a) ?? 0))
        .slice(0, 12)
        .map((p) => ({ ...ref(p), entryYearBE: p.recruitment!.entryYearBE, fillRateVsPlan: Math.round(p.recruitment!.fillRateVsPlan * 100), competitionRatio: Math.round(p.recruitment!.competitionRatio * 100) / 100, registrationYield: p.recruitment!.registrationYield !== null ? Math.round(p.recruitment!.registrationYield * 100) : null })),
    },
    staff: {
      coveredPrograms: profiles.filter((p) => p.staff).length,
      atRisk: profiles
        .filter((p) => p.staff)
        .sort((a, b) => (staffScore(b) ?? 0) - (staffScore(a) ?? 0))
        .slice(0, 12)
        .map((p) => ({ ...ref(p), active: p.staff!.active, successionRiskPct: Math.round(p.staff!.successionRiskPct), avgAgeYears: p.staff!.avgAgeYears, seniorShare: Math.round(p.staff!.seniorShare), pubsPerHead: Math.round(p.staff!.pubsPerHead * 10) / 10 })),
    },
    demographic: {
      coveredPrograms: profiles.filter((p) => p.demographic).length,
      contraction15yPct: profiles.find((p) => p.demographic)?.demographic?.contraction15yPct ?? 0,
      superCritical: profiles
        .filter((p) => p.demographic && (p.demographic.superCriticalYear !== null))
        .sort((a, b) => (a.demographic!.superCriticalYear ?? 9999) - (b.demographic!.superCriticalYear ?? 9999))
        .slice(0, 12)
        .map((p) => ({ ...ref(p), competitionNow: Math.round(p.demographic!.competitionNow * 100) / 100, superCriticalYear: p.demographic!.superCriticalYear })),
    },
    whiteSpace: {
      marketGaps,
      systemicTopics: systemicTopicRows.map((r) => ({
        topic: r.topic,
        programCount: Number(r.programs),
        majorCount: Number(r.major),
        sampleFaculties: (r.faculties ?? []).filter(Boolean),
      })),
      minPrograms: 3,
      staffExpertiseNote:
        'Staff-expertise / research-field white-spaces are not yet computable — FacultyMember.specialization is unpopulated and ResearchOutput carries no field/concept tags. Market-demand white-spaces (above) are shown instead.',
    },
    skill: skillResult,
  };
}
