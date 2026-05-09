// Server-side helpers for the user avatar upload/serve routes.
//
// Wraps @aws-sdk/client-s3 directly (rather than reusing the @kku/shared
// S3Storage class) because we need GetObjectCommand → byte stream, and
// S3Storage only exposes putObject + signed-URL paths today.

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';

const BUCKET = process.env.MINIO_BUCKET_AVATARS ?? 'avatars';
let bucketEnsured = false;

function client(): S3Client {
  return new S3Client({
    endpoint: process.env.MINIO_ENDPOINT ?? 'http://localhost:9000',
    region: process.env.MINIO_REGION ?? 'us-east-1',
    credentials: {
      accessKeyId: process.env.MINIO_ACCESS_KEY ?? 'minio_dev',
      secretAccessKey: process.env.MINIO_SECRET_KEY ?? 'minio_dev_password',
    },
    forcePathStyle: true,
  });
}

/**
 * Idempotent bucket-create. MinIO PutObject does NOT auto-create the
 * bucket like some object stores; we head + create on first call.
 * Cached for the lifetime of the Node process.
 */
async function ensureBucket(c: S3Client): Promise<void> {
  if (bucketEnsured) return;
  try {
    await c.send(new HeadBucketCommand({ Bucket: BUCKET }));
    bucketEnsured = true;
    return;
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name !== 'NotFound' && name !== 'NoSuchBucket') throw err;
  }
  await c.send(new CreateBucketCommand({ Bucket: BUCKET }));
  bucketEnsured = true;
}

export function avatarKeyForUser(userId: string): string {
  // One key per user — overwrites on re-upload. Suffix is .jpg even
  // when the upload originated as PNG because we always re-encode the
  // crop to JPEG before storing (see /api/profile/avatar/route.ts).
  return `avatars/${userId}.jpg`;
}

export interface UploadResult {
  key: string;
  byteSize: number;
}

export async function uploadAvatar(
  userId: string,
  bytes: Buffer,
  contentType: string,
): Promise<UploadResult> {
  const c = client();
  await ensureBucket(c);
  const key = avatarKeyForUser(userId);
  await c.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: bytes,
      ContentType: contentType,
      // Tell browsers to cache for 1 hour; the URL carries a `?v=<ts>`
      // cache-buster so updates propagate immediately on the client.
      CacheControl: 'public, max-age=3600',
    }),
  );
  return { key, byteSize: bytes.byteLength };
}

export interface AvatarBytes {
  buffer: Buffer;
  contentType: string;
  byteSize: number;
}

export async function getAvatarBytes(userId: string): Promise<AvatarBytes | null> {
  const c = client();
  try {
    const result = await c.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: avatarKeyForUser(userId) }),
    );
    if (!result.Body) return null;
    // GetObjectCommand returns a Readable stream in Node; collect.
    const chunks: Buffer[] = [];
    for await (const chunk of result.Body as Readable) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return {
      buffer: Buffer.concat(chunks),
      contentType: result.ContentType ?? 'image/jpeg',
      byteSize: Number(result.ContentLength ?? 0),
    };
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === 'NoSuchKey' || name === 'NotFound') return null;
    throw err;
  }
}

export async function deleteAvatar(userId: string): Promise<void> {
  const c = client();
  try {
    await c.send(
      new DeleteObjectCommand({ Bucket: BUCKET, Key: avatarKeyForUser(userId) }),
    );
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === 'NoSuchKey' || name === 'NotFound') return;
    throw err;
  }
}
