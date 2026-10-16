// Read-only MinIO access for organisation brand assets (logos, favicon).
// Same client set-up as avatar-storage.ts. Never throws: any failure reads
// as "no asset" so /brand/* falls back to the built-in product mark — and so
// does an install whose MinIO env (endpoint, access key, secret) is unset.

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';

const BUCKET = process.env.MINIO_BUCKET_BRANDING ?? 'branding';

/** Null when MinIO is not configured — no hard-coded dev credentials as a fallback. */
function client(): S3Client | null {
  const endpoint = process.env.MINIO_ENDPOINT;
  const accessKeyId = process.env.MINIO_ACCESS_KEY;
  const secretAccessKey = process.env.MINIO_SECRET_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) return null;
  return new S3Client({
    endpoint,
    region: process.env.MINIO_REGION ?? 'us-east-1',
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
}

export async function readBrandAsset(
  key: string,
): Promise<{ bytes: Buffer; contentType: string } | null> {
  const s3 = client();
  if (!s3) return null;
  try {
    const result = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    if (!result.Body) return null;
    const chunks: Buffer[] = [];
    for await (const chunk of result.Body as Readable) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return {
      bytes: Buffer.concat(chunks),
      contentType: key.toLowerCase().endsWith('.svg') ? 'image/svg+xml' : 'image/png',
    };
  } catch {
    return null;
  }
}
