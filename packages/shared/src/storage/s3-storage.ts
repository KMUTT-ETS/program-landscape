import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type {
  ObjectStorage,
  PutObjectRequest,
  PutObjectResult,
  SignedUrlRequest,
} from './types';

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
        Metadata: req.metadata,
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
