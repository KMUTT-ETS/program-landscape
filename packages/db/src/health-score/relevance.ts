import type { ScopeLevel } from '../scope';
import { prisma } from '../index';
import { realDataWhere } from '../data-quality';
import { JOBTHAI_MIN_LINK_SCORE, JOBTHAI_MIN_POSTINGS_FOR_SIGNAL, JOBTHAI_MIN_RELEVANT_SKILLS } from '../jobthai-bridge';
import { programJobThaiSkillCoverage } from '../jobthai';
import { DEMAND_SOURCE_LINKEDIN, demandMatchSourceWhere } from '../demand-match-sources';
import type { HealthScore } from './schema';
import { HEALTH_SCORE_TUNING } from './tuning';
import { clamp } from './curves';
import { computeRequiredShareAt10Y } from './relevance-inputs';
import { noDataScore, summariseDrivers } from './summarise';
import { collectProgramIdsForScope } from './scope-tree';
import { getProgramScoreIndex, rolledUpDriver } from './program-index';

const T = HEALTH_SCORE_TUNING.relevance;
const STRATEGIC_KMITL_GROUPS = new Set(T.strategicCareerGroups);

// ──────────────────────────────────────────────────────────────────────────
// Relevance — labour-market alignment + demand-match + demographic +
// strategic-sector. Most signals real after the connector flips on
// 2026-04-27 → 2026-05-02.
// ──────────────────────────────────────────────────────────────────────────

// ── jobthai_demand_alignment driver (added v5.1) ─────────────────────
//
// Share of a programme's taught skills that its linked JobThai occupations
// demand. The direct analogue of `labour_market_alignment`, which reads the
// LinkedIn-via-MHESI feed, so the two are comparable and can visibly disagree.
//
// NULL, NEVER 0, in three cases, each a data gap rather than poor performance:
//   - the programme has no eligible link. For postgraduate programmes that is
//     by design: the bridge admits only postings whose stated minimum is a
//     postgraduate qualification, and just 41 of 47,631 postings do. 82% of
//     doctoral programmes DO match a field of study, but those matches sit on
//     bachelor-level adverts, and scoring a PhD on undergraduate vacancies
//     would look healthy and be wrong;
//   - the postings behind its links total fewer than
//     JOBTHAI_MIN_POSTINGS_FOR_SIGNAL (20, the measured 25th percentile);
//   - the programme has no taught skills, so the denominator is zero.
async function jobThaiDemandAlignmentDriver(
  programId: string,
): Promise<HealthScore['drivers'][number]> {
  const label = 'jobthai_demand_alignment';
  // One loader shared with the Deep-Dive Skills coverage section (v5.2), so the
  // score and the gap list a reader sees beside it cannot disagree.
  const { demand, checklist, matches } = await programJobThaiSkillCoverage(programId);
  if (demand.status !== 'ok') {
    return {
      label,
      value: null,
      raw: { reason: demand.status, occupations: demand.occupations, postings: demand.postings, floor: JOBTHAI_MIN_POSTINGS_FOR_SIGNAL, minLinkScore: JOBTHAI_MIN_LINK_SCORE },
    };
  }

  // v5.2: the AI curriculum check decides whether each demanded skill is taught
  // and whether it is relevant to the discipline — the same instrument as
  // demand_match_filled. Exact skill-ID overlap read 0 for 29 of 41 programmes
  // on dev, because curricula say "Legal Drafting" where postings say
  // "Litigation". Generic skills are not on the checklist: teaching
  // communication says nothing about fit to this field's jobs.
  const rows = [...matches.values()];
  const relevant = rows.filter((r) => r.relevant);
  if (relevant.length < JOBTHAI_MIN_RELEVANT_SKILLS) {
    return {
      label,
      value: null,
      raw: {
        reason: rows.length === 0
          ? 'curriculum match not yet computed for JobThai demand'
          : `only ${relevant.length} relevant JobThai-demanded skills — below the ${JOBTHAI_MIN_RELEVANT_SKILLS}-skill floor`,
        relevantDemanded: relevant.length,
        demandedSkills: checklist.length,
        occupations: demand.occupations,
        postings: demand.postings,
      },
    };
  }
  const matched = relevant.filter((r) => r.matched).length;

  return {
    label,
    value: clamp((matched / relevant.length) * 100),
    raw: {
      relevantDemanded: relevant.length,
      matchedDemanded: matched,
      checkedSkills: rows.length,
      demandedSkills: checklist.length,
      occupations: demand.occupations,
      postings: demand.postings,
      // Carried so a provenance drawer can state the caveat with numbers: this
      // is a national signal, 37% Bangkok and 3.3% Northeast.
      source: 'jobthai',
    },
  };
}

export async function scoreRelevanceProgram(
  programId: string,
  kmitlAlignment: number | null,
): Promise<HealthScore> {
  // Demand-match: share of *relevant* demanded skills the curriculum
  // already teaches. Only counts rows where relevant=true.
  const matchRows = await prisma.programDemandMatch.findMany({
    where: { programId, relevant: true, ...demandMatchSourceWhere(DEMAND_SOURCE_LINKEDIN), ...realDataWhere() },
    select: { matched: true },
  });
  let demandMatchValue: number | null = null;
  if (matchRows.length > 0) {
    const matched = matchRows.filter((r) => r.matched).length;
    demandMatchValue = clamp((matched / matchRows.length) * 100);
  }

  // Demographic resilience: inverted required cohort share at +10y.
  const program = await prisma.program.findUnique({
    where: { id: programId },
    select: { kmitlCareerIds: true, level: true },
  });
  const demo = await computeRequiredShareAt10Y(programId, program?.level ?? 'BACHELOR');
  const demoOutlook = demo.share;
  let demoValue: number | null = null;
  if (demoOutlook !== null) {
    // requiredShare 0 → 100; half of T.demographicRequiredShareForZero
    // (0.1% as published) → 50; the full share (0.2%) or more → 0.
    demoValue = clamp(100 - (demoOutlook / T.demographicRequiredShareForZero) * 100);
  }

  // Strategic-sector alignment: T.strategicSectorScore if any KMITL career
  // maps to a strategic-sector group; T.nonStrategicSectorScore otherwise.
  let sectorValue: number | null = null;
  if (program && program.kmitlCareerIds.length > 0) {
    const careers = await prisma.kmitlCareer.findMany({
      where: { kmitlCareerId: { in: program.kmitlCareerIds }, ...realDataWhere() },
      select: { groupName: true },
    });
    const inStrategic = careers.some((c) => STRATEGIC_KMITL_GROUPS.has(c.groupName));
    sectorValue = inStrategic ? T.strategicSectorScore : T.nonStrategicSectorScore;
  }

  // v3.6: pedagogical_fit driver — discipline-fit score from
  // ProgramPedagogyAssessment.overallScore (`program-pedagogy.v1`).
  // Null when the assessment hasn't run yet — completeness drops, no
  // penalty applied.
  const pedagogyAssessment = await prisma.programPedagogyAssessment.findUnique({
    where: { programId },
    select: { overallScore: true, disciplineFitScore: true, qaScore: true },
  });
  const pedagogicalFit: number | null = pedagogyAssessment?.overallScore ?? null;

  const drivers = [
    {
      label: 'labour_market_alignment',
      value: kmitlAlignment === null ? null : clamp(kmitlAlignment),
      raw: kmitlAlignment,
    },
    { label: 'demand_match_filled', value: demandMatchValue, raw: { totalRelevant: matchRows.length } },
    { label: 'demographic_resilience', value: demoValue, raw: { requiredShare10y: demoOutlook, region: demo.region, source: demo.source ?? null, reason: demo.reason } },
    // `targetedCareers` is the raw-payload field surfaced on the
    // hover tooltip for this driver. It's the COUNT of LinkedIn-demand
    // career groups the program has been mapped to — used to
    // disambiguate "high score because actually strategic" from "high
    // score from a fluke 1-career match". We deliberately don't say
    // "kmitl" in any user-visible string — KMITL is the API host, the
    // data origin is LinkedIn (subscribed by MHESI). See
    // memory/feedback_kmitl_data_attribution.md.
    { label: 'strategic_sector_alignment', value: sectorValue, raw: { targetedCareers: program?.kmitlCareerIds.length ?? 0 } },
    await jobThaiDemandAlignmentDriver(programId),
    {
      label: 'pedagogical_fit',
      value: pedagogicalFit === null ? null : clamp(pedagogicalFit),
      raw: pedagogyAssessment
        ? {
            overall: pedagogyAssessment.overallScore,
            disciplineFit: pedagogyAssessment.disciplineFitScore,
            qa: pedagogyAssessment.qaScore,
          }
        : null,
    },
  ];
  return summariseDrivers('relevance', drivers);
}

export async function scoreRelevanceScope(
  scopeId: string,
  scope: ScopeLevel,
  programAlignment: Map<string, number>,
): Promise<HealthScore> {
  const programIds = await collectProgramIdsForScope(scopeId, scope);
  if (programIds.length === 0) {
    return noDataScore('relevance');
  }
  const alignmentValues = programIds
    .map((id) => programAlignment.get(id))
    .filter((v): v is number => v !== undefined);
  const alignment =
    alignmentValues.length > 0
      ? alignmentValues.reduce((a, b) => a + b, 0) / alignmentValues.length
      : null;

  const matchRows = await prisma.programDemandMatch.findMany({
    where: { programId: { in: programIds }, relevant: true, ...demandMatchSourceWhere(DEMAND_SOURCE_LINKEDIN), ...realDataWhere() },
    select: { matched: true, programId: true },
  });
  const byProgram = new Map<string, { m: number; t: number }>();
  for (const r of matchRows) {
    const c = byProgram.get(r.programId) ?? { m: 0, t: 0 };
    c.t++;
    if (r.matched) c.m++;
    byProgram.set(r.programId, c);
  }
  const matchValues = [...byProgram.values()].filter((c) => c.t > 0).map((c) => (c.m / c.t) * 100);
  const demandMatch =
    matchValues.length > 0 ? matchValues.reduce((a, b) => a + b, 0) / matchValues.length : null;

  // v5.0: the three per-program drivers are rolled up from the program
  // scores rather than dropped. Before this, faculty relevance was the
  // mean of ONE surviving low driver (labour_market_alignment, 8-20)
  // while the three high ones were discarded — demographic resilience
  // ~97, strategic sector ~100, pedagogical fit ~85. Every faculty
  // therefore read 8-32 against a program mean of 68-83, a -56 pt
  // dimension gap that dominated the cockpit's faculty composites.
  const index = await getProgramScoreIndex();
  const drivers = [
    { label: 'labour_market_alignment', value: alignment === null ? null : clamp(alignment), raw: alignment },
    { label: 'demand_match_filled', value: demandMatch === null ? null : clamp(demandMatch), raw: demandMatch },
    rolledUpDriver(index, programIds, 'relevance', 'demographic_resilience'),
    rolledUpDriver(index, programIds, 'relevance', 'strategic_sector_alignment'),
    rolledUpDriver(index, programIds, 'relevance', 'pedagogical_fit'),
    rolledUpDriver(index, programIds, 'relevance', 'jobthai_demand_alignment'),
  ];
  return summariseDrivers('relevance', drivers);
}
