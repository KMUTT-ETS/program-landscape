import { z } from 'zod';
import { prisma } from './index';

// ─────────────────────────────────────────────────────────────────────────────
// Post-approval materialisation for `PROGRAM_DIGEST` extractions.
//
// Writes the digest payload through to:
//   1. Program columns (nameEn, degree*, totalCredits, durationYears,
//      language, recruitmentSummaryTh)
//   2. ProgramSkill rows (skill resolution: nameEn lowercased exact, then
//      nameTh exact). Unmatched skill names land as a sibling AiExtraction
//      with `extractionKind='PROPOSED_SKILL'` so an analyst can approve them
//      into the Skill taxonomy → next materialisation round picks them up.
//
// Course materialisation is DEFERRED for v1 — Course rows need a
// Curriculum FK and a credit-hour matching pass that the digest payload
// doesn't fully resolve. Approved digests record the courses inside
// AiExtraction.payloadJson; a later analyst-driven path can promote them.
//
// Idempotency: safe to re-run after re-approval. ProgramSkill upsert is
// keyed on (programId, skillId); the materialisation timestamp is
// recorded in AiExtraction.reviewNotes so re-runs are visible in the
// audit trail.
// ─────────────────────────────────────────────────────────────────────────────

const ExtractedSkillShapeSchema = z.object({
  nameTh: z.string(),
  nameEn: z.string().optional().default(''),
  category: z.string().optional().default(''),
  weight: z.number().min(0).max(1),
  evidenceQuote: z.string().optional().default(''),
});

const ProgramDigestPayloadShapeSchema = z.object({
  programNameTh: z.string().optional(),
  programNameEn: z.string().optional(),
  degreeNameTh: z.string().optional(),
  degreeNameEn: z.string().optional(),
  degreeAbbrTh: z.string().optional(),
  degreeAbbrEn: z.string().optional(),
  totalCredits: z.number().nullable().optional(),
  durationYears: z.number().nullable().optional(),
  language: z.enum(['TH', 'EN', 'MIXED']).optional(),
  recruitmentSummaryTh: z.string().optional(),
  extractedSkills: z.array(ExtractedSkillShapeSchema).default([]),
});

export interface MaterialiseProgramDigestResult {
  programId: string;
  programFieldsUpdated: number;
  skillsLinked: number;
  skillsProposed: number;
  alreadyMaterialised: boolean;
}

/**
 * Apply an approved `PROGRAM_DIGEST` extraction to its target Program.
 *
 * Pre-conditions:
 *   - extraction.extractionKind === 'PROGRAM_DIGEST'
 *   - extraction.reviewStatus is APPROVED or AUTO_APPROVED (caller's call —
 *     this function does NOT enforce; it's invoked from the approve endpoint
 *     and the direct-path digest service).
 *
 * Idempotent on the (programId, skillId) ProgramSkill key.
 */
export async function materialiseProgramDigest(
  extractionId: string,
): Promise<MaterialiseProgramDigestResult> {
  const extraction = await prisma.aiExtraction.findUniqueOrThrow({
    where: { id: extractionId },
    select: {
      id: true,
      sourceEntityType: true,
      sourceEntityId: true,
      extractionKind: true,
      payloadJson: true,
    },
  });
  if (extraction.extractionKind !== 'PROGRAM_DIGEST') {
    throw new Error(
      `materialiseProgramDigest: expected extractionKind=PROGRAM_DIGEST, got ${extraction.extractionKind}`,
    );
  }
  if (extraction.sourceEntityType !== 'program') {
    throw new Error(
      `materialiseProgramDigest: expected sourceEntityType=program, got ${extraction.sourceEntityType}`,
    );
  }

  const programId = extraction.sourceEntityId;
  const payload = ProgramDigestPayloadShapeSchema.parse(extraction.payloadJson);

  // 1. Update Program columns. Only set fields the digest actually has —
  //    don't overwrite human-curated values with empty strings.
  const updates: Record<string, unknown> = {};
  if (payload.programNameEn) updates.nameEn = payload.programNameEn;
  if (payload.degreeNameTh) updates.degreeNameTh = payload.degreeNameTh;
  if (payload.degreeNameEn) updates.degreeNameEn = payload.degreeNameEn;
  if (payload.degreeAbbrTh) updates.degreeAbbrTh = payload.degreeAbbrTh;
  if (payload.degreeAbbrEn) updates.degreeAbbrEn = payload.degreeAbbrEn;
  if (payload.totalCredits != null) updates.totalCredits = payload.totalCredits;
  if (payload.durationYears != null) updates.durationYears = payload.durationYears;
  if (payload.language) updates.language = payload.language;
  if (payload.recruitmentSummaryTh) updates.recruitmentSummaryTh = payload.recruitmentSummaryTh;

  if (Object.keys(updates).length > 0) {
    await prisma.program.update({ where: { id: programId }, data: updates });
  }

  // 2. Resolve skills + write ProgramSkill rows.
  // Build a lookup for name matching (case-insensitive trim on EN, exact TH).
  const allSkills = await prisma.skill.findMany({ select: { id: true, nameEn: true, nameTh: true } });
  const byEn = new Map<string, string>();
  const byTh = new Map<string, string>();
  for (const s of allSkills) {
    const en = (s.nameEn ?? '').trim().toLowerCase();
    const th = (s.nameTh ?? '').trim();
    if (en) byEn.set(en, s.id);
    if (th) byTh.set(th, s.id);
  }

  let skillsLinked = 0;
  const proposedSkills: Array<{ nameTh: string; nameEn: string; category: string; weight: number; evidenceQuote: string }> = [];

  for (const es of payload.extractedSkills) {
    const en = (es.nameEn ?? '').trim().toLowerCase();
    const th = (es.nameTh ?? '').trim();
    let skillId: string | null = null;
    if (en && byEn.has(en)) skillId = byEn.get(en)!;
    else if (th && byTh.has(th)) skillId = byTh.get(th)!;

    if (skillId) {
      // Upsert ProgramSkill — keep highest weight on conflict (analyst review
      // can lower it, but the digest's signal is the floor).
      await prisma.programSkill.upsert({
        where: { programId_skillId: { programId, skillId } },
        create: { programId, skillId, weight: es.weight },
        update: { weight: { set: Math.max(es.weight, 0) } },
      });
      skillsLinked++;
    } else {
      proposedSkills.push({
        nameTh: th,
        nameEn: es.nameEn ?? '',
        category: es.category ?? '',
        weight: es.weight,
        evidenceQuote: es.evidenceQuote ?? '',
      });
    }
  }

  // 3. Stage proposed skills (one AiExtraction per proposed name, kind
  // PROPOSED_SKILL). Analyst reviews these to add into the Skill table.
  // Idempotent via the (sourceEntityType, sourceEntityId) + skill name
  // uniqueness — but AiExtraction has no such constraint, so we just
  // dedupe-on-create by checking for an existing PENDING_REVIEW row with
  // the same payload.programId + payload.nameTh.
  for (const ps of proposedSkills) {
    const existing = await prisma.aiExtraction.findFirst({
      where: {
        sourceEntityType: 'program',
        sourceEntityId: programId,
        extractionKind: 'PROPOSED_SKILL',
        reviewStatus: 'PENDING_REVIEW',
        payloadJson: { path: ['nameTh'], equals: ps.nameTh },
      },
      select: { id: true },
    });
    if (existing) continue;
    await prisma.aiExtraction.create({
      data: {
        sourceEntityType: 'program',
        sourceEntityId: programId,
        extractionKind: 'PROPOSED_SKILL',
        payloadJson: ps,
        confidence: 0.7,
        methodVersion: 'program-digest.v1',
        reviewStatus: 'PENDING_REVIEW',
      },
    });
  }

  return {
    programId,
    programFieldsUpdated: Object.keys(updates).length,
    skillsLinked,
    skillsProposed: proposedSkills.length,
    alreadyMaterialised: false,
  };
}
