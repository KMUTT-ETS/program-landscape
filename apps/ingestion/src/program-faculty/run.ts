import { prisma } from '@kku/db';
import {
  buildProgramFacultyMessages,
  ProgramFacultyExtractionSchema,
  PROGRAM_FACULTY_VERSION,
  type ProgramFacultyExtraction,
  type ProgramFacultyMemberExtraction,
  type ProgramFacultyRole,
  type AiService,
  type S3Storage,
} from '@kku/shared';
import { extractNativeText } from '../pdf-intake/pipeline/native-text-extractor';

// ─────────────────────────────────────────────────────────────────────────────
// Per-program academic-staff extraction.
//
// 1. Fetch the program's CURRENT_CURRICULUM PDF
// 2. Run the program-faculty.v1 prompt to extract a structured staff list
// 3. Resolve each name against `faculty_members` (already loaded by
//    the kku-hr connector) by exact normalised match on nameTh/nameEn
// 4. Persist:
//    a. AiExtraction(kind='PROGRAM_FACULTY_LIST') for full audit
//    b. ProgramFaculty link rows for matched names — drives the deep-dive
//       faculty section + cross-joins to research_outputs for per-program
//       publication counts
// 5. Unmatched names land in IngestionRun.metadata.unmatchedFacultyNames
//    (or the AiExtraction reasoning text) for analyst triage
//
// Idempotency: keyed on `(programId, facultyMemberId)` so re-running
// upserts cleanly. The `force=true` flag re-extracts even when an
// extraction exists (for prompt-version bumps).
// ─────────────────────────────────────────────────────────────────────────────

const LEVEL_TH_LABEL: Record<string, string> = {
  BACHELOR: 'ป.ตรี',
  MASTER: 'ป.โท',
  DOCTORAL: 'ป.เอก',
  HIGHER_GRAD_DIPLOMA: 'ป.บัณฑิตชั้นสูง',
};

const ROLE_PRIORITY: Record<ProgramFacultyRole, number> = {
  COORDINATOR: 4,
  CORE: 3,
  INSTRUCTOR: 2,
  SPECIAL: 1,
};

// ProgramFaculty.role enum is (COORDINATOR / CORE / SUPPORT).
// Map our extraction roles → schema roles.
function mapRoleToSchema(role: ProgramFacultyRole): 'COORDINATOR' | 'CORE' | 'SUPPORT' {
  if (role === 'COORDINATOR') return 'COORDINATOR';
  if (role === 'SPECIAL') return 'SUPPORT';
  return 'CORE'; // CORE + INSTRUCTOR both map to CORE
}

export interface RunProgramFacultyParams {
  programId: string;
  ai: AiService;
  storage: S3Storage;
  triggeredByUserId?: string | null;
  force?: boolean;
}

export type RunProgramFacultyOutcome =
  | {
      status: 'SUCCEEDED';
      aiExtractionId: string;
      aiInferenceId: string | null;
      confidence: number;
      tokensInput: number;
      tokensOutput: number;
      costUsd: number;
      staffExtracted: number;
      staffMatched: number;
      staffUnmatched: number;
      programFacultyRowsWritten: number;
      unmatchedNames: string[];
    }
  | { status: 'SKIPPED'; reason: string }
  | { status: 'FAILED'; reason: string };

/** Normalise for name comparison: trim, collapse whitespace, lowercase. */
function normName(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

export async function runProgramFacultyExtraction(
  params: RunProgramFacultyParams,
): Promise<RunProgramFacultyOutcome> {
  const program = await prisma.program.findUnique({
    where: { id: params.programId },
    include: {
      faculty: { select: { id: true, nameTh: true } },
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
        extractionKind: 'PROGRAM_FACULTY_LIST',
      },
      select: { id: true },
    });
    if (existing) {
      return { status: 'SKIPPED', reason: 'PROGRAM_FACULTY_LIST already exists; pass force=true to re-run' };
    }
  }

  // Fetch PDF bytes from MinIO via signed URL.
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

  // Run the AI extraction.
  const messages = buildProgramFacultyMessages({
    programMetaFromSheet: {
      facultyNameTh: program.faculty.nameTh,
      levelTh: LEVEL_TH_LABEL[program.level] ?? program.level,
      degreeNameFromSheet: program.nameTh,
    },
    pdfText: extracted.fullText,
  });

  const response = await params.ai.extractStructured(
    {
      ctx: {
        module: 'curriculum',
        kind: 'program-faculty',
        userId: params.triggeredByUserId ?? null,
        traceId: `program-faculty-${program.id}`,
      },
      messages,
      methodVersion: PROGRAM_FACULTY_VERSION,
      // Even a 100-staff program comes in well under 8K output tokens.
      // 12K gives generous headroom for verbose qualifications.
      maxOutputTokens: 12000,
    },
    ProgramFacultyExtractionSchema,
  );

  const extraction: ProgramFacultyExtraction = response.parsed;

  // Resolve names against faculty_members in the SAME Faculty (the program
  // can only realistically be taught by staff in its own Faculty).
  const facultyMembers = await prisma.facultyMember.findMany({
    where: { facultyId: program.faculty.id },
    select: { id: true, nameTh: true, nameEn: true },
  });
  const byNameTh = new Map<string, string>();
  const byNameEn = new Map<string, string>();
  for (const fm of facultyMembers) {
    if (fm.nameTh) byNameTh.set(normName(fm.nameTh), fm.id);
    if (fm.nameEn) byNameEn.set(normName(fm.nameEn), fm.id);
  }

  // Dedupe the AI's output by Thai name, picking the highest-priority role.
  const dedupedByName = new Map<string, ProgramFacultyMemberExtraction>();
  for (const s of extraction.staff) {
    const key = normName(s.nameTh);
    const existing = dedupedByName.get(key);
    if (!existing || ROLE_PRIORITY[s.role] > ROLE_PRIORITY[existing.role]) {
      dedupedByName.set(key, s);
    }
  }

  const unmatchedNames: string[] = [];
  let programFacultyRowsWritten = 0;
  let matched = 0;

  for (const [, s] of dedupedByName) {
    const nameThKey = normName(s.nameTh);
    const nameEnKey = normName(s.nameEn);
    const facultyMemberId = byNameTh.get(nameThKey) ?? (s.nameEn ? byNameEn.get(nameEnKey) : undefined);

    if (!facultyMemberId) {
      unmatchedNames.push(`${s.titlePrefix ?? ''}${s.nameTh}${s.nameEn ? ` / ${s.nameEn}` : ''} (${s.role})`);
      continue;
    }
    matched++;

    try {
      await prisma.programFaculty.upsert({
        where: { facultyMemberId_programId: { facultyMemberId, programId: program.id } },
        create: {
          facultyMemberId,
          programId: program.id,
          role: mapRoleToSchema(s.role),
        },
        update: {
          // Pick the higher-priority role on conflict (re-runs may
          // upgrade INSTRUCTOR → COORDINATOR if the prompt classifies
          // differently a second time).
          role: mapRoleToSchema(s.role),
        },
      });
      programFacultyRowsWritten++;
    } catch (err) {
      // Best-effort; per-row failure shouldn't fail the whole extraction.
      unmatchedNames.push(`${s.nameTh} (write-failed: ${err instanceof Error ? err.message : String(err)})`);
    }
  }

  // Persist the full extraction with audit trail.
  const created = await prisma.aiExtraction.create({
    data: {
      sourceEntityType: 'program',
      sourceEntityId: program.id,
      extractionKind: 'PROGRAM_FACULTY_LIST',
      payloadJson: {
        ...extraction,
        unmatchedNames,
        matchedCount: matched,
      } as object,
      confidence: response.confidence,
      methodVersion: PROGRAM_FACULTY_VERSION,
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
    staffExtracted: dedupedByName.size,
    staffMatched: matched,
    staffUnmatched: unmatchedNames.length,
    programFacultyRowsWritten,
    unmatchedNames,
  };
}
