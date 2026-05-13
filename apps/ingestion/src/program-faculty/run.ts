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
import { loadProgramSystemContext } from '../program-system-context/load';

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
      // Number of rows seeded directly from DS2004 (the MHESI submission)
      // — these are the high-confidence, citizen-ID-anchored matches
      // that no longer rely on PDF text extraction.
      programFacultyRowsFromMhesi: number;
      unmatchedNames: string[];
    }
  | { status: 'SKIPPED'; reason: string }
  | { status: 'FAILED'; reason: string };

/**
 * Map a DS2004 teach_type_id to our ProgramFaculty role enum.
 *   1 = อาจารย์ประจำ              → CORE
 *   2 = อาจารย์ประจำหลักสูตร       → CORE (curriculum-listed)
 *   3 = อาจารย์ผู้รับผิดชอบหลักสูตร → COORDINATOR (responsible 5-person)
 */
function teachTypeToRole(teachTypeId: number): 'COORDINATOR' | 'CORE' | 'SUPPORT' {
  if (teachTypeId === 3) return 'COORDINATOR';
  return 'CORE';
}

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

  // ── PHASE A — Seed ProgramFaculty rows from DS2004 (the MHESI
  // submission), which is now the *primary* source of truth for who
  // teaches in this program. Rows are anchored on FacultyMember by
  // citizenIdHash, no name-matching guesswork. The PDF extraction
  // below runs as enrichment for staff that DS2004 doesn't track
  // (visiting lecturers, external instructors, brand-new appointments
  // not yet submitted to MHESI). ──────────────────────────────────
  const systemContext = await loadProgramSystemContext(program.id);
  let programFacultyRowsFromMhesi = 0;
  const facultyMemberIdsFromMhesi = new Set<string>();
  for (const s of systemContext.staffFromMhesi) {
    if (!s.facultyMemberId) continue;
    facultyMemberIdsFromMhesi.add(s.facultyMemberId);
    try {
      await prisma.programFaculty.upsert({
        where: {
          facultyMemberId_programId: {
            facultyMemberId: s.facultyMemberId,
            programId: program.id,
          },
        },
        create: {
          facultyMemberId: s.facultyMemberId,
          programId: program.id,
          role: teachTypeToRole(s.teachTypeId),
        },
        update: {
          // Don't downgrade an existing COORDINATOR back to CORE on re-run.
          role:
            s.teachTypeId === 3
              ? 'COORDINATOR'
              : undefined,
        },
      });
      programFacultyRowsFromMhesi += 1;
    } catch {
      // Best-effort. Per-row failures shouldn't fail the whole step.
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
      // Faculty extraction is pure name+role+qualification listing —
      // no reasoning needed. Disable thinking explicitly so the entire
      // output budget is available for JSON. With the default Pro auto-
      // thinking (40% of maxOutputTokens), Gemini consumes ~4,800 of a
      // 12K budget on internal reasoning then truncates the JSON near
      // 2,400 tokens. Observed on KKU-SEQ-0018 (50 instructors × verbose
      // Thai qualifications ≈ 10K tokens of JSON): two consecutive Pro
      // retries truncated mid-Thai-text at exactly 2,425 output tokens.
      thinking: false,
      // 24K headroom — accounts for programs with 60-80 staff entries
      // and Thai qualification strings that average ~150 tokens each.
      // Bumped 24000 → 50000 on 2026-05-13. Large programs (Medicine,
      // Engineering) carry 100+ academic staff each; the prior cap
      // truncated faculty lists mid-stream.
      maxOutputTokens: 50000,
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

    // Skip if DS2004 already seeded this person — the MHESI submission
    // is more authoritative than PDF name-matching, and we don't want
    // to overwrite a COORDINATOR role with a PDF-derived CORE role.
    if (facultyMemberIdsFromMhesi.has(facultyMemberId)) {
      continue;
    }

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

  // Auto-approve gate — same posture as program-digest/run.ts. The
  // PROGRAM_FACULTY_LIST extractor doesn't have a separate materialise
  // step today; the ProgramFaculty rows above were already written
  // inline. Auto-approving here just clears the row from the review
  // queue. Set AI_AUTO_APPROVE_THRESHOLD to a non-zero value to bring
  // the review gate back.
  const autoApproveThreshold = Number(process.env.AI_AUTO_APPROVE_THRESHOLD ?? 0);
  const autoApprove = response.confidence >= autoApproveThreshold;

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
      reviewStatus: autoApprove ? 'AUTO_APPROVED' : 'PENDING_REVIEW',
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
    programFacultyRowsFromMhesi,
    unmatchedNames,
  };
}
