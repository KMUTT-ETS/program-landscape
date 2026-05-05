import { prisma } from '@kku/db';
import {
  buildProgramAiReadinessMessages,
  ProgramAiReadinessAssessmentSchema,
  PROGRAM_AI_READINESS_VERSION,
  type AiService,
  type ProgramDigest,
} from '@kku/shared';
import { ProgramDigestSchema } from '@kku/shared';

// ─────────────────────────────────────────────────────────────────────────────
// Generates a discipline-aware AI readiness assessment for one program.
// REPLACES the deterministic v1 keyword classifier with reasoning grounded
// in the program's actual discipline, courses, skills, and career paths.
//
// Idempotent — upserts on programId. Re-running supersedes the prior
// assessment.
//
// Cost: ~$0.05 per program (Pro thinking). Skipped when:
//   - the program has no skills + no digest (nothing to reason over)
//   - an existing assessment exists with the same methodVersion (unless
//     `force: true`)
// ─────────────────────────────────────────────────────────────────────────────

export interface RunProgramAiReadinessParams {
  programId: string;
  ai: AiService;
  /** Bypass the "already assessed" skip. */
  force?: boolean;
  triggeredByUserId?: string | null;
}

export type ProgramAiReadinessOutcome =
  | {
      status: 'SUCCEEDED';
      aiInferenceId: string | null;
      relevanceScore: number;
      confidence: number;
      tokensInput: number;
      tokensOutput: number;
      costUsd: number;
      gapCount: number;
      recommendationCount: number;
    }
  | { status: 'SKIPPED'; reason: string }
  | { status: 'FAILED'; reason: string };

export async function runProgramAiReadiness(
  params: RunProgramAiReadinessParams,
): Promise<ProgramAiReadinessOutcome> {
  const program = await prisma.program.findUnique({
    where: { id: params.programId },
    select: {
      id: true,
      nameTh: true,
      nameEn: true,
      level: true,
      durationYears: true,
      recruitmentSummaryTh: true,
      faculty: { select: { nameEn: true } },
    },
  });
  if (!program) {
    return { status: 'SKIPPED', reason: `program not found: ${params.programId}` };
  }

  if (!params.force) {
    const existing = await prisma.programAiReadinessAssessment.findUnique({
      where: { programId: program.id },
      select: { methodVersion: true },
    });
    if (existing && existing.methodVersion === PROGRAM_AI_READINESS_VERSION) {
      return {
        status: 'SKIPPED',
        reason: `assessment already exists with method ${PROGRAM_AI_READINESS_VERSION}; pass force=true to re-run`,
      };
    }
  }

  // Pull the program's actual skills (ranked by weight) for the prompt.
  const programSkills = await prisma.programSkill.findMany({
    where: { programId: program.id },
    include: { skill: { select: { nameEn: true, nameTh: true } } },
    orderBy: { weight: 'desc' },
  });
  const skillsForPrompt = programSkills.slice(0, 40).map((ps) => ({
    name: ps.skill.nameEn?.trim() || ps.skill.nameTh || '(unnamed)',
    weight: ps.weight,
    // Schema swapped a single `isCompulsory` flag for split
    // compulsoryWeight / electiveWeight columns. Treat a non-zero
    // compulsoryWeight as compulsory; null or 0 → elective/unknown.
    compulsory: (ps.compulsoryWeight ?? 0) > 0,
  }));

  // Pull courses + careerPaths from the most recent approved program-digest
  // extraction, when one exists.
  let courses: Array<{ code: string | null; nameEn: string | null; nameTh: string | null }> = [];
  let careerPaths: string[] = [];
  let matchedDigest: ProgramDigest | null = null;
  // AiExtraction.sourceEntityId points at the PDF document, not the
  // program. Walk the latest 100 approved digests and match by name.
  const candidates = await prisma.aiExtraction.findMany({
    where: {
      sourceEntityType: 'curriculum',
      extractionKind: 'PROGRAM_DIGEST',
      reviewStatus: 'APPROVED',
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  for (const cand of candidates) {
    const parsed = ProgramDigestSchema.safeParse(cand.payloadJson);
    if (!parsed.success) continue;
    if (parsed.data.programNameTh === program.nameTh
      || (parsed.data.programNameEn && parsed.data.programNameEn === program.nameEn)) {
      matchedDigest = parsed.data;
      break;
    }
  }
  if (matchedDigest) {
    courses = matchedDigest.courses.slice(0, 25).map((c) => ({
      code: c.code ?? null,
      nameEn: c.nameEn ?? null,
      nameTh: c.nameTh ?? null,
    }));
    careerPaths = matchedDigest.careerPathsTh ?? [];
  }

  // Cheap deterministic baseline: count AI-keyword skills as a sanity input
  // for the prompt (the AI may agree or disagree with this).
  const det = computeDeterministicScores(skillsForPrompt);

  if (skillsForPrompt.length === 0 && courses.length === 0) {
    return {
      status: 'SKIPPED',
      reason: 'program has no skills and no digest — nothing to reason over',
    };
  }

  const messages = buildProgramAiReadinessMessages({
    programNameTh: program.nameTh,
    programNameEn: program.nameEn,
    programLevel: program.level as 'BACHELOR' | 'MASTER' | 'DOCTORAL' | 'HIGHER_GRAD_DIPLOMA',
    facultyNameEn: program.faculty.nameEn,
    durationYears: program.durationYears,
    programSkills: skillsForPrompt,
    courses,
    careerPaths,
    recruitmentSummaryTh: program.recruitmentSummaryTh ?? null,
    deterministicScores: det,
  });

  const response = await params.ai.extractStructured(
    {
      ctx: {
        module: 'programs',
        kind: 'program-ai-readiness',
        userId: params.triggeredByUserId ?? null,
        traceId: `ai-readiness-${program.id}`,
      },
      messages,
      methodVersion: PROGRAM_AI_READINESS_VERSION,
      maxOutputTokens: 8192,
    },
    ProgramAiReadinessAssessmentSchema,
  );

  await prisma.programAiReadinessAssessment.upsert({
    where: { programId: program.id },
    create: {
      programId: program.id,
      methodVersion: PROGRAM_AI_READINESS_VERSION,
      relevanceScore: response.parsed.relevanceScore,
      payloadJson: response.parsed,
      confidence: response.parsed.confidence,
      generatedByAiInferenceId: response.aiInferenceId,
    },
    update: {
      methodVersion: PROGRAM_AI_READINESS_VERSION,
      relevanceScore: response.parsed.relevanceScore,
      payloadJson: response.parsed,
      confidence: response.parsed.confidence,
      generatedAt: new Date(),
      generatedByAiInferenceId: response.aiInferenceId,
    },
  });

  return {
    status: 'SUCCEEDED',
    aiInferenceId: response.aiInferenceId,
    relevanceScore: response.parsed.relevanceScore,
    confidence: response.parsed.confidence,
    tokensInput: response.tokens.input,
    tokensOutput: response.tokens.output,
    costUsd: response.cost.usd,
    gapCount: response.parsed.gaps.length,
    recommendationCount: response.parsed.recommendations.length,
  };
}

// Cheap baseline classifier — same keywords as the legacy v1 logic, kept
// here so the AI prompt has a "what the deterministic scan thinks" signal.
const AI_NATIVE_KEYWORDS = [
  'artificial intelligence', 'machine learning', 'deep learning',
  'neural network', 'data science', 'data analytics', 'big data',
  'natural language processing', 'computer vision', 'reinforcement learning',
  'generative ai', 'large language model', 'llm', 'prompt engineering',
  'mlops', 'ai ethics', 'ai/ml', 'ml engineering',
];
function computeDeterministicScores(
  skills: Array<{ name: string; weight: number; compulsory: boolean }>,
): {
  overallScore: number;
  curriculumIntegration: number;
  skillResilience: number;
  researchPresence: number;
  aiNativeSkillCount: number;
  totalSkillCount: number;
} {
  const total = skills.length;
  if (total === 0) {
    return {
      overallScore: 0,
      curriculumIntegration: 0,
      skillResilience: 50,
      researchPresence: 0,
      aiNativeSkillCount: 0,
      totalSkillCount: 0,
    };
  }
  const aiNative = skills.filter((s) =>
    AI_NATIVE_KEYWORDS.some((k) => s.name.toLowerCase().includes(k)),
  );
  const aiNativeWeight = aiNative.reduce((s, x) => s + x.weight, 0);
  const totalWeight = skills.reduce((s, x) => s + x.weight, 0);
  const curriculumIntegration = Math.min(
    100,
    (aiNativeWeight / Math.max(totalWeight, 1)) * 400,
  );
  const skillResilience = 50 + ((aiNative.length * 2) / total) * 50;
  const overallScore = curriculumIntegration * 0.5 + Math.min(100, skillResilience) * 0.5;
  return {
    overallScore,
    curriculumIntegration,
    skillResilience: Math.min(100, skillResilience),
    researchPresence: 0, // not computed at this layer
    aiNativeSkillCount: aiNative.length,
    totalSkillCount: total,
  };
}
