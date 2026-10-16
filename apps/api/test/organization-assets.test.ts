import { describe, expect, it } from 'vitest';
import { pngSize, validateBrandAsset } from '../src/organization/asset-validation';

function png(width: number, height: number): Buffer {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}
const svg = (body: string) => Buffer.from(`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`);

describe('pngSize', () => {
  it('reads width and height from the IHDR header', () => {
    expect(pngSize(png(120, 48))).toEqual({ width: 120, height: 48 });
    expect(pngSize(Buffer.from('not a png'))).toBeNull();
  });
});

describe('validateBrandAsset', () => {
  it('accepts a PNG logo and a clean SVG logo', () => {
    expect(validateBrandAsset('logo-light', png(300, 120))).toEqual({ ok: true, ext: 'png', contentType: 'image/png' });
    expect(validateBrandAsset('logo-dark', svg('<rect width="10" height="10"/>'))).toEqual({
      ok: true,
      ext: 'svg',
      contentType: 'image/svg+xml',
    });
  });

  it('rejects oversized, unknown and oversize-dimension files', () => {
    expect(validateBrandAsset('logo-light', Buffer.alloc(1024 * 1024 + 1)).ok).toBe(false);
    expect(validateBrandAsset('logo-light', Buffer.from('GIF89a')).ok).toBe(false);
    expect(validateBrandAsset('logo-light', png(4000, 100)).ok).toBe(false);
  });

  it.each([
    ['<script>alert(1)</script>'],
    ['<foreignObject></foreignObject>'],
    ['<rect onload="x()"/>'],
    ['<a href="javascript:alert(1)"><rect/></a>'],
    ['<image href="https://evil.example/x.png"/>'],
  ])('rejects an SVG containing %s', (body) => {
    expect(validateBrandAsset('logo-light', svg(body)).ok).toBe(false);
  });

  it('allows fragment and data-image hrefs in an SVG', () => {
    expect(validateBrandAsset('logo-light', svg('<use href="#a"/><image href="data:image/png;base64,AAAA"/>')).ok).toBe(true);
  });

  it('only accepts a square PNG of at least 32 px as a favicon', () => {
    expect(validateBrandAsset('favicon', png(64, 64)).ok).toBe(true);
    expect(validateBrandAsset('favicon', png(64, 32)).ok).toBe(false);
    expect(validateBrandAsset('favicon', png(16, 16)).ok).toBe(false);
    expect(validateBrandAsset('favicon', svg('<rect/>')).ok).toBe(false);
  });
});
