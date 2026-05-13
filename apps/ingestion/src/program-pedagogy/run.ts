import { prisma } from '@kku/db';
import {
  buildProgramPedagogyMessages,
  ProgramPedagogyAssessmentSchema,
  PROGRAM_PEDAGOGY_VERSION,
  type AiService,
  type S3Storage,
} from '@kku/shared';
import { extractNativeText } from '../pdf-intake/pipeline/native-text-extractor';

// ─────────────────────────────────────────────────────────────────────────────
// Per-program pedagogical-readiness extraction.
//
// 1. Fetch the program's CURRENT_CURRICULUM PDF (same source the digest +
//    faculty + skills extractors read).
// 2. Run the program-pedagogy.v1 prompt: AI reads teaching/learning,
//    assessment, QA, industrial-engagement sections and scores them
//    against discipline-specific best practice (medical→PBL+clinical,
//    engineering→project-based+internship, etc.).
// 3. Persist to ProgramPedagogyAssessment (one row per program; upsert).
//
// Consumers:
//   - health-score.v3.6 relevance dimension `pedagogical_fit` driver
//   - ai-readiness.v3 `pedagogicalReadiness` sub-score
//
// Pro model — reasoning over a large PDF against discipline rubrics.
// Pure thinking task; thinking ENABLED so the discipline match gets
// full reasoning budget.
// ─────────────────────────────────────────────────────────────────────────────

export interface RunProgramPedagogyParams {
  programId: string;
  ai: AiService;
  storage: S3Storage;
  triggeredByUserId?: string | null;
  /** When true, skip the "already assessed at current method version"
   *  early-return so a --force pipeline rerun gets a fresh extraction. */
  force?: boolean;
}

export type ProgramPedagogyOutcome =
  | {
      status: 'SUCCEEDED';
      aiInferenceId: string | null;
      disciplineFitScore: number;
      qaScore: number;
      overallScore: number;
      confidence: number;
      tokensInput: number;
      tokensOutput: number;
      costUsd: number;
      gapCount: number;
    }
  | { status: 'SKIPPED'; reason: string }
  | { status: 'FAILED'; reason: string };

export async function runProgramPedagogy(
  params: RunProgramPedagogyParams,
): Promise<ProgramPedagogyOutcome> {
  const program = await prisma.program.findUnique({
    where: { id: params.programId },
    select: {
      id: true,
      nameTh: true,
      nameEn: true,
      level: true,
      durationYears: true,
      faculty: { select: { nameEn: true, nameTh: true } },
      department: { select: { nameEn: true, nameTh: true } },
    },
  });
  if (!program) {
    return { status: 'SKIPPED', reason: `program not found: ${params.programId}` };
  }

  if (!params.force) {
    const existing = await prisma.programPedagogyAssessment.findUnique({
      where: { programId: program.id },
      select: { methodVersion: true },
    });
    if (existing && existing.methodVersion === PROGRAM_PEDAGOGY_VERSION) {
      return {
        status: 'SKIPPED',
        reason: `assessment already exists with method ${PROGRAM_PEDAGOGY_VERSION}; pass force=true to re-run`,
      };
    }
  }

  // Resolve the current CURRENT_CURRICULUM PDF + fetch its bytes.
  const doc = await prisma.programDocument.findFirst({
    where: { programId: program.id, role: 'CURRENT_CURRICULUM', isCurrent: true },
    include: { pdfDocument: true },
  });
  if (!doc?.pdfDocument) {
    return {
      status: 'SKIPPED',
      reason: 'no CURRENT_CURRICULUM PDF linked — upload + link first',
    };
  }

  const m = /^s3:\/\/([^/]+)\/(.+)$/.exec(doc.pdfDocument.storageUrl);
  if (!m) {
    return { status: 'FAILED', reason: `unrecognised storageUrl: ${doc.pdfDocument.storageUrl}` };
  }
  const url = await params.storage.getSignedDownloadUrl({
    bucket: m[1]!,
    key: m[2]!,
    ttlSeconds: 300,
  });
  const res = await fetch(url);
  if (!res.ok) return { status: 'FAILED', reason: `PDF fetch ${res.status}` };
  const bytes = Buffer.from(await res.arrayBuffer());
  const extracted = await extractNativeText(bytes);

  const messages = buildProgramPedagogyMessages({
    program: {
      nameTh: program.nameTh,
      nameEn: program.nameEn,
      level: program.level as 'BACHELOR' | 'MASTER' | 'DOCTORAL' | 'HIGHER_GRAD_DIPLOMA',
      facultyNameTh: program.faculty.nameTh,
      facultyNameEn: program.faculty.nameEn,
      departmentNameTh: program.department?.nameTh ?? null,
      durationYears: program.durationYears,
    },
    pdfText: extracted.fullText,
  });

  const response = await params.ai.extractStructured(
    {
      ctx: {
        module: 'curriculum',
        kind: 'program-pedagogy',
        userId: params.triggeredByUserId ?? null,
        traceId: `program-pedagogy-${program.id}`,
      },
      messages,
      methodVersion: PROGRAM_PEDAGOGY_VERSION,
      // Discipline rubric reasoning + multi-section evidence quoting
      // produces ~3-4k JSON output, plus Pro thinking adds ~5-6k.
      // Bumped 16000 → 50000 on 2026-05-13 to share the heavy-extractor
      // ceiling with digest/faculty/skills.
      maxOutputTokens: 50000,
      // Thinking ENABLED — this is reasoning over discipline best
      // practice, not pure extraction. (Pro auto-enables thinking; we
      // explicitly opt in for clarity.)
      thinking: true,
    },
    ProgramPedagogyAssessmentSchema,
  );

  await prisma.programPedagogyAssessment.upsert({
    where: { programId: program.id },
    create: {
      programId: program.id,
      methodVersion: PROGRAM_PEDAGOGY_VERSION,
      disciplineFitScore: response.parsed.disciplineFitScore,
      qaScore: response.parsed.qaSystem.score,
      overallScore: response.parsed.overallScore,
      payloadJson: response.parsed,
      confidence: response.parsed.confidence,
      generatedByAiInferenceId: response.aiInferenceId,
    },
    update: {
      methodVersion: PROGRAM_PEDAGOGY_VERSION,
      disciplineFitScore: response.parsed.disciplineFitScore,
      qaScore: response.parsed.qaSystem.score,
      overallScore: response.parsed.overallScore,
      payloadJson: response.parsed,
      confidence: response.parsed.confidence,
      generatedAt: new Date(),
      generatedByAiInferenceId: response.aiInferenceId,
    },
  });

  return {
    status: 'SUCCEEDED',
    aiInferenceId: response.aiInferenceId,
    disciplineFitScore: response.parsed.disciplineFitScore,
    qaScore: response.parsed.qaSystem.score,
    overallScore: response.parsed.overallScore,
    confidence: response.parsed.confidence,
    tokensInput: response.tokens.input,
    tokensOutput: response.tokens.output,
    costUsd: response.cost.usd,
    gapCount: response.parsed.gaps.length,
  };
}
