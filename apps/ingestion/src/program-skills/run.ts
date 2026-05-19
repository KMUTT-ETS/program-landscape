import { prisma, lookupAliasesBulk } from '@kku/db';
import {
  buildProgramSkillsDetailedMessages,
  ProgramSkillsDetailedSchema,
  PROGRAM_SKILLS_DETAILED_VERSION,
  type AiService,
  type S3Storage,
} from '@kku/shared';
import { extractNativeText } from '../pdf-intake/pipeline/native-text-extractor';

// ─────────────────────────────────────────────────────────────────────────────
// Per-program detailed-skills extraction.
//
// Pipeline:
//   1. Fetch CURRENT_CURRICULUM PDF
//   2. Run program-skills-detailed.v2 prompt to get a richer skill list
//      (PLO-tagged, compulsory/elective weights, evidence quotes)
//   3. Resolve each skill name against existing Skill rows + the
//      SkillAlias cache (program_digest source — populated by the
//      AI normaliser) so curriculum-vocabulary names land on existing
//      skills cleanly
//   4. Replace ProgramSkill rows for the program (delete + recreate) so
//      the new richer fields (compulsoryWeight / electiveWeight /
//      pickedFromPlo / evidenceQuote) are populated
//   5. Persist the full extraction as AiExtraction(kind='PROGRAM_SKILLS_DETAILED')
//
// Idempotency: ProgramSkill rows are replaced wholesale per program on
// each run. Re-running with --force is safe; existing AiExtraction rows
// from program-digest.v1 are preserved (different kind).
// ─────────────────────────────────────────────────────────────────────────────

const LEVEL_TH_LABEL: Record<string, string> = {
  BACHELOR: 'ป.ตรี',
  MASTER: 'ป.โท',
  DOCTORAL: 'ป.เอก',
  HIGHER_GRAD_DIPLOMA: 'ป.บัณฑิตชั้นสูง',
};

export interface RunProgramSkillsParams {
  programId: string;
  ai: AiService;
  storage: S3Storage;
  triggeredByUserId?: string | null;
  force?: boolean;
  // Optional pipeline-shared PDF prep. See program-pdf-prep/load.ts.
  pdfPrep?: import('../program-pdf-prep/load').ProgramPdfPrep;
}

export type RunProgramSkillsOutcome =
  | {
      status: 'SUCCEEDED';
      aiExtractionId: string;
      aiInferenceId: string | null;
      confidence: number;
      tokensInput: number;
      tokensOutput: number;
      costUsd: number;
      skillsExtracted: number;
      skillsResolvedToTaxonomy: number;
      skillsUnresolved: number;
      ploCount: number;
      compulsoryCourseCount: number;
      electiveCourseCount: number;
      programSkillRowsWritten: number;
      unresolvedNames: string[];
    }
  | { status: 'SKIPPED'; reason: string }
  | { status: 'FAILED'; reason: string };

function normName(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

export async function runProgramSkillsDetailed(
  params: RunProgramSkillsParams,
): Promise<RunProgramSkillsOutcome> {
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
        extractionKind: 'PROGRAM_SKILLS_DETAILED',
      },
      select: { id: true },
    });
    if (existing) {
      return { status: 'SKIPPED', reason: 'PROGRAM_SKILLS_DETAILED already exists; pass force=true to re-run' };
    }
  }

  // Reuse pipeline-shared PDF prep when supplied; else fetch + extract.
  let extracted = params.pdfPrep;
  if (!extracted) {
    const m = /^s3:\/\/([^/]+)\/(.+)$/.exec(doc.pdfDocument.storageUrl);
    if (!m) return { status: 'FAILED', reason: `unrecognised storageUrl: ${doc.pdfDocument.storageUrl}` };
    const url = await params.storage.getSignedDownloadUrl({ bucket: m[1]!, key: m[2]!, ttlSeconds: 300 });
    const res = await fetch(url);
    if (!res.ok) return { status: 'FAILED', reason: `PDF fetch ${res.status}` };
    const bytes = Buffer.from(await res.arrayBuffer());
    extracted = await extractNativeText(bytes);
  }

  // Run AI extraction
  const messages = buildProgramSkillsDetailedMessages({
    programMetaFromSheet: {
      facultyNameTh: program.faculty.nameTh,
      levelTh: LEVEL_TH_LABEL[program.level] ?? program.level,
      degreeNameFromSheet: program.nameTh,
      majorNameFromSheet: program.majors[0] ?? '',
    },
    pdfText: extracted.fullText,
  });
  const response = await params.ai.extractStructured(
    {
      ctx: {
        module: 'curriculum',
        kind: 'program-skills-detailed',
        userId: params.triggeredByUserId ?? null,
        traceId: `program-skills-${program.id}`,
      },
      messages,
      methodVersion: PROGRAM_SKILLS_DETAILED_VERSION,
      // Empirical: gemini-3-flash-preview handles this prompt well (the
      // first SEQ-0062 run produced 2,522 output tokens cleanly). Switching
      // to gemini-2.5-flash counter-intuitively caps at ~627 output tokens
      // when the input is the full ~99K-token PDF — likely a context/output
      // ratio limit on the smaller model. Stick with the default preview.
      // Bumped 16000 → 50000 on 2026-05-13 — see program-digest/run.ts.
      maxOutputTokens: 50000,
    },
    ProgramSkillsDetailedSchema,
  );
  const extraction = response.parsed;

  // Resolve skill names: (a) direct nameEn/nameTh exact match against
  // Skill, (b) SkillAlias cache from program-digest source, (c) leave
  // unresolved for analyst review.
  const allSkills = await prisma.skill.findMany({ select: { id: true, nameEn: true, nameTh: true } });
  const byEn = new Map<string, string>();
  const byTh = new Map<string, string>();
  for (const s of allSkills) {
    if (s.nameEn) byEn.set(normName(s.nameEn), s.id);
    if (s.nameTh) byTh.set(normName(s.nameTh), s.id);
  }
  const aliasCandidates = extraction.skills.flatMap((s) => [s.nameEn, s.nameTh].filter(Boolean));
  const aliases = await lookupAliasesBulk(aliasCandidates, 'program_digest');

  // Compose ProgramSkill draft rows; dedupe by skillId (multiple
  // extracted variants may resolve to the same Skill row — keep MAX
  // weights across them).
  type Draft = {
    skillId: string;
    compulsoryWeight: number;
    electiveWeight: number;
    pickedFromPlo: boolean;
    evidenceQuote: string;
  };
  const draftBySkillId = new Map<string, Draft>();
  const unresolvedNames: string[] = [];

  for (const s of extraction.skills) {
    const enKey = normName(s.nameEn);
    const thKey = normName(s.nameTh);
    let skillId: string | undefined;
    if (enKey && byEn.has(enKey)) skillId = byEn.get(enKey)!;
    else if (thKey && byTh.has(thKey)) skillId = byTh.get(thKey)!;
    else if (enKey) {
      const a = aliases.get(enKey);
      if (a?.status === 'RESOLVED' && a.skillId) skillId = a.skillId;
    }
    if (!skillId && thKey) {
      const a = aliases.get(thKey);
      if (a?.status === 'RESOLVED' && a.skillId) skillId = a.skillId;
    }

    if (!skillId) {
      unresolvedNames.push(`${s.nameTh}${s.nameEn ? ` / ${s.nameEn}` : ''} (compulsory ${s.compulsoryContribution.toFixed(2)}, elective ${s.electiveContribution.toFixed(2)})`);
      continue;
    }
    const existing = draftBySkillId.get(skillId);
    if (!existing) {
      draftBySkillId.set(skillId, {
        skillId,
        compulsoryWeight: s.compulsoryContribution,
        electiveWeight: s.electiveContribution,
        pickedFromPlo: s.pickedFromPlo,
        evidenceQuote: s.evidenceQuote,
      });
    } else {
      // Multiple variants of the same skill — keep MAX weights, OR the
      // PLO flag, prefer non-empty evidence.
      existing.compulsoryWeight = Math.max(existing.compulsoryWeight, s.compulsoryContribution);
      existing.electiveWeight = Math.max(existing.electiveWeight, s.electiveContribution);
      existing.pickedFromPlo = existing.pickedFromPlo || s.pickedFromPlo;
      if (!existing.evidenceQuote && s.evidenceQuote) existing.evidenceQuote = s.evidenceQuote;
    }
  }

  // Replace ProgramSkill rows in a transaction
  await prisma.$transaction(async (tx) => {
    await tx.programSkill.deleteMany({ where: { programId: program.id } });
    for (const draft of draftBySkillId.values()) {
      // Composite weight: max(compulsory, elective × 0.5). Drives any
      // legacy code that reads `weight` directly.
      const composite = Math.max(draft.compulsoryWeight, draft.electiveWeight * 0.5);
      await tx.programSkill.create({
        data: {
          programId: program.id,
          skillId: draft.skillId,
          weight: composite,
          compulsoryWeight: draft.compulsoryWeight,
          electiveWeight: draft.electiveWeight,
          pickedFromPlo: draft.pickedFromPlo,
          evidenceQuote: draft.evidenceQuote || null,
        },
      });
    }
  });

  // Persist the full extraction
  const created = await prisma.aiExtraction.create({
    data: {
      sourceEntityType: 'program',
      sourceEntityId: program.id,
      extractionKind: 'PROGRAM_SKILLS_DETAILED',
      payloadJson: { ...extraction, unresolvedNames, resolvedCount: draftBySkillId.size } as object,
      confidence: response.confidence,
      methodVersion: PROGRAM_SKILLS_DETAILED_VERSION,
      aiInferenceId: response.aiInferenceId,
      reviewStatus: 'AUTO_APPROVED',
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
    skillsExtracted: extraction.skills.length,
    skillsResolvedToTaxonomy: draftBySkillId.size,
    skillsUnresolved: unresolvedNames.length,
    ploCount: extraction.programLearningOutcomes.length,
    compulsoryCourseCount: extraction.compulsoryCourseCount,
    electiveCourseCount: extraction.electiveCourseCount,
    programSkillRowsWritten: draftBySkillId.size,
    unresolvedNames,
  };
}
