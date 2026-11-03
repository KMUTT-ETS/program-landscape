/**
 * Tag skills into strategic sectors by keyword. Idempotent; never removes tags.
 * Usage: pnpm skills:tag-sectors
 */
import { prisma, tagSkillSectors } from '@kku/db';

tagSkillSectors(prisma)
  .then((r) => {
    // eslint-disable-next-line no-console
    console.log(`tag-skill-sectors: tagged ${r.tagged} skill-sector pairs`);
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
