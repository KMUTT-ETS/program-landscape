import { prisma } from '@kku/db';
import {
  buildProgramDigestMessages,
  ProgramDigestSchema,
  PROGRAM_DIGEST_VERSION,
  type AiService,
  type S3Storage,
} from '@kku/shared';
import { extractNativeText } from '../pdf-intake/pipeline/native-text-extractor';
import { loadProgramSystemContext } from '../program-system-context/load';

// ─────────────────────────────────────────────────────────────────────────────
// Single source of truth for the per-program digest run. Used by:
//   - apps/ingestion/src/scripts/digest-program.ts (CLI single)
//   - apps/ingestion/src/scripts/bulk-digest-programs.ts (CLI bulk)
//   - apps/ingestion/src/ai-jobs/handlers.ts (RUN_PROGRAM_DIGEST kind, fired
//     by the admin pipeline UI in apps/web)
//
// The helper is deliberately thin: input is a programId + the ambient AI
// service + storage clients; output is the persisted AiExtraction id (or a
// reason for skipping). Callers handle CLI logging, queue progress, and
// audit-row writes outside the loop.
// ─────────────────────────────────────────────────────────────────────────────

const LEVEL_TH_LABEL: Record<string, string> = {
  BACHELOR: 'ป.ตรี',
  MASTER: 'ป.โท',
  DOCTORAL: 'ป.เอก',
  HIGHER_GRAD_DIPLOMA: 'ป.บัณฑิตชั้นสูง',
};

export interface RunProgramDigestParams {
  programId: string;
  ai: AiService;
  storage: S3Storage;
  triggeredByUserId?: string | null;
  // Bypass the "already digested" skip. Use when intentionally re-running
  // (methodology bump, edited prompt, force-overwrite from the admin UI).
  force?: boolean;
}

export type RunProgramDigestOutcome =
  | {
      status: 'SUCCEEDED';
      aiExtractionId: string;
      aiInferenceId: string | null;
      confidence: number;
      tokensInput: number;
      tokensOutput: number;
      costUsd: number;
      skillsExtracted: number;
    }
  | { status: 'SKIPPED'; reason: string }
  | { status: 'FAILED'; reason: string };

export async function runProgramDigest(
  params: RunProgramDigestParams,
): Promise<RunProgramDigestOutcome> {
  const program = await prisma.program.findUnique({
    where: { id: params.programId },
    include: {
      faculty: { select: { nameTh: true } },
      documents: {
        where: { role: 'CURRENT_CURRICULUM', isCurrent: true },
        include: { pdfDocument: { select: { id: true, storageUrl: true, originalFilename: true } } },
        take: 1,
      },
    },
  });
  if (!program) return { status: 'SKIPPED', reason: `program not found: ${params.programId}` };
  const doc = program.documents[0];
  if (!doc) return { status: 'SKIPPED', reason: 'no CURRENT_CURRICULUM PDF linked' };

  if (!params.force) {
    const existing = await prisma.aiExtraction.findFirst({
      where: {
        sourceEntityType: 'program',
        sourceEntityId: program.id,
        extractionKind: 'PROGRAM_DIGEST',
      },
      select: { id: true },
    });
    if (existing) return { status: 'SKIPPED', reason: 'PROGRAM_DIGEST already exists; pass force=true to re-run' };
  }

  // Read PDF bytes from MinIO. storageUrl is `s3://<bucket>/<key>`.
  const m = /^s3:\/\/([^/]+)\/(.+)$/.exec(doc.pdfDocument.storageUrl);
  if (!m) return { status: 'FAILED', reason: `unrecognised storageUrl: ${doc.pdfDocument.storageUrl}` };
  const url = await params.storage.getSignedDownloadUrl({
    bucket: m[1]!,
    key: m[2]!,
    ttlSeconds: 300,
  });
  const res = await fetch(url);
  if (!res.ok) return { status: 'FAILED', reason: `PDF fetch ${res.status}` };
  const bytes = Buffer.from(await res.arrayBuffer());

  const extracted = await extractNativeText(bytes);

  // Load live grounding from DS2004 + DS2003 + DS1001 + kku-hr so the
  // recruitment summary's claims about staff and student composition
  // are anchored in real numbers, not invented from the PDF.
  const systemContext = await loadProgramSystemContext(program.id);

  const messages = buildProgramDigestMessages({
    programMetaFromSheet: {
      facultyNameTh: program.faculty.nameTh,
      levelTh: LEVEL_TH_LABEL[program.level] ?? program.level,
      degreeNameFromSheet: program.nameTh,
      majorNameFromSheet: program.majors[0] ?? '',
      curriculumYearBe: program.curriculumYearBE,
      mhesiCode: program.mhesiCode,
    },
    pdfText: extracted.fullText,
    systemContext: {
      staffTotal: systemContext.summary.staffTotal,
      staffByTeachType: systemContext.summary.staffByTeachType,
      staffByRank: systemContext.summary.staffByRank,
      staffEducationOrigin: systemContext.summary.staffEducationOrigin,
      internationalCountriesTop: systemContext.summary.internationalCountriesTop,
      studentTotal: systemContext.summary.studentTotal,
      studentByGender: systemContext.summary.studentByGender,
      studentByNationality: systemContext.summary.studentByNationality,
      studentAdmitYearRange: systemContext.summary.studentAdmitYearRange,
      studentGpaAvg: systemContext.summary.studentGpaAvg,
    },
  });

  const response = await params.ai.extractStructured(
    {
      ctx: {
        module: 'curriculum',
        kind: 'program-digest',
        userId: params.triggeredByUserId ?? null,
        traceId: `program-digest-${program.id}`,
      },
      messages,
      methodVersion: PROGRAM_DIGEST_VERSION,
      maxOutputTokens: 16000,
    },
    ProgramDigestSchema,
  );

  const created = await prisma.aiExtraction.create({
    data: {
      sourceEntityType: 'program',
      sourceEntityId: program.id,
      extractionKind: 'PROGRAM_DIGEST',
      payloadJson: response.parsed as object,
      confidence: response.confidence,
      methodVersion: PROGRAM_DIGEST_VERSION,
      aiInferenceId: response.aiInferenceId,
      reviewStatus: 'PENDING_REVIEW',
      reasoning: response.reasoning ?? null,
    },
    select: { id: true },
  });

  return {
    status: 'SUCCEEDED',
    aiExtractionId: created.id,
    aiInferenceId: response.aiInferenceId,
    confidence: response.confidence,
    tokensInput: response.tokens.input,
    tokensOutput: response.tokens.output,
    costUsd: response.cost.usd,
    skillsExtracted: response.parsed.extractedSkills.length,
  };
}
