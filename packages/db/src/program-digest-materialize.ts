import { z } from 'zod';
import { prisma } from './index';
import { lookupAliasesBulk } from './skill-normaliser';

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
  /** Subset of skillsLinked: links resolved via the SkillAlias cache
   *  (i.e., a prior AI normalisation or analyst-curated mapping). The
   *  remainder came from direct nameEn/nameTh exact match on Skill. */
  skillsLinkedViaAlias: number;
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
  // Resolution order:
  //   (a) Case-insensitive trim exact match on Skill.nameEn → nameTh
  //   (b) SkillAlias cache (source='program_digest') — picks up prior
  //       AI-normalised mappings from earlier digests
  //   (c) Unmatched → queued as PROPOSED_SKILL AiExtraction
  //
  // The SkillAlias cache means re-digests of the same program don't
  // re-emit PROPOSED_SKILL extractions for skill names already resolved
  // through the analyst-or-AI normalisation path.
  const allSkills = await prisma.skill.findMany({ select: { id: true, nameEn: true, nameTh: true } });
  const byEn = new Map<string, string>();
  const byTh = new Map<string, string>();
  for (const s of allSkills) {
    const en = (s.nameEn ?? '').trim().toLowerCase();
    const th = (s.nameTh ?? '').trim();
    if (en) byEn.set(en, s.id);
    if (th) byTh.set(th, s.id);
  }

  // Bulk-fetch any existing aliases for the names this digest emits, so
  // we don't round-trip per skill.
  const aliasCandidates = payload.extractedSkills.flatMap((es) => [es.nameEn ?? '', es.nameTh ?? ''].filter(Boolean));
  const aliases = await lookupAliasesBulk(aliasCandidates, 'program_digest');

  let skillsLinked = 0;
  let skillsViaAlias = 0;
  const proposedSkills: Array<{ nameTh: string; nameEn: string; category: string; weight: number; evidenceQuote: string }> = [];

  for (const es of payload.extractedSkills) {
    const en = (es.nameEn ?? '').trim().toLowerCase();
    const th = (es.nameTh ?? '').trim();
    let skillId: string | null = null;

    // (a) Direct taxonomy hit
    if (en && byEn.has(en)) skillId = byEn.get(en)!;
    else if (th && byTh.has(th)) skillId = byTh.get(th)!;

    // (b) SkillAlias cache — only when status=RESOLVED (skip AMBIGUOUS, REJECTED, NEW_PROPOSED)
    if (!skillId && en) {
      const a = aliases.get(en);
      if (a?.status === 'RESOLVED' && a.skillId) {
        skillId = a.skillId;
        skillsViaAlias++;
      }
    }
    if (!skillId && th) {
      const a = aliases.get(th.toLowerCase());
      if (a?.status === 'RESOLVED' && a.skillId) {
        skillId = a.skillId;
        skillsViaAlias++;
      }
    }

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
  // dedupe-on-create by checking for an existing row with the same
  // payload.programId + payload.nameTh.
  //
  // Auto-approve gate: respects AI_AUTO_APPROVE_THRESHOLD (default 0)
  // — when met, PROPOSED_SKILL rows land AUTO_APPROVED so they don't
  // pile up in the review queue. Note this only flips the AiExtraction
  // status; the analyst-driven Skill-row promotion via
  // `pnpm skills:normalise --auto-promote` still applies. Set the env
  // to a confidence floor to bring back the review gate.
  const autoApproveThreshold = Number(process.env.AI_AUTO_APPROVE_THRESHOLD ?? 0);
  const proposedConfidence = 0.7;
  const proposedAutoApprove = proposedConfidence >= autoApproveThreshold;
  for (const ps of proposedSkills) {
    // Dedupe against existing rows in EITHER review status — a previous
    // run may have already created an AUTO_APPROVED row for this
    // (programId, nameTh) pair and we don't want to re-create it under
    // a different status.
    const existing = await prisma.aiExtraction.findFirst({
      where: {
        sourceEntityType: 'program',
        sourceEntityId: programId,
        extractionKind: 'PROPOSED_SKILL',
        reviewStatus: { in: ['PENDING_REVIEW', 'AUTO_APPROVED', 'APPROVED'] },
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
        confidence: proposedConfidence,
        methodVersion: 'program-digest.v1',
        reviewStatus: proposedAutoApprove ? 'AUTO_APPROVED' : 'PENDING_REVIEW',
      },
    });
  }

  return {
    programId,
    programFieldsUpdated: Object.keys(updates).length,
    skillsLinked,
    skillsLinkedViaAlias: skillsViaAlias,
    skillsProposed: proposedSkills.length,
    alreadyMaterialised: false,
  };
}
