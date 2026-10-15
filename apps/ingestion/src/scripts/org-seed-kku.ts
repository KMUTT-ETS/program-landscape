// Seeds Khon Kaen University's organisation profile — KKU's OWN deployment
// only, once, right after the white-label phase-1 migration. Never overwrites
// an existing profile: an admin's edits win. Other adopters do NOT run this;
// they fill in /admin/organization.
//
//   pnpm org:seed-kku
//   prod: docker compose exec ingestion node /app/dist/scripts/org-seed-kku.js </dev/null
import { loadOrganization, getOrganizationProfile, prisma, saveOrganizationIdentity } from '@kku/db';
import { KKU_REFERENCE_ORGANIZATION } from '@kku/shared';

async function main(): Promise<void> {
  await loadOrganization();
  const existing = await getOrganizationProfile();
  if (existing) {
    console.log(`[org-seed-kku] profile already exists (${existing.nameEn}, version ${existing.version}) — left unchanged`);
    return;
  }
  const row = await saveOrganizationIdentity({ ...KKU_REFERENCE_ORGANIZATION, expectedVersion: null }, 'org-seed-kku');
  console.log(`[org-seed-kku] seeded ${row.nameEn} (version ${row.version})`);
}

main()
  .catch((err) => {
    console.error('[org-seed-kku] failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
