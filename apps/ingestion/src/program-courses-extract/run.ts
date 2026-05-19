import { prisma } from '@kku/db';
import {
  buildProgramCoursesExtractMessages,
  ProgramCoursesExtractSchema,
  PROGRAM_COURSES_EXTRACT_VERSION,
  type AiService,
  type S3Storage,
} from '@kku/shared';
import { Logger } from '@nestjs/common';
import { extractNativeText } from '../pdf-intake/pipeline/native-text-extractor';
import { normaliseCourseCode } from '../lib/course-code';

const logger = new Logger('ProgramCoursesExtract');

const LEVEL_TH_LABEL: Record<string, string> = {
  BACHELOR: 'ป.ตรี',
  MASTER: 'ป.โท',
  DOCTORAL: 'ป.เอก',
  HIGHER_GRAD_DIPLOMA: 'ป.บัณฑิตชั้นสูง',
};

export interface RunProgramCoursesExtractParams {
  programId: string;
  ai: AiService;
  storage: S3Storage;
  triggeredByUserId?: string | null;
  /** When true (default), wipe + re-insert program_courses for this
   *  program from the new extraction. When false, only write the
   *  AiExtraction row (analyst materialises manually). */
  materialise?: boolean;
}

export type RunProgramCoursesExtractOutcome =
  | {
      status: 'SUCCEEDED';
      aiExtractionId: string;
      aiInferenceId: string | null;
      confidence: number;
      tokensInput: number;
      tokensOutput: number;
      costUsd: number;
      /** Course codes the AI returned. */
      extractedCount: number;
      /** Rows that actually landed in program_courses after normalisation
       *  + dedup. */
      materialisedCount: number;
      /** Previous count (delete-and-replace path), for the operator log. */
      previousCount: number;
    }
  | { status: 'SKIPPED'; reason: string }
  | { status: 'FAILED'; reason: string };

export async function runProgramCoursesExtract(
  params: RunProgramCoursesExtractParams,
): Promise<RunProgramCoursesExtractOutcome> {
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

  // Read PDF bytes from MinIO.
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

  const messages = buildProgramCoursesExtractMessages({
    programCode: program.code,
    programNameTh: program.nameTh,
    programNameEn: program.nameEn ?? '',
    facultyNameTh: program.faculty.nameTh,
    levelTh: LEVEL_TH_LABEL[program.level] ?? program.level,
    pdfText: extracted.fullText,
  });

  const response = await params.ai.extractStructured(
    {
      ctx: {
        module: 'curriculum',
        kind: 'program-courses-extract',
        userId: params.triggeredByUserId ?? null,
        traceId: `program-courses-extract-${program.id}`,
      },
      messages,
      methodVersion: PROGRAM_COURSES_EXTRACT_VERSION,
      // Course listings are dense but light — typical output 1k-4k tokens.
      maxOutputTokens: 16000,
    },
    ProgramCoursesExtractSchema,
  );

  // Persist the AI extraction row. Auto-approved by design — this is
  // structural reference data, low risk; the materialiser is the
  // arbiter of correctness when classes don't join.
  const created = await prisma.aiExtraction.create({
    data: {
      sourceEntityType: 'program',
      sourceEntityId: program.id,
      extractionKind: 'PROGRAM_COURSES_EXTRACT',
      payloadJson: response.parsed as object,
      confidence: response.confidence,
      methodVersion: PROGRAM_COURSES_EXTRACT_VERSION,
      aiInferenceId: response.aiInferenceId,
      reviewStatus: 'AUTO_APPROVED',
      reasoning: response.reasoning ?? null,
    },
    select: { id: true },
  });

  // Materialise into program_courses (delete-and-replace per program).
  // Normalise course codes the same way ClassOffering does so the
  // natural join key matches.
  const previousCount = await prisma.programCourse.count({
    where: { programId: program.id },
  });

  let materialisedCount = 0;
  if (params.materialise !== false) {
    // De-dup by normalised code — the AI sometimes lists the same
    // course under multiple sections (e.g. "ปีที่ 1 ภาค 1" AND a
    // study-plan table). The compound unique key on (programId, courseCode)
    // already enforces this at the DB layer; doing it client-side
    // makes the log accurate.
    const seen = new Set<string>();
    let skippedPlaceholder = 0;
    const rows: Array<{
      programId: string;
      courseCode: string;
      courseCodeRaw: string;
      courseNameTh: string | null;
      courseNameEn: string | null;
      credits: number | null;
      methodVersion: string;
    }> = [];
    for (const c of response.parsed.courses) {
      const norm = normaliseCourseCode(c.code);
      if (!norm || norm.length < 4) continue;
      // Placeholder filter — curriculum PDFs use repeated-character
      // codes like "XXXXXXXX" or "????????" or "00000000" to mark
      // free-elective / unspecified slots that don't correspond to a
      // real CLASSID in VIEW_CLASS_OPEN_GROUP_OFFICER. Drop them so
      // the join doesn't carry phantom rows.
      if (/^([X?N0-])\1+$/i.test(norm)) {
        skippedPlaceholder++;
        continue;
      }
      if (seen.has(norm)) continue;
      seen.add(norm);
      rows.push({
        programId: program.id,
        courseCode: norm,
        courseCodeRaw: c.code,
        courseNameTh: c.nameTh || null,
        courseNameEn: c.nameEn || null,
        credits: c.credits,
        methodVersion: PROGRAM_COURSES_EXTRACT_VERSION,
      });
    }
    // Transaction: wipe + reinsert. Idempotent on re-runs.
    await prisma.$transaction([
      prisma.programCourse.deleteMany({ where: { programId: program.id } }),
      prisma.programCourse.createMany({ data: rows, skipDuplicates: true }),
    ]);
    materialisedCount = rows.length;
    logger.log(
      `[${program.code}] extracted=${response.parsed.courses.length} normalised+deduped=${materialisedCount} placeholders-skipped=${skippedPlaceholder} previous=${previousCount} confidence=${response.confidence.toFixed(2)}`,
    );
  }

  return {
    status: 'SUCCEEDED',
    aiExtractionId: created.id,
    aiInferenceId: response.aiInferenceId,
    confidence: response.confidence,
    tokensInput: response.tokens.input,
    tokensOutput: response.tokens.output,
    costUsd: response.cost.usd,
    extractedCount: response.parsed.courses.length,
    materialisedCount,
    previousCount,
  };
}
