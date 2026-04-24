#!/usr/bin/env node
// Pre-deploy Postgres snapshot.
//
// Runs `pg_dump --format=custom` against the current DATABASE_URL and
// uploads the result to MinIO at
// `db-backups/pre-deploy/<git-sha>-<iso-utc>.dump`. Meant to run as the
// first step of `scripts/deploy.sh` on the prod server — if the migration
// is later found to be destructive, this is the artefact we restore
// from. Retention policy: keep every pre-deploy snapshot for 30 days;
// the daily cron handles cold-storage archival (see docs/backup-dr.md).
//
// Uses only built-ins + Node's fetch — no extra deps. Reads env from the
// process (loaded by the caller).

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const REQUIRED_ENV = [
  'DATABASE_URL',
  'MINIO_ENDPOINT',
  'MINIO_ACCESS_KEY',
  'MINIO_SECRET_KEY',
  'MINIO_BUCKET_PDF_OUTPUT',
];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`[pre-deploy-snapshot] missing env var: ${key}`);
    process.exit(1);
  }
}

const BACKUP_BUCKET = process.env.MINIO_BUCKET_BACKUPS ?? 'db-backups';

function gitSha() {
  const r = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' });
  return (r.stdout?.trim() || 'nogit').slice(0, 10);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const sha = gitSha();
const key = `pre-deploy/${stamp}-${sha}.dump`;

const tmp = mkdtempSync(path.join(tmpdir(), 'kku-snap-'));
const dumpPath = path.join(tmp, 'db.dump');

console.log(`[pre-deploy-snapshot] running pg_dump → ${dumpPath}`);
const dump = spawnSync(
  'pg_dump',
  [
    '--format=custom',
    '--compress=9',
    '--no-owner',
    '--no-acl',
    '--file',
    dumpPath,
    process.env.DATABASE_URL,
  ],
  { stdio: 'inherit' },
);
if (dump.status !== 0) {
  console.error('[pre-deploy-snapshot] pg_dump failed');
  rmSync(tmp, { recursive: true, force: true });
  process.exit(dump.status ?? 1);
}
if (!existsSync(dumpPath)) {
  console.error('[pre-deploy-snapshot] dump file missing after pg_dump');
  process.exit(1);
}
const bytes = readFileSync(dumpPath);
console.log(`[pre-deploy-snapshot] dump size: ${(bytes.length / 1024 / 1024).toFixed(1)} MB`);

// Upload to MinIO using the AWS SDK resolved through @kku/shared.
const sharedPkgJson = '/home/denpong/projects/program-landscape/packages/shared/package.json';
const sharedRequire = createRequire(sharedPkgJson);
const { S3Client, PutObjectCommand, CreateBucketCommand } = sharedRequire('@aws-sdk/client-s3');

const client = new S3Client({
  endpoint: process.env.MINIO_ENDPOINT,
  region: process.env.MINIO_REGION ?? 'us-east-1',
  credentials: {
    accessKeyId: process.env.MINIO_ACCESS_KEY,
    secretAccessKey: process.env.MINIO_SECRET_KEY,
  },
  forcePathStyle: true,
});

// Ensure bucket exists — this script typically runs on a fresh prod box.
try {
  await client.send(new CreateBucketCommand({ Bucket: BACKUP_BUCKET }));
} catch (err) {
  const name = (err && err.name) || '';
  if (name !== 'BucketAlreadyOwnedByYou' && name !== 'BucketAlreadyExists') {
    console.error(`[pre-deploy-snapshot] bucket ensure failed: ${err?.message ?? err}`);
    // Continue — bucket may already exist and we lack ListBucket.
  }
}

console.log(`[pre-deploy-snapshot] uploading s3://${BACKUP_BUCKET}/${key}`);
await client.send(
  new PutObjectCommand({
    Bucket: BACKUP_BUCKET,
    Key: key,
    Body: bytes,
    ContentType: 'application/x-pgdump',
    Metadata: { gitSha: sha, takenAt: stamp },
  }),
);

rmSync(tmp, { recursive: true, force: true });
console.log(`[pre-deploy-snapshot] done — s3://${BACKUP_BUCKET}/${key}`);
