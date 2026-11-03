import { lookupAliasesBulk, materialiseProgramDigest, prisma } from '@kku/db';
import type { AiService } from '@kku/shared';

import { openNormaliserLog, runSkillNormaliser } from './skill-normaliser-run';
import type { EnsureSkillsDeps } from './ensure-skill-taxonomy';

interface DigestSkillShape {
  extractedSkills?: Array<{ nameEn?: string | null; nameTh?: string | null }>;
}

/** Real dependencies for ensureProgramSkills; the tests substitute fakes. */
export function realEnsureSkillsDeps(ai: AiService): EnsureSkillsDeps {
  return {
    findDigestExtractionId: async (programId) => {
      const row = await prisma.aiExtraction.findFirst({
        where: {
          extractionKind: 'PROGRAM_DIGEST',
          sourceEntityType: 'program',
          sourceEntityId: programId,
          reviewStatus: { in: ['APPROVED', 'AUTO_APPROVED'] },
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      return row?.id ?? null;
    },
    countUnmatchedSkillNames: async (extractionId) => {
      const row = await prisma.aiExtraction.findUniqueOrThrow({
        where: { id: extractionId },
        select: { payloadJson: true },
      });
      const skills = (row.payloadJson as DigestSkillShape).extractedSkills ?? [];
      const taxonomy = await prisma.skill.findMany({ select: { nameEn: true, nameTh: true } });
      const en = new Set(taxonomy.map((s) => (s.nameEn ?? '').trim().toLowerCase()).filter(Boolean));
      const th = new Set(taxonomy.map((s) => (s.nameTh ?? '').trim()).filter(Boolean));
      const aliases = await lookupAliasesBulk(
        skills.flatMap((s) => [s.nameEn ?? '', s.nameTh ?? ''].filter(Boolean)),
        'program_digest',
      );
      const resolved = (name: string): boolean => {
        const a = aliases.get(name.toLowerCase());
        return a?.status === 'RESOLVED' && Boolean(a.skillId);
      };
      let unmatched = 0;
      for (const s of skills) {
        const e = (s.nameEn ?? '').trim().toLowerCase();
        const t = (s.nameTh ?? '').trim();
        const hit = (e && (en.has(e) || resolved(e))) || (t && (th.has(t) || resolved(t)));
        if (!hit) unmatched += 1;
      }
      return unmatched;
    },
    countProgramSkills: (programId) => prisma.programSkill.count({ where: { programId } }),
    materialise: async (id) => {
      const r = await materialiseProgramDigest(id);
      return { skillsLinked: r.skillsLinked, skillsProposed: r.skillsProposed };
    },
    runNormaliser: async () => {
      const t = await runSkillNormaliser(
        ai,
        { source: 'program_digest', limit: null, batchSize: 25, dryRun: false, autoPromote: true },
        openNormaliserLog(),
      );
      return { matched: t.matched, newProposed: t.newProposed, failed: t.failed };
    },
  };
}
