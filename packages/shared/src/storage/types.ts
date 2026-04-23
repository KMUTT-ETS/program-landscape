// Small, storage-backend-agnostic surface for object storage. MinIO is
// the dev + prod backend today; the shape below would work equally for
// AWS S3, GCS (via S3-compat), or Cloudflare R2 if we ever need to move.

export interface PutObjectRequest {
  bucket: string;
  key: string;
  body: Buffer;
  contentType: string;
  metadata?: Record<string, string>;
}

export interface PutObjectResult {
  bucket: string;
  key: string;
  etag?: string;
  byteSize: number;
}

export interface SignedUrlRequest {
  bucket: string;
  key: string;
  ttlSeconds: number;
  // Override the host used in the returned URL — useful when the S3
  // endpoint the server talks to (docker network) differs from the one
  // the browser reaches (public host / reverse proxy).
  publicEndpointOverride?: string;
}

export interface ObjectStorage {
  putObject(req: PutObjectRequest): Promise<PutObjectResult>;
  getSignedDownloadUrl(req: SignedUrlRequest): Promise<string>;
  headObject(bucket: string, key: string): Promise<{ byteSize: number } | null>;
}
