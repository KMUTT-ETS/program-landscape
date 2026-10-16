import { createHash } from 'node:crypto';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiError, S3Storage, type BrandAssetKind } from '@kku/shared';

@Injectable()
export class BrandingStorageService implements OnModuleInit {
  private storage?: S3Storage;
  private bucket = 'branding';

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const endpoint = this.config.get<string>('MINIO_ENDPOINT');
    if (!endpoint) return;
    this.storage = new S3Storage({
      endpoint,
      region: this.config.get<string>('MINIO_REGION') ?? 'us-east-1',
      accessKeyId: this.config.get<string>('MINIO_ACCESS_KEY') ?? '',
      secretAccessKey: this.config.get<string>('MINIO_SECRET_KEY') ?? '',
      publicEndpoint: this.config.get<string>('MINIO_PUBLIC_ENDPOINT') || undefined,
    });
    this.bucket = this.config.get<string>('MINIO_BUCKET_BRANDING') ?? 'branding';
  }

  /** Content-addressed key, so re-uploading the same file is a no-op upstream. */
  async put(kind: BrandAssetKind, bytes: Buffer, ext: 'png' | 'svg', contentType: string): Promise<string> {
    if (!this.storage) throw new ApiError('UPSTREAM_UNAVAILABLE', 'Object storage is not configured (MINIO_ENDPOINT).');
    await this.storage.ensureBucket(this.bucket); // memoised per bucket inside S3Storage
    const key = `${kind}/${createHash('sha256').update(bytes).digest('hex')}.${ext}`;
    await this.storage.putObject({ bucket: this.bucket, key, body: bytes, contentType });
    return key;
  }
}
