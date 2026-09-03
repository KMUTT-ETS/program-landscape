import { prisma, materialiseProgramDigest, activeRevisionIdFor } from '@kku/db';
import {
  buildProgramDigestMessages,
  ProgramDigestSchema,
  PROGRAM_DIGEST_VERSION,
  type AiService,
  type S3Storage,
} from '@kku/shared';
import { Logger } from '@nestjs/common';
import { extractNativeText } from '../pdf-intake/pipeline/native-text-extractor';
import { loadProgramSystemContext } from '../program-system-context/load';

const digestLogger = new Logger('ProgramDigest');

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
  // Optional pre-prepared inputs — when the pipeline already fetched the
  // PDF + extracted text + loaded the system context for parallel
  // phase-1 extractors, pass them in to skip the redundant work. When
  // absent, the function falls back to its own fetch + extract + load
  // (so standalone CLI invocations still work).
  pdfPrep?: import('../program-pdf-prep/load').ProgramPdfPrep;
  systemContext?: Awaited<ReturnType<typeof import('../program-system-context/load').loadProgramSystemContext>>;
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
      /** True when the digest cleared the auto-approve threshold and
       *  was stamped AUTO_APPROVED at write time (no analyst sign-off
       *  needed). False when the row landed PENDING_REVIEW. */
      autoApproved: boolean;
      /** True when materialiseProgramDigest ran successfully right
       *  after the auto-approval — the digest is already reflected in
       *  Program columns + ProgramSkill rows. */
      materialised: boolean;
      /** Set when materialisation was attempted but failed. The AI
       *  extraction row is persisted regardless; operator can retry
       *  from /admin/extraction-review. */
      materialisationError: string | null;
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

  // Reuse pipeline-prepared inputs when present; else fetch + extract +
  // load locally. The local path mirrors what every standalone CLI
  // invocation has always done.
  let extracted = params.pdfPrep;
  if (!extracted) {
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
    extracted = await extractNativeText(bytes);
  }

  // Load live grounding from DS2004 + DS2003 + DS1001 + kku-hr so the
  // recruitment summary's claims about staff and student composition
  // are anchored in real numbers, not invented from the PDF.
  const systemContext = params.systemContext ?? (await loadProgramSystemContext(program.id));

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
      // Bumped 16000 → 50000 on 2026-05-13 to fit very large
      // curriculum digests (PLO + all-courses + recruitment summary +
      // skills + evidence quotes) without hitting the previous ceiling.
      // Gemini 2.5 Pro's hard cap is 65536; 50000 leaves headroom for
      // reasoning tokens that count against the same budget.
      maxOutputTokens: 50000,
    },
    ProgramDigestSchema,
  );

  // Auto-approve gate. AI_AUTO_APPROVE_THRESHOLD defaults to 0 (every
  // extraction auto-approves at write time) per the 2026-05-13 KKU
  // operator policy that disables human review. Set the env to a
  // non-zero confidence floor (e.g. 0.85) to bring the review queue
  // back.
  const autoApproveThreshold = Number(process.env.AI_AUTO_APPROVE_THRESHOLD ?? 0);
  const autoApprove = response.confidence >= autoApproveThreshold;

  // Stamp the revision this extraction was taken from, so the guard can
  // later tell a current extraction from one taken off a superseded มคอ.2.
  // Resolved here rather than passed in: these runners are also invoked
  // standalone from the CLI, not only from the pipeline.
  const programRevisionId = await activeRevisionIdFor(program.id);

  const created = await prisma.aiExtraction.create({
    data: {
      sourceEntityType: 'program',
      sourceEntityId: program.id,
      extractionKind: 'PROGRAM_DIGEST',
      programRevisionId,
      payloadJson: response.parsed as object,
      confidence: response.confidence,
      methodVersion: PROGRAM_DIGEST_VERSION,
      aiInferenceId: response.aiInferenceId,
      reviewStatus: autoApprove ? 'AUTO_APPROVED' : 'PENDING_REVIEW',
      reasoning: response.reasoning ?? null,
    },
    select: { id: true },
  });

  // When auto-approved, run materialise immediately so the digest
  // writes through to Program columns + ProgramSkill rows without a
  // second "click approve all" pass. Errors are logged but don't fail
  // the digest run — the AiExtraction row is already persisted and the
  // operator can re-trigger materialisation from /admin/extraction-review
  // (or via the bulk-approve endpoint on /admin/queues).
  let materialised = false;
  let materialisationError: string | null = null;
  if (autoApprove) {
    try {
      await materialiseProgramDigest(created.id);
      materialised = true;
    } catch (err) {
      materialisationError = err instanceof Error ? err.message : String(err);
      digestLogger.warn(
        `materialiseProgramDigest failed for extraction ${created.id} (program ${program.code}): ${materialisationError}`,
      );
    }
  }

  return {
    status: 'SUCCEEDED',
    aiExtractionId: created.id,
    aiInferenceId: response.aiInferenceId,
    confidence: response.confidence,
    tokensInput: response.tokens.input,
    tokensOutput: response.tokens.output,
    costUsd: response.cost.usd,
    skillsExtracted: response.parsed.extractedSkills.length,
    autoApproved: autoApprove,
    materialised,
    materialisationError,
  };
}
