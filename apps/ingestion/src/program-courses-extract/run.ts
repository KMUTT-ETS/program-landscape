import { prisma } from '@kku/db';
import {
  buildProgramCoursesExtractMessages,
  extractCandidateCourseCodes,
  extractCourseListSection,
  extractFallbackCourseFromContext,
  ProgramCoursesExtractSchema,
  PROGRAM_COURSES_EXTRACT_VERSION,
  type AiService,
  type CourseCategory,
  type ExtractionResponse,
  type ProgramCoursesExtractPayload,
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
  /** Optional pipeline-shared PDF prep. See program-pdf-prep/load.ts. */
  pdfPrep?: import('../program-pdf-prep/load').ProgramPdfPrep;
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

  // Reuse pipeline-shared PDF prep when supplied; else fetch + extract.
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

  // v2.3 scope clamp: extract only from the รายวิชา section (the
  // structured course list organised into 3 หมวด: ศึกษาทั่วไป /
  // เฉพาะ / เลือกเสรี). Everything outside it — cover, ToC,
  // ตัวอย่างแผนการศึกษา, คำอธิบายรายวิชา, and all ภาคผนวก — is
  // invisible. Earlier versions read the full PDF and pulled in
  // old-curriculum codes from the curriculum-revision comparison
  // appendix; v2.3 slices that ambiguity out at the source.
  const slice = extractCourseListSection(extracted.fullText);
  if (!slice.found) {
    return {
      status: 'SKIPPED',
      reason:
        'Could not locate the "รายวิชา" section (X.Y รายวิชา → 3 หมวด → course codes) in the PDF — refusing to extract from the full document to avoid pulling appendix codes.',
    };
  }
  const sectionText = slice.text;
  logger.log(
    `[${program.code}] sliced รายวิชา section: ` +
      `${slice.startIndex}..${slice.endIndex} ` +
      `(${(sectionText.length / 1024).toFixed(1)} KB of ${(extracted.fullText.length / 1024).toFixed(1)} KB)`,
  );

  // Regex pre-scan + LLM both operate on the slice only. The catalog
  // routes this method to Pro (locked) because the inline candidate
  // list is unsafe on Flash.
  const candidateCodes = extractCandidateCourseCodes(sectionText);

  const messages = buildProgramCoursesExtractMessages({
    programCode: program.code,
    programNameTh: program.nameTh,
    programNameEn: program.nameEn ?? '',
    facultyNameTh: program.faculty.nameTh,
    levelTh: LEVEL_TH_LABEL[program.level] ?? program.level,
    pdfText: sectionText,
    candidateCodes,
  });

  // v2.2: wrap the LLM call in try/catch. On long curricula Pro can
  // still occasionally hit a hard ~6,600-token output ceiling that
  // truncates the JSON mid-entry (despite thinking: false +
  // maxOutputTokens: 32000), producing "no json found" at schema
  // validation. We don't want one truncated LLM response to discard
  // ~200 regex-extractable courses — the fallback below runs on the
  // full candidate set when the LLM result is absent.
  let response: ExtractionResponse<ProgramCoursesExtractPayload> | null = null;
  let llmFailureReason: string | null = null;
  try {
    response = await params.ai.extractStructured(
      {
        ctx: {
          module: 'curriculum',
          kind: 'program-courses-extract',
          userId: params.triggeredByUserId ?? null,
          traceId: `program-courses-extract-${program.id}`,
        },
        messages,
        methodVersion: PROGRAM_COURSES_EXTRACT_VERSION,
        // Course listings are dense but light — typical output 5k-7k
        // tokens. Bumped 16k → 32k in v2.2 to give Pro slack against
        // the deterministic truncation that hits ~6,600 tokens on long
        // mคอ.2 documents (KKU-SEQ-0090 reproducer).
        maxOutputTokens: 32000,
        // Pro defaults to thinking-on; the embedded candidate list +
        // structured-output mode interact badly with the thinking budget
        // (~40% of output is reserved for thinking, and the model spends
        // it all on reasoning about the list). Disabling thinking gives
        // the full budget to the JSON.
        thinking: false,
      },
      ProgramCoursesExtractSchema,
    );
  } catch (e) {
    llmFailureReason = String((e as Error)?.message ?? e);
    logger.warn(
      `[${program.code}] LLM extract failed — falling back to regex-only ` +
        `(reason: ${llmFailureReason.slice(0, 200)})`,
    );
  }

  // Persist the AI extraction row. Auto-approved by design — this is
  // structural reference data, low risk; the materialiser is the
  // arbiter of correctness when classes don't join. On LLM failure we
  // still write a row with confidence=0 + the failure reason so the
  // audit trail stays complete.
  const llmCourses = response?.parsed.courses ?? [];
  const created = await prisma.aiExtraction.create({
    data: {
      sourceEntityType: 'program',
      sourceEntityId: program.id,
      extractionKind: 'PROGRAM_COURSES_EXTRACT',
      payloadJson: (response?.parsed ?? {
        courses: [],
        caveats: [llmFailureReason ?? 'LLM call failed'],
        confidence: 0,
        llmFailureReason,
      }) as object,
      confidence: response?.confidence ?? 0,
      methodVersion: PROGRAM_COURSES_EXTRACT_VERSION,
      aiInferenceId: response?.aiInferenceId ?? null,
      reviewStatus: 'AUTO_APPROVED',
      reasoning: response?.reasoning
        ?? (llmFailureReason
          ? `LLM call failed: ${llmFailureReason}. Courses materialised from regex fallback only.`
          : null),
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
  let fallbackAddedCount = 0;
  if (params.materialise !== false) {
    // De-dup by normalised code — the AI sometimes lists the same
    // course under multiple sections (e.g. "ปีที่ 1 ภาค 1" AND a
    // study-plan table). The compound unique key on (programId, courseCode)
    // already enforces this at the DB layer; doing it client-side
    // makes the log accurate.
    const seen = new Set<string>();
    let skippedPlaceholder = 0;
    // Counts LLM rows dropped by the first-wins dedup below. Usually
    // benign — per the comment above, the common cause is one course
    // appearing in both a section table and the study-plan table, same
    // หมวด both times, so the discarded row was identical anyway. The
    // number is logged for the rarer case: a course listed under two
    // DIFFERENT headings, where first-wins silently picks one category.
    // So treat a nonzero count as a prompt to look, not as evidence of
    // ambiguity on its own.
    //
    // Deliberately NOT incremented by the fallback loop's `seen.has(code)`
    // check further down: that one skips candidates the LLM already
    // emitted, which happens on essentially every run and would swamp
    // this signal. Please don't "fix" the missing increment there.
    let duplicateCourseRows = 0;
    const rows: Array<{
      programId: string;
      courseCode: string;
      courseCodeRaw: string;
      courseNameTh: string | null;
      courseNameEn: string | null;
      credits: number | null;
      category: CourseCategory | null;
      methodVersion: string;
    }> = [];
    const placeholderRe = /^([X?N0-])\1+$/i;
    for (const c of llmCourses) {
      const norm = normaliseCourseCode(c.code);
      if (!norm || norm.length < 4) continue;
      // Placeholder filter — curriculum PDFs use repeated-character
      // codes like "XXXXXXXX" or "????????" or "00000000" to mark
      // free-elective / unspecified slots that don't correspond to a
      // real CLASSID in VIEW_CLASS_OPEN_GROUP_OFFICER. Drop them so
      // the join doesn't carry phantom rows.
      if (placeholderRe.test(norm)) {
        skippedPlaceholder++;
        continue;
      }
      if (seen.has(norm)) {
        duplicateCourseRows++;
        continue;
      }
      seen.add(norm);
      rows.push({
        programId: program.id,
        courseCode: norm,
        courseCodeRaw: c.code,
        courseNameTh: c.nameTh || null,
        courseNameEn: c.nameEn || null,
        credits: c.credits,
        category: c.category,
        methodVersion: PROGRAM_COURSES_EXTRACT_VERSION,
      });
    }

    // v2 fallback: any regex-detected candidate the LLM didn't emit gets
    // a deterministic name+credit extraction from the PDF text. Filtered
    // by occurrenceCount >= 2 to drop single-mention noise (page-number
    // refs and footnote citations) while keeping real elective-catalog +
    // faculty-teaching-load entries the LLM is prone to skipping.
    //
    // KKU-SEQ-0090 baseline (Bachelor of Laws, 210 candidates):
    //   LLM alone        → 104 courses (52% recall vs 196 LW codes)
    //   LLM + fallback   → 140+ courses (target ground-truth)
    for (const code of candidateCodes) {
      if (seen.has(code) || placeholderRe.test(code)) continue;
      const fb = extractFallbackCourseFromContext(sectionText, code);
      if (!fb) continue;
      // Single-occurrence codes are usually noise (page-number, footnote
      // ref). Require ≥2 occurrences to count as a real course.
      if (fb.occurrenceCount < 2) continue;
      seen.add(code);
      rows.push({
        programId: program.id,
        courseCode: code,
        courseCodeRaw: code,
        courseNameTh: fb.nameTh || null,
        courseNameEn: fb.nameEn || null,
        credits: fb.credits,
        // Structurally UNKNOWN — this path recovers a course from a text
        // window around its code and never reads the หมวด headings. Written
        // explicitly so promotion logic sees these rows as unplaced rather
        // than indistinguishable from "not yet re-extracted" NULLs.
        category: fb.category,
        methodVersion: `${PROGRAM_COURSES_EXTRACT_VERSION}-fallback`,
      });
      fallbackAddedCount++;
    }

    // Transaction: wipe + reinsert. Idempotent on re-runs.
    await prisma.$transaction([
      prisma.programCourse.deleteMany({ where: { programId: program.id } }),
      prisma.programCourse.createMany({ data: rows, skipDuplicates: true }),
    ]);
    materialisedCount = rows.length;
    logger.log(
      `[${program.code}] candidates=${candidateCodes.length} llm=${llmCourses.length}` +
        (llmFailureReason ? ' (LLM FAILED)' : '') +
        ` fallback-added=${fallbackAddedCount} materialised=${materialisedCount}` +
        ` llm-duplicate-rows=${duplicateCourseRows}` +
        ` placeholders-skipped=${skippedPlaceholder} previous=${previousCount}` +
        ` confidence=${(response?.confidence ?? 0).toFixed(2)}`,
    );
  }

  return {
    status: 'SUCCEEDED',
    aiExtractionId: created.id,
    aiInferenceId: response?.aiInferenceId ?? null,
    confidence: response?.confidence ?? 0,
    tokensInput: response?.tokens.input ?? 0,
    tokensOutput: response?.tokens.output ?? 0,
    costUsd: response?.cost.usd ?? 0,
    extractedCount: llmCourses.length,
    materialisedCount,
    previousCount,
  };
}
