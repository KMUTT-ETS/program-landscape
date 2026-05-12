import { prisma } from '@kku/db';
import {
  buildDemandMatchMessages,
  DemandMatchSchema,
  DEMAND_MATCH_VERSION,
  type AiService,
} from '@kku/shared';

// ─────────────────────────────────────────────────────────────────────────────
// Demand-driven curriculum match.
//
// 1. Resolve the program's demanded-skills set from labour-market data,
//    filtered by Program.kmitlCareerIds.
// 2. Pull the program's PLOs (from latest PROGRAM_SKILLS_DETAILED) +
//    course descriptions (from latest PROGRAM_DIGEST) + already-extracted
//    taught skills.
// 3. Ask the AI to match each demanded skill against PLOs / courses /
//    extracted skills, returning matched/relatedness/evidence per skill.
// 4. Persist results in `program_demand_matches` for cheap re-reads.
//
// Idempotent: re-running upserts each (programId, skillId) row.
// ─────────────────────────────────────────────────────────────────────────────

export interface MatchDemandParams {
  programId: string;
  ai: AiService;
  triggeredByUserId?: string | null;
  /** When true, force the AI re-run even if a complete match set already
   *  exists. Useful after PLO/digest updates. */
  force?: boolean;
  /** Override the model used for the structured match call. Defaults to
   *  `gemini-flash-latest`. Use a Pro model (e.g. `gemini-3.1-pro-preview`)
   *  when flash truncates the structured response on long demanded-skill
   *  sets — the long structured output is in Pro's wheelhouse. */
  modelOverride?: string;
}

export type MatchDemandOutcome =
  | {
      status: 'SUCCEEDED';
      aiInferenceId: string | null;
      confidence: number;
      tokensInput: number;
      tokensOutput: number;
      costUsd: number;
      demandedSkillsChecked: number;
      matched: number;
      gapsRelevant: number;     // matched=false AND relevant=true → real gaps
      irrelevant: number;       // matched=false AND relevant=false → suppressed
      avgRelatedness: number;
      bySource: Record<string, number>;
    }
  | { status: 'SKIPPED'; reason: string }
  | { status: 'FAILED'; reason: string };

export async function runDemandMatch(params: MatchDemandParams): Promise<MatchDemandOutcome> {
  const program = await prisma.program.findUnique({
    where: { id: params.programId },
    select: {
      id: true,
      code: true,
      nameTh: true,
      kmitlCareerIds: true,
      faculty: { select: { nameTh: true } },
    },
  });
  if (!program) return { status: 'SKIPPED', reason: `program not found: ${params.programId}` };

  // 1. Resolve demanded skills (top 30 by peak demand, filtered to careers).
  // Uses the same fallback chain as programSkills() for consistency.
  type DemandRow = { skillId: string | null; _max: { percentage: number | null } };
  const fallbackChain: Array<{ scope: 'THAILAND' | 'GLOBAL'; source: 'JOB_POSTINGS' | 'PROFILES'; minPct: number }> = [
    { scope: 'THAILAND', source: 'JOB_POSTINGS', minPct: 5 },
    { scope: 'THAILAND', source: 'PROFILES',     minPct: 5 },
    { scope: 'GLOBAL',   source: 'JOB_POSTINGS', minPct: 0 },
    { scope: 'GLOBAL',   source: 'PROFILES',     minPct: 0 },
  ];
  const careerFilter =
    program.kmitlCareerIds.length > 0
      ? { career: { kmitlCareerId: { in: program.kmitlCareerIds } } }
      : {};
  let demandRows: DemandRow[] = [];
  for (const tier of fallbackChain) {
    const rows = await prisma.kmitlCareerSkillDemand.groupBy({
      by: ['skillId'],
      where: {
        dataScope: tier.scope,
        dataSource: tier.source,
        percentage: { gte: tier.minPct },
        skillId: { not: null },
        ...careerFilter,
      },
      _max: { percentage: true },
      orderBy: { _max: { percentage: 'desc' } },
      take: 30,
    });
    if (rows.length > 0) {
      demandRows = rows;
      break;
    }
  }
  const demandedIds = demandRows.map((d) => d.skillId).filter((id): id is string => Boolean(id));
  if (demandedIds.length === 0) {
    return { status: 'SKIPPED', reason: 'no demanded skills resolved for this program' };
  }
  const demandedSkills = await prisma.skill.findMany({
    where: { id: { in: demandedIds } },
    select: { id: true, nameEn: true, nameTh: true },
  });

  // 2. Pull the program's curriculum content
  const skillsExtraction = await prisma.aiExtraction.findFirst({
    where: {
      sourceEntityType: 'program',
      sourceEntityId: program.id,
      extractionKind: 'PROGRAM_SKILLS_DETAILED',
    },
    orderBy: { createdAt: 'desc' },
    select: { payloadJson: true },
  });
  const skillsPayload = skillsExtraction?.payloadJson as
    | { programLearningOutcomes?: string[] }
    | null;
  const plos = skillsPayload?.programLearningOutcomes ?? [];

  const digest = await prisma.aiExtraction.findFirst({
    where: {
      sourceEntityType: 'program',
      sourceEntityId: program.id,
      extractionKind: 'PROGRAM_DIGEST',
    },
    orderBy: { createdAt: 'desc' },
    select: { payloadJson: true },
  });
  const digestPayload = digest?.payloadJson as
    | { courses?: Array<{ code: string; nameTh: string; nameEn: string; descriptionTh: string }> }
    | null;
  const courses = digestPayload?.courses ?? [];

  const extractedSkills = await prisma.programSkill.findMany({
    where: { programId: program.id },
    include: { skill: { select: { nameEn: true, nameTh: true } } },
  });

  if (plos.length === 0 && courses.length === 0 && extractedSkills.length === 0) {
    return {
      status: 'SKIPPED',
      reason: 'no curriculum content (no PLOs, courses, or extracted skills) — run program-digest + program-skills-detailed first',
    };
  }

  // 3. Run the AI match
  const messages = buildDemandMatchMessages({
    programDegree: program.nameTh,
    programFaculty: program.faculty.nameTh,
    programLearningOutcomes: plos,
    courses: courses.map((c) => ({
      code: c.code ?? '',
      nameTh: c.nameTh ?? '',
      nameEn: c.nameEn ?? '',
      descriptionTh: c.descriptionTh ?? '',
    })),
    extractedSkills: extractedSkills.map((es) => ({
      nameTh: es.skill.nameTh,
      nameEn: es.skill.nameEn,
      evidence: es.evidenceQuote ?? '',
    })),
    demandedSkills: demandedSkills.map((s) => ({
      skillId: s.id,
      nameEn: s.nameEn,
      nameTh: s.nameTh,
    })),
  });

  const response = await params.ai.extractStructured(
    {
      ctx: {
        module: 'curriculum',
        kind: 'demand-match',
        userId: params.triggeredByUserId ?? null,
        traceId: `demand-match-${program.id}`,
      },
      messages,
      methodVersion: DEMAND_MATCH_VERSION,
      // gemini-3-flash-preview started truncating at ~470 output tokens
      // when the v2 schema (added relevantToCurriculum) and prompt (added
      // discipline-relevance rules) grew. gemini-flash-latest handles
      // longer structured output more reliably for this prompt class.
      // params.modelOverride lets an operator escalate to Pro when even
      // gemini-flash-latest truncates (observed sporadically at ~463
      // output tokens on long PLO sets).
      model: params.modelOverride ?? 'gemini-flash-latest',
      maxOutputTokens: 12000,
    },
    DemandMatchSchema,
  );

  const decisions = response.parsed.matches;
  const validIds = new Set(demandedIds);

  // 4. Persist
  const bySource: Record<string, number> = {};
  let totalRelatedness = 0;
  let matched = 0;
  let gapsRelevant = 0;
  let irrelevant = 0;

  await prisma.$transaction(async (tx) => {
    // Replace prior matches for this program (a re-run reflects new
    // PLO / curriculum / demand state cleanly).
    await tx.programDemandMatch.deleteMany({ where: { programId: program.id } });
    for (const d of decisions) {
      if (!validIds.has(d.skillId)) continue; // ignore hallucinated skill IDs
      bySource[d.matchSource] = (bySource[d.matchSource] ?? 0) + 1;
      totalRelatedness += d.relatedness;
      if (d.matched) matched++;
      else if (d.relevantToCurriculum) gapsRelevant++;
      else irrelevant++;
      await tx.programDemandMatch.create({
        data: {
          programId: program.id,
          skillId: d.skillId,
          matched: d.matched,
          // Defensive: matched=true implies relevant=true (impossible to
          // teach a skill that isn't relevant to the curriculum).
          relevant: d.matched ? true : d.relevantToCurriculum,
          relatedness: d.relatedness,
          matchSource: d.matchSource,
          evidenceQuote: d.evidenceQuote || null,
          methodVersion: DEMAND_MATCH_VERSION,
          aiInferenceId: response.aiInferenceId,
        },
      });
    }
  });

  return {
    status: 'SUCCEEDED',
    aiInferenceId: response.aiInferenceId,
    confidence: response.confidence,
    tokensInput: response.tokens.input,
    tokensOutput: response.tokens.output,
    costUsd: response.cost.usd,
    demandedSkillsChecked: decisions.length,
    matched,
    gapsRelevant,
    irrelevant,
    avgRelatedness: decisions.length === 0 ? 0 : totalRelatedness / decisions.length,
    bySource,
  };
}
