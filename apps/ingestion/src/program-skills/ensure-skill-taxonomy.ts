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
  /**
   * For THIS programme only: promotes its earlier NEW_PROPOSED decisions at
   * confidence >= 0.9, then runs `skills:normalise --source=program_digest
   * --auto-promote` over its own PROPOSED_SKILL names.
   */
  runNormaliser: (programId: string) => Promise<{ promoted: number; matched: number; newProposed: number; failed: number; costUsd: number }>;
}

export type EnsureSkillsStatus = 'disabled' | 'no-digest' | 'matched' | 'rematerialised' | 'rebuilt' | 'failed';

export interface EnsureSkillsResult {
  status: EnsureSkillsStatus;
  notes: string;
  /** AI spend of the normaliser, USD (0 when it did not run). */
  costUsd: number;
}

export function skillTaxonomyBuildEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.PIPELINE_BUILD_SKILL_TAXONOMY ?? '').trim().toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(v);
}

export async function ensureProgramSkills(
  programId: string,
  deps: EnsureSkillsDeps,
  enabled: boolean = skillTaxonomyBuildEnabled(),
  log: (line: string) => void = (l) => console.log(l),
): Promise<EnsureSkillsResult> {
  const done = (status: EnsureSkillsStatus, notes: string, costUsd = 0): EnsureSkillsResult => ({ status, notes, costUsd });
  if (!enabled) return done('disabled', 'skill taxonomy build disabled');
  try {
    // A programme that already has skills (every install that has run a
    // digest against a taxonomy, KKU's included) is left completely alone:
    // no taxonomy load, no normaliser, no other programme touched.
    if ((await deps.countProgramSkills(programId)) > 0) {
      return done('matched', 'programme already has skills');
    }
    const extractionId = await deps.findDigestExtractionId(programId);
    if (!extractionId) return done('no-digest', 'no approved digest to apply');

    const unmatched = await deps.countUnmatchedSkillNames(extractionId);
    if (unmatched === 0) {
      // Every name already resolves but nothing was linked: the digest was
      // applied before the taxonomy existed. Applying it again costs nothing.
      const r = await deps.materialise(extractionId);
      return done('rematerialised', `re-applied digest: ${r.skillsLinked} skills linked`);
    }

    const n = await deps.runNormaliser(programId);
    const r = await deps.materialise(extractionId);
    if (r.skillsLinked === 0) {
      log(
        `[phase2] ${programId}: skill names still unmatched after one normaliser pass ` +
          `(${r.skillsProposed} names). It will be retried on later runs while it has 0 skills.`,
      );
    }
    return done(
      'rebuilt',
      `built taxonomy from ${unmatched} unmatched names (promoted ${n.promoted}, matched ${n.matched}, new ${n.newProposed}, failed ${n.failed}); ` +
        `re-applied digest: ${r.skillsLinked} linked, ${r.skillsProposed} still unmatched`,
      n.costUsd,
    );
  } catch (e) {
    return done('failed', `skill taxonomy build failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
