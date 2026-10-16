import { describe, expect, it } from 'vitest';
import { brandAssetResponse } from '../src/lib/brand-asset-response';

const png = { bytes: Buffer.from([0x89, 0x50]), contentType: 'image/png' };
const svg = { bytes: Buffer.from('<svg/>'), contentType: 'image/svg+xml' };

describe('brandAssetResponse', () => {
  it('serves a stored asset immutably when the URL carries the current version', async () => {
    const res = brandAssetResponse({ asset: png, requestedVersion: '7', currentVersion: 7 });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  });

  it('caches briefly when the version is missing or stale', () => {
    expect(brandAssetResponse({ asset: png, requestedVersion: null, currentVersion: 7 }).headers.get('cache-control')).toBe(
      'public, max-age=300',
    );
    expect(brandAssetResponse({ asset: png, requestedVersion: '6', currentVersion: 7 }).headers.get('cache-control')).toBe(
      'public, max-age=300',
    );
  });

  it('sandboxes every SVG it serves', () => {
    const res = brandAssetResponse({ asset: svg, requestedVersion: '7', currentVersion: 7 });
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('falls back to the built-in product mark (200, short cache) when there is no asset', async () => {
    const res = brandAssetResponse({ asset: null, requestedVersion: '7', currentVersion: null });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/svg+xml');
    expect(res.headers.get('cache-control')).toBe('public, max-age=300');
    expect(await res.text()).toContain('<svg');
  });
});
