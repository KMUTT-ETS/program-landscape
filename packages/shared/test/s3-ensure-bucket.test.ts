import { describe, expect, it, vi } from 'vitest';
import { CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';

import { S3Storage } from '../src/storage/s3-storage';

// WHY: `csv-uploads` was created on dev by `pnpm minio:init`, which deploy.sh
// never runs, so the first JobThai upload on prod would have failed with
// NoSuchBucket. The bucket is now ensured by the code that writes to it.

function storageWith(send: (cmd: unknown) => Promise<unknown>): S3Storage {
  const s = new S3Storage({ endpoint: 'http://minio:9000', region: 'us-east-1', accessKeyId: 'a', secretAccessKey: 'b' });
  (s as unknown as { client: { send: typeof send } }).client = { send };
  return s;
}

describe('S3Storage.ensureBucket', () => {
  it('creates the bucket when HEAD reports it missing', async () => {
    const send = vi.fn(async (cmd: unknown) => {
      if (cmd instanceof HeadBucketCommand) throw Object.assign(new Error('NotFound'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } });
      return {};
    });
    await storageWith(send).ensureBucket('csv-uploads');
    expect(send.mock.calls.some(([c]) => c instanceof CreateBucketCommand)).toBe(true);
  });

  it('does nothing when the bucket exists', async () => {
    const send = vi.fn(async () => ({}));
    await storageWith(send).ensureBucket('csv-uploads');
    expect(send.mock.calls.some(([c]) => c instanceof CreateBucketCommand)).toBe(false);
  });

  it('rethrows anything that is not "missing" — a credentials error must not look like success', async () => {
    const send = vi.fn(async () => {
      throw Object.assign(new Error('Forbidden'), { name: 'Forbidden', $metadata: { httpStatusCode: 403 } });
    });
    await expect(storageWith(send).ensureBucket('csv-uploads')).rejects.toThrow('Forbidden');
  });

  it('checks once per bucket per process', async () => {
    const send = vi.fn(async () => ({}));
    const s = storageWith(send);
    await s.ensureBucket('csv-uploads');
    await s.ensureBucket('csv-uploads');
    expect(send).toHaveBeenCalledTimes(1);
  });
});
