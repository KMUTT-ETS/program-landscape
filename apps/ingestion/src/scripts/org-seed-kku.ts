// Seeds Khon Kaen University's organisation profile — KKU's OWN deployment
// only, once, right after the white-label phase-1 migration. Never overwrites
// an existing profile: an admin's edits win. Other adopters do NOT run this;
// they fill in /admin/organization.
//
// The contact email for outbound User-Agents is carried over from the old
// env keys (INSTITUTION_CONTACT_EMAIL, else OPENALEX_MAILTO) on that one
// seed; afterwards it lives only in the profile.
//
// Brand: fills KKU's logos, favicon and colours into brand fields that are
// still empty (never overwrites), identity created or not.
//
// --check: no writes. Exit 0 when a profile exists, 3 when none — deploy.sh
// runs it on upgrades so a release never goes live unconfigured.
//
//   pnpm org:seed-kku [--check]
//   prod: docker compose exec ingestion node /app/dist/scripts/org-seed-kku.js [--check] </dev/null
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  loadOrganization,
  getOrganizationProfile,
  prisma,
  saveOrganizationBrand,
  saveOrganizationIdentity,
  setOrganizationAsset,
} from '@kku/db';
import { S3Storage, type BrandAssetKind } from '@kku/shared';
import { ORG_SEED_CHECK_MISSING_EXIT, kkuSeedIdentity, parseOrgSeedArgs } from '../lib/org-seed-kku';
import { fillKkuBrand } from '../lib/kku-brand';

// Source layout: apps/ingestion/assets/kku. Bundled in the image: /app/assets/kku
// (cwd is /app, the script runs from /app/dist/scripts).
function readKkuAsset(fileName: string): Buffer | null {
  const dirs = [
    path.resolve(__dirname, '..', '..', 'assets', 'kku'),
    path.resolve(process.cwd(), 'assets', 'kku'),
  ];
  for (const dir of dirs) {
    const file = path.join(dir, fileName);
    if (existsSync(file)) return readFileSync(file);
  }
  return null;
}

function brandStorage(): ((kind: BrandAssetKind, bytes: Buffer) => Promise<string>) | null {
  const endpoint = process.env.MINIO_ENDPOINT;
  if (!endpoint) return null;
  const storage = new S3Storage({
    endpoint,
    region: process.env.MINIO_REGION ?? 'us-east-1',
    accessKeyId: process.env.MINIO_ACCESS_KEY ?? '',
    secretAccessKey: process.env.MINIO_SECRET_KEY ?? '',
  });
  const bucket = process.env.MINIO_BUCKET_BRANDING ?? 'branding';
  return async (kind, bytes) => {
    await storage.ensureBucket(bucket);
    const key = `${kind}/${createHash('sha256').update(bytes).digest('hex')}.png`;
    await storage.putObject({ bucket, key, body: bytes, contentType: 'image/png' });
    return key;
  };
}

async function fillBrand(): Promise<void> {
  const row = await getOrganizationProfile();
  if (!row) return;
  await fillKkuBrand(row, {
    readFile: readKkuAsset,
    putObject: brandStorage(),
    setAsset: (kind, key) => setOrganizationAsset(kind, key, 'org-seed-kku'),
    saveColours: (input, tokens) => saveOrganizationBrand(input, tokens, 'org-seed-kku'),
    log: (line) => console.log(`[org-seed-kku] ${line}`),
  });
}

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
    console.log(`[org-seed-kku] profile already exists (${existing.nameEn}, version ${existing.version}) — identity left unchanged`);
    await fillBrand();
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
  await fillBrand();
}

main()
  .catch((err) => {
    console.error('[org-seed-kku] failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
