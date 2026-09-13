import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type {
  ObjectStorage,
  PutObjectRequest,
  PutObjectResult,
  SignedUrlRequest,
} from './types';

/**
 * S3 user metadata travels as HTTP headers (`x-amz-meta-*`), and Node's HTTP
 * client rejects any header value outside latin-1 with
 * `ERR_INVALID_CHAR: Invalid character in header content` — BEFORE the request
 * is even sent. Thai originalFilename values hit exactly this once the
 * multipart-UTF-8 filename fix started delivering real Thai strings (found
 * 2026-07-09: every net-new PDF upload with a Thai filename 500'd).
 * URI-encode any value with non-ASCII content; plain-ASCII values pass
 * through untouched so existing metadata (hashes, ids, 'anonymous') is
 * unchanged. Readers that need the original text should decodeURIComponent.
 */
export function sanitizeMetadata(metadata: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(metadata)) {
    out[k] = /^[\x20-\x7e]*$/.test(v) ? v : encodeURIComponent(v);
  }
  return out;
}

export interface S3StorageConfig {
  endpoint: string;           // http://localhost:9000 in dev, http://minio:9000 in compose
  region: string;             // any value works for MinIO; must be non-empty for the SDK
  accessKeyId: string;
  secretAccessKey: string;
  // If set, signed URLs are rewritten to use this host. MinIO is often
  // reachable by a different hostname from the server (docker network)
  // vs. the browser (public host).
  publicEndpoint?: string;
}

// S3/MinIO object storage. `forcePathStyle: true` is required for MinIO.
export class S3Storage implements ObjectStorage {
  private readonly client: S3Client;

  constructor(private readonly config: S3StorageConfig) {
    const s3Config: S3ClientConfig = {
      endpoint: config.endpoint,
      region: config.region || 'us-east-1',
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      // MinIO does not support virtual-hosted-style addressing without
      // extra wildcard DNS — path-style is universal.
      forcePathStyle: true,
    };
    this.client = new S3Client(s3Config);
  }

  async putObject(req: PutObjectRequest): Promise<PutObjectResult> {
    const result = await this.client.send(
      new PutObjectCommand({
        Bucket: req.bucket,
        Key: req.key,
        Body: req.body,
        ContentType: req.contentType,
        Metadata: req.metadata ? sanitizeMetadata(req.metadata) : undefined,
      }),
    );
    return {
      bucket: req.bucket,
      key: req.key,
      etag: result.ETag,
      byteSize: req.body.byteLength,
    };
  }

  async getSignedDownloadUrl(req: SignedUrlRequest): Promise<string> {
    const publicEndpoint = req.publicEndpointOverride ?? this.config.publicEndpoint;
    // When we need a public-facing URL, sign against a client configured
    // with the public endpoint — otherwise the signature is computed for
    // the internal hostname and fails browser validation.
    const signingClient = publicEndpoint
      ? new S3Client({
          endpoint: publicEndpoint,
          region: this.config.region || 'us-east-1',
          credentials: {
            accessKeyId: this.config.accessKeyId,
            secretAccessKey: this.config.secretAccessKey,
          },
          forcePathStyle: true,
        })
      : this.client;

    return getSignedUrl(
      signingClient,
      new GetObjectCommand({ Bucket: req.bucket, Key: req.key }),
      { expiresIn: req.ttlSeconds },
    );
  }

  /**
   * Read an object's full body into memory.
   *
   * For files a worker must parse rather than hand to a browser — the
   * JobThai XLSX drops are ~5 MB each. Use getSignedDownloadUrl instead
   * whenever the consumer is a client, so the bytes never transit the API.
   */
  async getObject(req: { bucket: string; key: string }): Promise<Buffer> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: req.bucket, Key: req.key }),
    );
    if (!result.Body) throw new Error(`s3://${req.bucket}/${req.key} returned no body`);
    const bytes = await result.Body.transformToByteArray();
    return Buffer.from(bytes);
  }

  async deleteObject(bucket: string, key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }

  async headObject(bucket: string, key: string): Promise<{ byteSize: number } | null> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: bucket, Key: key }),
      );
      return { byteSize: result.ContentLength ?? 0 };
    } catch (err) {
      // S3 returns 404 as NotFound; we normalise to null.
      if ((err as { name?: string })?.name === 'NotFound') return null;
      throw err;
    }
  }
}
