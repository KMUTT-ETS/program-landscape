// Pipeline phase 2, second half: make sure a programme's digest skills reach
// the programme.
//
// Skill matching is exact, and a fresh installation has an empty taxonomy, so
// the first digest of every programme leaves all its skills as
// PROPOSED_SKILL. Nothing in the product turned those into Skill rows except
// `pnpm skills:normalise`, a manual step that was followed by a paid
// re-digest. This does both in the run itself: build the taxonomy from the
// digest vocabulary, then re-materialise the SAME stored digest payload (no
// new AI digest call) so phases 3, 6 and 7 of the same run see the skills.
//
// Gate: PIPELINE_BUILD_SKILL_TAXONOMY, default on ("0" / "false" / "off"
// disables it). `pnpm skills:normalise` stays as the manual tool.

export interface EnsureSkillsDeps {
  /** Latest APPROVED / AUTO_APPROVED PROGRAM_DIGEST extraction for the programme. */
  findDigestExtractionId: (programId: string) => Promise<string | null>;
  /** Digest skill names matching neither the taxonomy nor a resolved alias. */
  countUnmatchedSkillNames: (extractionId: string) => Promise<number>;
  countProgramSkills: (programId: string) => Promise<number>;
  /** Re-applies a stored digest. Never calls the AI. */
  materialise: (extractionId: string) => Promise<{ skillsLinked: number; skillsProposed: number }>;
  /** `skills:normalise --source=program_digest --auto-promote` (confidence >= 0.9). */
  runNormaliser: () => Promise<{ matched: number; newProposed: number; failed: number }>;
}

export type EnsureSkillsStatus = 'disabled' | 'no-digest' | 'matched' | 'rematerialised' | 'rebuilt' | 'failed';

export interface EnsureSkillsResult {
  status: EnsureSkillsStatus;
  notes: string;
}

export function skillTaxonomyBuildEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.PIPELINE_BUILD_SKILL_TAXONOMY ?? '').trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(v);
}

export async function ensureProgramSkills(
  programId: string,
  deps: EnsureSkillsDeps,
  enabled: boolean = skillTaxonomyBuildEnabled(),
): Promise<EnsureSkillsResult> {
  if (!enabled) return { status: 'disabled', notes: 'skill taxonomy build disabled' };
  try {
    const extractionId = await deps.findDigestExtractionId(programId);
    if (!extractionId) return { status: 'no-digest', notes: 'no approved digest to apply' };

    const unmatched = await deps.countUnmatchedSkillNames(extractionId);
    if (unmatched === 0) {
      // Every name already resolves. If the digest was applied before the
      // taxonomy existed the programme still has no links; applying it again
      // costs nothing.
      if ((await deps.countProgramSkills(programId)) > 0) {
        return { status: 'matched', notes: 'digest skills already match the taxonomy' };
      }
      const r = await deps.materialise(extractionId);
      return { status: 'rematerialised', notes: `re-applied digest: ${r.skillsLinked} skills linked` };
    }

    const n = await deps.runNormaliser();
    const r = await deps.materialise(extractionId);
    return {
      status: 'rebuilt',
      notes:
        `built taxonomy from ${unmatched} unmatched names (matched ${n.matched}, new ${n.newProposed}, failed ${n.failed}); ` +
        `re-applied digest: ${r.skillsLinked} linked, ${r.skillsProposed} still unmatched`,
    };
  } catch (e) {
    return { status: 'failed', notes: `skill taxonomy build failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}
