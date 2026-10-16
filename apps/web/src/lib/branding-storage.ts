// Read-only MinIO access for organisation brand assets (logos, favicon).
// Same client set-up as avatar-storage.ts. Never throws: any failure reads
// as "no asset" so /brand/* falls back to the built-in product mark.

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';

const BUCKET = process.env.MINIO_BUCKET_BRANDING ?? 'branding';

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

export async function readBrandAsset(
  key: string,
): Promise<{ bytes: Buffer; contentType: string } | null> {
  try {
    const result = await client().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
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
