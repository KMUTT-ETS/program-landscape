import { PRODUCT_MARK_SVG } from '@/components/brand/product-mark';

const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

export function brandAssetResponse(input: {
  asset: { bytes: Buffer; contentType: string } | null;
  requestedVersion: string | null;
  currentVersion: number | null;
}): Response {
  const asset = input.asset ?? { bytes: Buffer.from(PRODUCT_MARK_SVG), contentType: 'image/svg+xml' };
  const pinned =
    input.asset !== null && input.currentVersion !== null && input.requestedVersion === String(input.currentVersion);
  const headers: Record<string, string> = {
    'Content-Type': asset.contentType,
    'Content-Length': String(asset.bytes.length),
    'Cache-Control': pinned ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
    'X-Content-Type-Options': 'nosniff',
  };
  if (asset.contentType === 'image/svg+xml') headers['Content-Security-Policy'] = SVG_CSP;
  return new Response(new Uint8Array(asset.bytes), { status: 200, headers });
}
