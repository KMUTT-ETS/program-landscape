#!/usr/bin/env node
// Create the MinIO buckets the app expects, if they don't already exist.
//
// WHY: `docker compose up minio` brings up an empty MinIO — no buckets.
// The API's putObject then fails with "The specified bucket does not
// exist" on the first PDF upload. We used to fix this by hand (`mc mb …`
// inside the container); this script makes `pnpm setup` handle it.
//
// Safe to re-run: "bucket already owned by you" / "bucket already
// exists" errors are swallowed.

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Minimal .env reader — we can't `import 'dotenv'` at the repo root
// because there's no root-level node_modules entry for it. The script
// runs before pnpm install in some workflows, so stay dependency-free.
function loadEnv(envPath) {
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnv(path.join(root, '.env'));

const endpoint = process.env.MINIO_ENDPOINT ?? 'http://localhost:9000';
const region = process.env.MINIO_REGION ?? 'us-east-1';
const accessKeyId = process.env.MINIO_ACCESS_KEY ?? process.env.MINIO_ROOT_USER;
const secretAccessKey =
  process.env.MINIO_SECRET_KEY ?? process.env.MINIO_ROOT_PASSWORD;

if (!accessKeyId || !secretAccessKey) {
  console.error(
    '[minio-init] MINIO credentials missing. Set MINIO_ACCESS_KEY + MINIO_SECRET_KEY (or MINIO_ROOT_USER + MINIO_ROOT_PASSWORD) in .env',
  );
  process.exit(1);
}

const buckets = [
  process.env.MINIO_BUCKET_PDF_RAW ?? 'pdf-raw',
  process.env.MINIO_BUCKET_PDF_OUTPUT ?? 'pdf-output',
];

// Load @aws-sdk/client-s3 from the shared package's node_modules. Using
// createRequire with the shared/package.json as the base so resolution
// is deterministic in a pnpm workspace.
const require_ = createRequire(
  path.join(root, 'packages/shared/package.json'),
);
let S3Client, CreateBucketCommand, HeadBucketCommand;
try {
  ({ S3Client, CreateBucketCommand, HeadBucketCommand } = require_(
    '@aws-sdk/client-s3',
  ));
} catch (err) {
  console.error(
    '[minio-init] @aws-sdk/client-s3 not resolvable. Run `pnpm install` first.',
    err?.message ?? err,
  );
  process.exit(1);
}

const client = new S3Client({
  endpoint,
  region,
  credentials: { accessKeyId, secretAccessKey },
  forcePathStyle: true,
});

// `pnpm db:up` returns as soon as the container is starting, not when
// healthy. Wait up to ~30s for MinIO to accept connections before
// giving up. We probe by trying to HEAD a known-missing bucket — the
// transport error (ECONNREFUSED) tells us to retry; a 404 means we
// reached the server successfully.
async function waitForMinIO() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      await client.send(new HeadBucketCommand({ Bucket: '__probe__' }));
      return;
    } catch (err) {
      if (err?.$metadata?.httpStatusCode !== undefined) return; // server responded
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error(`[minio-init] MinIO not reachable at ${endpoint} after 30s`);
}

try {
  await waitForMinIO();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

let hadFailure = false;
for (const bucket of buckets) {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    console.log(`[minio-init] ${bucket} exists`);
    continue;
  } catch (err) {
    const name = err?.name ?? err?.Code ?? '';
    // "NotFound" / "404" → bucket missing, proceed to create.
    // Anything else (network / auth) → surface it.
    if (!['NotFound', 'NoSuchBucket'].includes(name) && err?.$metadata?.httpStatusCode !== 404) {
      console.error(`[minio-init] HEAD ${bucket} failed:`, name || err?.message);
      hadFailure = true;
      continue;
    }
  }

  try {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    console.log(`[minio-init] ${bucket} created`);
  } catch (err) {
    const name = err?.name ?? err?.Code ?? '';
    if (['BucketAlreadyOwnedByYou', 'BucketAlreadyExists'].includes(name)) {
      console.log(`[minio-init] ${bucket} already exists (race)`);
      continue;
    }
    console.error(`[minio-init] CREATE ${bucket} failed:`, name || err?.message);
    hadFailure = true;
  }
}

process.exit(hadFailure ? 1 : 0);
