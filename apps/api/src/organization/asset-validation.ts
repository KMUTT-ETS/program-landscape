import type { BrandAssetKind } from '@kku/shared';

// Brand asset checks (spec §6, with the reject-don't-strip SVG ruling recorded
// in the phase-2 plan). Pure: bytes in, verdict out.

export const MAX_ASSET_BYTES = 1024 * 1024;
const MAX_SIDE = 2048;
const MIN_FAVICON = 32;
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function pngSize(bytes: Buffer): { width: number; height: number } | null {
  if (
    bytes.length < 24 ||
    !bytes.subarray(0, 8).equals(PNG_SIG) ||
    bytes.readUInt32BE(8) !== 13 ||
    bytes.toString('ascii', 12, 16) !== 'IHDR'
  ) {
    return null;
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  return width >= 1 && height >= 1 ? { width, height } : null;
}

// Logos need no entities, so any character reference is rejected: it is the
// way every other rule below would be obfuscated.
const SVG_FORBIDDEN: Array<[RegExp, string]> = [
  [/<[\w-]*:?script[\s>/]/i, 'scripts'],
  [/<(?:[\w-]+:)?(?:iframe|embed|object|set|animate\w*|handler|listener)[\s>/]/i, 'embedded or animated active elements'],
  [/<foreignObject/i, 'foreignObject'],
  [/[\s/"']on[a-z]+\s*=/i, 'event-handler attributes'],
  [/javascript:/i, 'javascript: URLs'],
  [/@import/i, 'CSS imports'],
  [/url\(\s*['"]?\s*(?!#)/i, 'CSS url() references to anything but a fragment'],
  [/data:image\/svg\+xml/i, 'nested SVG data URLs'],
  [/&#/, 'character references'],
  [/&(?!amp;|lt;|gt;|quot;|apos;)[a-z][a-z0-9]*;/i, 'entity references'],
  [
    /(?:xlink:)?href\s*=\s*(?:["'](?!#|data:image\/(?:png|jpe?g|gif|webp))[^"']*["']|(?!["'#])[^\s>]+)/i,
    'external links',
  ],
];

function looksLikeSvg(bytes: Buffer): boolean {
  const head = bytes.toString('utf8', 0, Math.min(bytes.length, 1024)).trimStart();
  return /^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(head);
}

export type AssetVerdict =
  | { ok: true; ext: 'png' | 'svg'; contentType: 'image/png' | 'image/svg+xml' }
  | { ok: false; reason: string };

export function validateBrandAsset(kind: BrandAssetKind, bytes: Buffer): AssetVerdict {
  if (bytes.length > MAX_ASSET_BYTES) return { ok: false, reason: 'File is larger than 1 MB.' };

  const size = pngSize(bytes);
  if (size) {
    if (size.width > MAX_SIDE || size.height > MAX_SIDE) {
      return { ok: false, reason: `Image is ${size.width}×${size.height}; the limit is ${MAX_SIDE} px per side.` };
    }
    if (kind === 'favicon' && (size.width !== size.height || size.width < MIN_FAVICON)) {
      return { ok: false, reason: `A favicon must be a square PNG of at least ${MIN_FAVICON} px.` };
    }
    return { ok: true, ext: 'png', contentType: 'image/png' };
  }

  if (looksLikeSvg(bytes)) {
    if (kind === 'favicon') return { ok: false, reason: 'A favicon must be a PNG.' };
    const text = bytes.toString('utf8');
    for (const [re, what] of SVG_FORBIDDEN) {
      if (re.test(text)) return { ok: false, reason: `SVG contains ${what}, which is not allowed in a logo.` };
    }
    return { ok: true, ext: 'svg', contentType: 'image/svg+xml' };
  }

  const head = bytes.toString('utf8', 0, Math.min(bytes.length, 1024));
  if (/<!DOCTYPE/i.test(head) && /<svg/i.test(head)) {
    return { ok: false, reason: 'SVG files with a DOCTYPE are not allowed — re-export the logo without it.' };
  }
  return { ok: false, reason: 'Upload a PNG or SVG file.' };
}
