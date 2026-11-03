/**
 * Tag skills into strategic sectors by keyword. Idempotent; never removes tags.
 * Usage: pnpm skills:tag-sectors
 */
import { loadOrganization, prisma, tagSkillSectors } from '@kku/db';

async function main(): Promise<void> {
  await loadOrganization();
  try {
    const r = await tagSkillSectors(prisma);
    // eslint-disable-next-line no-console
    console.log(`tag-skill-sectors: ensured ${r.ensured} skill-sector pairs (existing tags are left as they are)`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
