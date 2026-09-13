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
   *  `gemini-3.1-pro-preview` (see comment at the call site for why we
   *  dropped flash). Use to swap models for cost-comparison experiments
   *  or to fall back to a different family if Pro hits its own issues. */
  modelOverride?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Provenance
//
// A ProgramDemandMatch row exists because a demanded skill was resolved
// from a demand source, so THAT source's ingestion run is the row's
// provenance. These rows are AI-derived rather than connector-derived,
// which is why "the latest run of this table's own connector" is
// meaningless here — and why the column sat NULL on all 6,224 rows until
// 2026-09-13, silently failing realDataWhere() and blanking the
// `demand_match_filled` relevance driver on all 301 programmes.
//
// Every tier of the demand fallback chain reads KmitlCareerSkillDemand, so
// today that source is always kmitl-skill-mapping. JobThai joins the chain
// in a later change; when it does, this is the one place that decides what
// a row's provenance is.
// ─────────────────────────────────────────────────────────────────────────────

/** The demand source backing every tier of the current fallback chain. */
export const DEMAND_SOURCE_SLUG = 'kmitl-skill-mapping';

/** Injectable seam so the resolver is unit-testable without Prisma. */
export interface DemandProvenanceDeps {
  findLatestSucceededRun: (slug: string) => Promise<string | null>;
  demandSourceSlug: string;
}

/**
 * Returns null rather than fabricating a run id. A wrong provenance is
 * worse than an absent one: realDataWhere() already treats null as "not
 * real", whereas a fabricated FK would make unreal rows count as real.
 */
export async function resolveDemandProvenanceRunId(
  deps: DemandProvenanceDeps,
): Promise<string | null> {
  return deps.findLatestSucceededRun(deps.demandSourceSlug);
}

/** Prisma-backed lookup. NOTE: the column is `completed_at`, not `finished_at`. */
export async function findLatestSucceededRunId(slug: string): Promise<string | null> {
  const run = await prisma.ingestionRun.findFirst({
    where: { status: 'SUCCEEDED', dataSource: { slug } },
    orderBy: { completedAt: 'desc' },
    select: { id: true },
  });
  return run?.id ?? null;
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
      // Uses the universal default (gemini-3.5-flash) unless the caller
      // passes an explicit modelOverride. Historical note: the older
      // gemini-3-flash-preview / gemini-flash-latest models truncated
      // this prompt mid-JSON at ~460-470 output tokens, which is why it
      // ran on Pro from 2026-05-12; gemini-3.5-flash is a premium Flash
      // tier that should not share that failure mode — worth a smoke
      // run, and pin via the admin AI-settings page if it regresses.
      model: params.modelOverride,
      // Bumped 12000 → 50000 on 2026-05-13 — see program-digest/run.ts.
      maxOutputTokens: 50000,
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

  // Resolved once per run, outside the transaction — it is one indexed
  // read and every row in this batch shares the same provenance.
  const demandRunId = await resolveDemandProvenanceRunId({
    findLatestSucceededRun: findLatestSucceededRunId,
    demandSourceSlug: DEMAND_SOURCE_SLUG,
  });

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
          // Without this the row fails realDataWhere() and the relevance
          // driver that reads this table goes dark. See the provenance
          // block at the top of this file.
          ingestionRunId: demandRunId,
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
