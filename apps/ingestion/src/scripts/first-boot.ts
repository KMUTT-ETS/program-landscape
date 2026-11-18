// ─────────────────────────────────────────────────────────────────────────────
// first-boot — the parts of `pnpm setup` that a container-only install needs
// after `prisma migrate deploy` and `sync-data-sources --apply`:
//
//   1. create the MinIO buckets the app writes to (`pnpm minio:init` on dev)
//   2. load the generic reference seed (`pnpm db:seed:reference` on dev)
//
// Used by docker-compose.workshop.yml, where participants who do not code run
// the whole app from images and never install the workspace. Bundled into
// /app/dist/scripts/first-boot.js (see bundle-pipeline-scripts.ts) because the
// image has no pnpm and plain node cannot load the workspace TypeScript.
//
// Idempotent: existing buckets are left alone and the reference seed is
// create-if-missing, so it is safe on every start.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma, seedReference } from '@kku/db';
import { S3Storage } from '@kku/shared';

const BUCKETS = [
  process.env.MINIO_BUCKET_PDF_RAW ?? 'pdf-raw',
  process.env.MINIO_BUCKET_PDF_OUTPUT ?? 'pdf-output',
  process.env.MINIO_BUCKET_CSV_UPLOADS ?? 'csv-uploads',
  process.env.MINIO_BUCKET_AVATARS ?? 'avatars',
  process.env.MINIO_BUCKET_BRANDING ?? 'branding',
];

async function ensureBuckets(): Promise<void> {
  const endpoint = process.env.MINIO_ENDPOINT;
  if (!endpoint) throw new Error('MINIO_ENDPOINT is not set');
  const storage = new S3Storage({
    endpoint,
    region: process.env.MINIO_REGION ?? 'us-east-1',
    accessKeyId: process.env.MINIO_ACCESS_KEY ?? process.env.MINIO_ROOT_USER ?? '',
    secretAccessKey: process.env.MINIO_SECRET_KEY ?? process.env.MINIO_ROOT_PASSWORD ?? '',
  });
  for (const bucket of BUCKETS) {
    await storage.ensureBucket(bucket);
    console.log(`[first-boot] bucket ${bucket} ready`);
  }
}

async function main(): Promise<void> {
  await ensureBuckets();
  const result = await seedReference(prisma);
  console.log(`[first-boot] reference seed: ${JSON.stringify(result)}`);
}

main()
  .catch((err: unknown) => {
    console.error('[first-boot] failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
