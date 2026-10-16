import { afterEach, describe, expect, it, vi } from 'vitest';

const send = vi.hoisted(() => vi.fn());
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(() => ({ send })),
  GetObjectCommand: vi.fn(),
}));

import { readBrandAsset } from '../src/lib/branding-storage';

const KEYS = ['MINIO_ENDPOINT', 'MINIO_ACCESS_KEY', 'MINIO_SECRET_KEY'] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  send.mockReset();
});

describe('readBrandAsset', () => {
  for (const missing of KEYS) {
    it(`returns null without contacting storage when ${missing} is unset`, async () => {
      for (const k of KEYS) process.env[k] = 'set';
      delete process.env[missing];
      await expect(readBrandAsset('logo-light/a.png')).resolves.toBeNull();
      expect(send).not.toHaveBeenCalled();
    });
  }

  it('returns null when storage throws', async () => {
    for (const k of KEYS) process.env[k] = 'set';
    send.mockRejectedValue(new Error('down'));
    await expect(readBrandAsset('logo-light/a.png')).resolves.toBeNull();
  });
});
