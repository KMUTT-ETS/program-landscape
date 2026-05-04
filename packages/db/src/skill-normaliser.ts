import { prisma } from './index';

// ─────────────────────────────────────────────────────────────────────────────
// Skill-name normaliser — pure data-access layer for SkillAlias-backed
// resolution of free-text skill names.
//
// Three operations callers need:
//   1. lookupAlias(rawName, sourceContext) → existing alias decision (cache hit)
//   2. recordAliasDecision(...)            → write a new alias row (cache miss)
//   3. promoteNewProposedToSkill(aliasId)  → analyst approves → creates Skill
//
// The actual AI batching lives in apps/ingestion (it has the AI service
// and the queue). This file is the storage + lookup contract.
// ─────────────────────────────────────────────────────────────────────────────

export type SkillAliasSourceContext =
  | 'linkedin'         // LinkedIn data via MHESI/KMITL feed
  | 'program_digest'   // PROGRAM_DIGEST AI extractor
  | 'job_posting'      // JobThai/JobsDB ingestion
  | 'course_skill'     // course-description AI extraction
  | 'manual';

export interface AliasDecisionInput {
  rawName: string;
  sourceContext: SkillAliasSourceContext;
  decision: 'MATCH' | 'NEW_PROPOSED' | 'AMBIGUOUS';
  resolvedSkillId?: string | null;
  newNameEn?: string | null;
  newNameTh?: string | null;
  newCategory?: string | null;
  confidence?: number | null;
  reasoning?: string | null;
  method?: string;
  methodVersion?: string;
  aiInferenceId?: string | null;
}

/**
 * Look up an existing alias decision. Returns null when not yet processed.
 * Idempotent — safe to call from hot paths (every connector load row).
 */
export async function lookupAlias(
  rawName: string,
  sourceContext: SkillAliasSourceContext,
): Promise<{ skillId: string | null; status: string } | null> {
  const lower = rawName.trim().toLowerCase();
  if (!lower) return null;
  const alias = await prisma.skillAlias.findUnique({
    where: { rawNameLower_sourceContext: { rawNameLower: lower, sourceContext } },
    select: { resolvedSkillId: true, status: true },
  });
  if (!alias) return null;
  return { skillId: alias.resolvedSkillId, status: alias.status };
}

/**
 * Bulk lookup — used by the connector load phase to avoid one round-trip
 * per row. Returns a Map<rawNameLower, { skillId, status }>.
 */
export async function lookupAliasesBulk(
  rawNames: ReadonlyArray<string>,
  sourceContext: SkillAliasSourceContext,
): Promise<Map<string, { skillId: string | null; status: string }>> {
  const lowered = [...new Set(rawNames.map((n) => n.trim().toLowerCase()).filter(Boolean))];
  if (lowered.length === 0) return new Map();
  const rows = await prisma.skillAlias.findMany({
    where: { sourceContext, rawNameLower: { in: lowered } },
    select: { rawNameLower: true, resolvedSkillId: true, status: true },
  });
  return new Map(rows.map((r) => [r.rawNameLower, { skillId: r.resolvedSkillId, status: r.status }]));
}

/**
 * Persist an alias decision. Idempotent: re-emitting for the same
 * (rawName, sourceContext) updates the existing row rather than throwing
 * on the unique constraint.
 *
 * REJECTED rows are NOT overwritten by automated runs — analyst review is
 * authoritative once status=REJECTED.
 */
export async function recordAliasDecision(input: AliasDecisionInput): Promise<{ id: string; created: boolean }> {
  const lower = input.rawName.trim().toLowerCase();
  if (!lower) throw new Error('recordAliasDecision: empty rawName');

  const existing = await prisma.skillAlias.findUnique({
    where: { rawNameLower_sourceContext: { rawNameLower: lower, sourceContext: input.sourceContext } },
    select: { id: true, status: true },
  });

  if (existing && existing.status === 'REJECTED') {
    // Analyst said no — leave it alone. Caller can detect via the lookup
    // returning status=REJECTED and route to a different code path.
    return { id: existing.id, created: false };
  }

  const data = {
    rawName: input.rawName,
    rawNameLower: lower,
    sourceContext: input.sourceContext,
    status:
      input.decision === 'MATCH'
        ? 'RESOLVED'
        : input.decision === 'NEW_PROPOSED'
          ? 'NEW_PROPOSED'
          : 'AMBIGUOUS',
    resolvedSkillId: input.resolvedSkillId ?? null,
    newNameEn: input.newNameEn ?? null,
    newNameTh: input.newNameTh ?? null,
    newCategory: input.newCategory ?? null,
    confidence: input.confidence ?? null,
    reasoning: input.reasoning ?? null,
    method: input.method ?? 'ai_normaliser',
    methodVersion: input.methodVersion ?? 'skill-name-normaliser.v1',
    aiInferenceId: input.aiInferenceId ?? null,
  } as const;

  if (existing) {
    await prisma.skillAlias.update({ where: { id: existing.id }, data });
    return { id: existing.id, created: false };
  }
  const created = await prisma.skillAlias.create({ data });
  return { id: created.id, created: true };
}

/**
 * Analyst approval path: promote a NEW_PROPOSED alias into a real Skill
 * row, then flip the alias to RESOLVED with `resolvedSkillId` pointing at
 * the new Skill. Subsequent ingestion runs hit the cache + use the new
 * Skill id.
 *
 * `code` is the new skill's stable identifier. Convention: kebab-cased
 * canonical English name, prefixed with `linkedin-` or similar to avoid
 * collisions with seeded ESCO codes.
 */
export async function promoteNewProposedToSkill(
  aliasId: string,
  args: { code: string; reviewerUserId: string; reviewNotes?: string },
): Promise<{ skillId: string; aliasId: string }> {
  return prisma.$transaction(async (tx) => {
    const alias = await tx.skillAlias.findUniqueOrThrow({
      where: { id: aliasId },
      select: {
        id: true,
        status: true,
        newNameEn: true,
        newNameTh: true,
        newCategory: true,
        sourceContext: true,
      },
    });
    if (alias.status !== 'NEW_PROPOSED') {
      throw new Error(`promoteNewProposedToSkill: alias is not NEW_PROPOSED (status=${alias.status})`);
    }
    if (!alias.newNameEn || !alias.newNameTh) {
      throw new Error('promoteNewProposedToSkill: alias missing canonical names');
    }
    const skill = await tx.skill.create({
      data: {
        code: args.code,
        nameEn: alias.newNameEn,
        nameTh: alias.newNameTh,
        category: alias.newCategory ?? null,
        // Skills materialised from external sources via the AI normaliser
        // are tagged 'KKU' to distinguish them from seeded ESCO/Lightcast
        // entries — they live in our own taxonomy namespace.
        taxonomySource: 'KKU',
      },
      select: { id: true },
    });
    await tx.skillAlias.update({
      where: { id: alias.id },
      data: {
        status: 'RESOLVED',
        resolvedSkillId: skill.id,
        reviewedByUserId: args.reviewerUserId,
        reviewedAt: new Date(),
        reviewNotes: args.reviewNotes ?? null,
      },
    });
    return { skillId: skill.id, aliasId: alias.id };
  });
}

/**
 * Re-link KmitlCareerSkillDemand + KmitlSkillGrowth + ProgramSkill rows
 * after new alias decisions land. This is what makes the next sync
 * benefit from a backfill: rows that previously had skill_id=NULL get
 * filled in.
 *
 * Returns counts of rows updated per table.
 */
export async function relinkUsingAliases(
  sourceContext: SkillAliasSourceContext,
): Promise<{ kmitlDemand: number; kmitlGrowth: number; programSkill: number }> {
  if (sourceContext === 'linkedin') {
    // Update KmitlCareerSkillDemand rows where skill_id IS NULL but the
    // raw skill name now has a RESOLVED alias.
    const demandResult = await prisma.$executeRaw`
      UPDATE kmitl_career_skill_demands d
      SET skill_id = a.resolved_skill_id
      FROM skill_aliases a
      WHERE d.skill_id IS NULL
        AND a.source_context = 'linkedin'
        AND a.status = 'RESOLVED'
        AND a.resolved_skill_id IS NOT NULL
        AND LOWER(TRIM(d.skill_name_raw)) = a.raw_name_lower
    `;
    const growthResult = await prisma.$executeRaw`
      UPDATE kmitl_skill_growths g
      SET skill_id = a.resolved_skill_id
      FROM skill_aliases a
      WHERE g.skill_id IS NULL
        AND a.source_context = 'linkedin'
        AND a.status = 'RESOLVED'
        AND a.resolved_skill_id IS NOT NULL
        AND LOWER(TRIM(g.skill_name_raw)) = a.raw_name_lower
    `;
    return { kmitlDemand: Number(demandResult), kmitlGrowth: Number(growthResult), programSkill: 0 };
  }

  // For program_digest source, the unmatched names live in PROPOSED_SKILL
  // AiExtraction rows. Materialisation is the right place to consume
  // those — see materialiseProgramDigest's alias-aware path.
  return { kmitlDemand: 0, kmitlGrowth: 0, programSkill: 0 };
}
