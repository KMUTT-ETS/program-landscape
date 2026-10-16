import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

describe('validateBrandAsset: SVG bypass hardening', () => {
  it.each([
    ['namespaced script', '<svg:script>alert(1)</svg:script>'],
    ['animated href', '<set attributeName="href" to="jav&#x61;script:alert(1)"/>'],
    ['animate values', '<animate attributeName="href" values="x"/>'],
    ['iframe', '<iframe src="x"></iframe>'],
    ['embed', '<embed src="x"/>'],
    ['object', '<object data="x"></object>'],
    ['style @import', '<style>@import "https://evil.example/a.css";</style>'],
    ['style url()', '<style>rect{fill:url(https://evil.example/a)}</style>'],
    ['inline style url()', '<rect style="fill:url(https://evil.example/a)"/>'],
    ['svg data href', '<image href="data:image/svg+xml;base64,AAAA"/>'],
    ['slash-separated handler', '<rect/onload=x()/>'],
    ['unquoted external href', '<image href=https://evil.example/x.png />'],
    ['numeric entity', '<text>&#x6a;</text>'],
    ['named entity', '<text>&nbsp;</text>'],
  ])('rejects %s', (_n, body) => {
    expect(validateBrandAsset('logo-light', svg(body)).ok).toBe(false);
  });

  it('still accepts a realistic clean logo', () => {
    const logo = svg(
      '<title>Logo</title><defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs><g><path d="M0 0h10v10z" fill="url(#g)"/><text>A &amp; B</text></g>',
    );
    expect(validateBrandAsset('logo-light', logo).ok).toBe(true);
  });

  it('explains a DOCTYPE rejection', () => {
    const r = validateBrandAsset('logo-light', Buffer.from('<?xml version="1.0"?><!DOCTYPE svg PUBLIC "x" "y"><svg xmlns="http://www.w3.org/2000/svg"/>'));
    expect(r).toMatchObject({ ok: false });
    expect(r.ok === false && r.reason).toMatch(/DOCTYPE/);
  });
});

describe('pngSize: header sanity', () => {
  it('rejects zero dimensions and a wrong IHDR length', () => {
    expect(pngSize(png(0, 10))).toBeNull();
    expect(pngSize(png(10, 0))).toBeNull();
    const b = png(10, 10);
    b.writeUInt32BE(12, 8);
    expect(pngSize(b)).toBeNull();
  });
});

describe('branding storage is write-only', () => {
  it('never hands out presigned/direct URLs and exposes only put()', () => {
    const src = readFileSync(join(__dirname, '../src/organization/branding-storage.service.ts'), 'utf8');
    expect(src).not.toContain('getSignedDownloadUrl');
    const methods = [...src.matchAll(/^\s{2}(?:async\s+)?([a-zA-Z]+)\(/gm)].map((m) => m[1]).filter((n) => n !== 'constructor');
    expect(methods.sort()).toEqual(['onModuleInit', 'put']);
  });
});
