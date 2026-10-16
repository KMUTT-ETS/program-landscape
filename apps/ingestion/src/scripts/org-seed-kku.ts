// Seeds Khon Kaen University's organisation profile — KKU's OWN deployment
// only, once, right after the white-label phase-1 migration. Never overwrites
// an existing profile: an admin's edits win. Other adopters do NOT run this;
// they fill in /admin/organization.
//
// The contact email for outbound User-Agents is carried over from the old
// env keys (INSTITUTION_CONTACT_EMAIL, else OPENALEX_MAILTO) on that one
// seed; afterwards it lives only in the profile.
//
// --check: no writes. Exit 0 when a profile exists, 3 when none — deploy.sh
// runs it on upgrades so a release never goes live unconfigured.
//
//   pnpm org:seed-kku [--check]
//   prod: docker compose exec ingestion node /app/dist/scripts/org-seed-kku.js [--check] </dev/null
import { loadOrganization, getOrganizationProfile, prisma, saveOrganizationIdentity } from '@kku/db';
import { ORG_SEED_CHECK_MISSING_EXIT, kkuSeedIdentity, parseOrgSeedArgs } from '../lib/org-seed-kku';

async function main(): Promise<void> {
  await loadOrganization();
  const args = parseOrgSeedArgs(process.argv.slice(2));
  const existing = await getOrganizationProfile();

  if (args.check) {
    if (existing) {
      console.log(`[org-seed-kku] --check: profile exists (${existing.nameEn}, version ${existing.version})`);
      return;
    }
    console.log('[org-seed-kku] --check: no organisation profile');
    process.exitCode = ORG_SEED_CHECK_MISSING_EXIT;
    return;
  }

  if (existing) {
    console.log(`[org-seed-kku] profile already exists (${existing.nameEn}, version ${existing.version}) — left unchanged`);
    return;
  }
  const identity = kkuSeedIdentity({
    INSTITUTION_CONTACT_EMAIL: process.env.INSTITUTION_CONTACT_EMAIL,
    OPENALEX_MAILTO: process.env.OPENALEX_MAILTO,
  });
  const row = await saveOrganizationIdentity(identity, 'org-seed-kku');
  // Never print the address itself.
  console.log(
    `[org-seed-kku] seeded ${row.nameEn} (version ${row.version}); contact email: ${row.contactEmail ? 'set' : 'not set'}`,
  );
}

main()
  .catch((err) => {
    console.error('[org-seed-kku] failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
