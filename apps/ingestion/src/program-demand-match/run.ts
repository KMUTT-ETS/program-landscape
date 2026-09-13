import {
  prisma,
  programJobThaiDemand,
  demandMatchProvenanceSource,
  DEMAND_SOURCE_JOBTHAI,
  DEMAND_SOURCE_LINKEDIN,
  type ProgramJobThaiDemand,
} from '@kku/db';
import {
  buildDemandMatchMessages,
  DemandMatchSchema,
  DEMAND_MATCH_VERSION,
  isRelevantFit,
  type AiService,
} from '@kku/shared';

// ─────────────────────────────────────────────────────────────────────────────
// Demand-driven curriculum match.
//
// 1. Resolve the program's demanded-skills set: LinkedIn-via-MHESI demand
//    filtered by Program.kmitlCareerIds, plus (v5.2) JobThai demand from the
//    programme's field-of-study occupation links.
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
// From health-score.v5.2 the checklist is the union of LinkedIn-via-MHESI and
// JobThai demand, so provenance is per ROW: each row carries the sources that
// demanded its skill (`demand_sources`) and is stamped with the run of
// `demandMatchProvenanceSource(sources)` — LinkedIn when both demanded it.
// ─────────────────────────────────────────────────────────────────────────────

/** The LinkedIn-via-MHESI demand source. Kept for callers of the old name. */
export const DEMAND_SOURCE_SLUG = DEMAND_SOURCE_LINKEDIN;

/**
 * Most JobThai-demanded skills sent to one AI check. LinkedIn already sends up
 * to 30; 25 keeps the combined prompt comparable. On dev the median linked
 * programme has 12-20 non-generic JobThai skills at the 5% floor, so the cap
 * rarely bites.
 */
export const JOBTHAI_CHECKLIST_MAX = 25;

/**
 * skillId -> the demand sources that put it on this programme's checklist.
 * Generic JobThai skills are left off: "does this curriculum teach
 * communication" is not a question about fit to this field's jobs.
 */
export function buildDemandChecklist(
  linkedInSkillIds: ReadonlyArray<string>,
  jobThai: Pick<ProgramJobThaiDemand, 'status' | 'demand'>,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const id of linkedInSkillIds) out.set(id, [DEMAND_SOURCE_LINKEDIN]);
  if (jobThai.status === 'ok') {
    for (const d of jobThai.demand.filter((x) => !x.generic).slice(0, JOBTHAI_CHECKLIST_MAX)) {
      const sources = out.get(d.skillId) ?? [];
      if (!sources.includes(DEMAND_SOURCE_JOBTHAI)) sources.push(DEMAND_SOURCE_JOBTHAI);
      out.set(d.skillId, sources);
    }
  }
  return out;
}

/**
 * The programme's own skill row for the AI's `matchedTaughtSkillName`. Exact,
 * case-insensitive, English or Thai — no fuzzy match, because a wrong taught
 * skill would hide real surplus.
 */
export function resolveTaughtSkillId(
  name: string,
  taught: ReadonlyArray<{ skillId: string; nameEn: string | null; nameTh: string | null }>,
): string | null {
  const key = name.trim().toLowerCase();
  if (key === '') return null;
  const hit = taught.find((t) => (t.nameEn ?? '').trim().toLowerCase() === key || (t.nameTh ?? '').trim().toLowerCase() === key);
  return hit?.skillId ?? null;
}

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
      nameEn: true,
      level: true,
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
  const linkedInIds = demandRows.map((d) => d.skillId).filter((id): id is string => Boolean(id));
  const jobThaiDemand = await programJobThaiDemand(program.id);
  const checklist = buildDemandChecklist(linkedInIds, jobThaiDemand);
  const demandedIds = [...checklist.keys()];
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

  // 3. Context for the profession-aware fit judgement (demand-match.v4):
  //    the careers these graduates are hired into, and where each skill is
  //    demanded. Without it the model judges "relevance" from the degree name
  //    alone and calls other engineering disciplines gaps for Mechanical.
  const linkedInCareers = program.kmitlCareerIds.length > 0
    ? await prisma.kmitlCareer.findMany({
        where: { kmitlCareerId: { in: program.kmitlCareerIds } },
        select: { careerName: true, subGroupName: true },
        take: 12,
      })
    : [];
  const jobThaiOccupations = jobThaiDemand.status === 'ok' ? jobThaiDemand.linkedOccupations.slice(0, 12) : [];
  const targetCareers = [
    ...jobThaiOccupations.map((o) => ({
      source: 'JobThai' as const,
      title: `${o.category} / ${o.subcategory}`,
      detail: `${Math.round(o.score * 100)}% of these postings ask for this programme's field; ${o.postingCount} postings`,
    })),
    ...linkedInCareers.map((c) => ({ source: 'LinkedIn' as const, title: c.careerName, detail: c.subGroupName.trim() })),
  ];
  const occupationName = new Map(jobThaiOccupations.map((o) => [o.occupationId, o.subcategory === 'อื่นๆ' ? `${o.category} / อื่นๆ` : o.subcategory]));
  const occSkillRows = jobThaiOccupations.length === 0
    ? []
    : await prisma.jobThaiOccupationSkill.findMany({
        where: { jobThaiOccupationId: { in: jobThaiOccupations.map((o) => o.occupationId) }, skillId: { in: demandedIds }, share: { gte: 0.05 } },
        select: { jobThaiOccupationId: true, skillId: true, share: true },
        orderBy: { share: 'desc' },
      });
  const demandedInBySkill = new Map<string, string[]>();
  for (const r of occSkillRows) {
    const list = demandedInBySkill.get(r.skillId) ?? [];
    const name = occupationName.get(r.jobThaiOccupationId);
    if (name && list.length < 3 && !list.includes(name)) list.push(name);
    demandedInBySkill.set(r.skillId, list);
  }
  const jobThaiShare = new Map(jobThaiDemand.demand.map((d) => [d.skillId, d.share]));

  // 4. Run the AI match
  const messages = buildDemandMatchMessages({
    programDegree: program.nameTh,
    programDegreeEn: program.nameEn ?? '',
    programLevel: String(program.level),
    programFaculty: program.faculty.nameTh,
    targetCareers,
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
    demandedSkills: demandedSkills.map((s) => {
      const sources = checklist.get(s.id) ?? [];
      const share = jobThaiShare.get(s.id);
      return {
        skillId: s.id,
        nameEn: s.nameEn,
        nameTh: s.nameTh,
        sources: sources.map((src) => (src === DEMAND_SOURCE_JOBTHAI ? 'JobThai' as const : 'LinkedIn' as const)),
        demandPct: sources.includes(DEMAND_SOURCE_JOBTHAI) && share !== undefined ? share * 100 : null,
        demandedIn: demandedInBySkill.get(s.id) ?? [],
      };
    }),
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

  // 5. Persist
  const bySource: Record<string, number> = {};
  let totalRelatedness = 0;
  let matched = 0;
  let gapsRelevant = 0;
  let irrelevant = 0;

  // Resolved once per source, outside the transaction — each is one indexed read.
  const runIdBySource = new Map<string, string | null>();
  for (const slug of [DEMAND_SOURCE_LINKEDIN, DEMAND_SOURCE_JOBTHAI]) {
    runIdBySource.set(
      slug,
      await resolveDemandProvenanceRunId({ findLatestSucceededRun: findLatestSucceededRunId, demandSourceSlug: slug }),
    );
  }

  await prisma.$transaction(async (tx) => {
    // Replace prior matches for this program (a re-run reflects new
    // PLO / curriculum / demand state cleanly).
    await tx.programDemandMatch.deleteMany({ where: { programId: program.id } });
    for (const d of decisions) {
      if (!validIds.has(d.skillId)) continue; // ignore hallucinated skill IDs
      const sources = checklist.get(d.skillId) ?? [];
      const provenanceSource = demandMatchProvenanceSource(sources);
      bySource[d.matchSource] = (bySource[d.matchSource] ?? 0) + 1;
      totalRelatedness += d.relatedness;
      // v4: relevance is the FIT, not implied by matched. A Mechanical
      // programme's electrical service course does not make "Electrical
      // engineering" a skill its graduates are hired for.
      const relevant = isRelevantFit(d.fit);
      if (d.matched) matched++;
      else if (relevant) gapsRelevant++;
      else irrelevant++;
      await tx.programDemandMatch.create({
        data: {
          programId: program.id,
          skillId: d.skillId,
          matched: d.matched,
          relevant,
          fit: d.fit,
          fitReason: d.fitReason || null,
          relatedness: d.relatedness,
          matchSource: d.matchSource,
          evidenceQuote: d.evidenceQuote || null,
          methodVersion: DEMAND_MATCH_VERSION,
          aiInferenceId: response.aiInferenceId,
          // Without this the row fails realDataWhere() and the relevance
          // driver that reads this table goes dark. See the provenance
          // block at the top of this file.
          ingestionRunId: provenanceSource ? runIdBySource.get(provenanceSource) ?? null : null,
          demandSources: sources,
          matchedTaughtSkillId: d.matched
            ? resolveTaughtSkillId(
                d.matchedTaughtSkillName,
                extractedSkills.map((es) => ({ skillId: es.skillId, nameEn: es.skill.nameEn, nameTh: es.skill.nameTh })),
              )
            : null,
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
