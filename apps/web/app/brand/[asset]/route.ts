import { NextResponse } from 'next/server';
import { ASSET_COLUMN, getOrganizationProfile } from '@kku/db';
import { BRAND_ASSET_KINDS, type BrandAssetKind } from '@kku/shared';
import { readBrandAsset } from '@/lib/branding-storage';
import { brandAssetResponse } from '@/lib/brand-asset-response';

// Public (see middleware PUBLIC_PATHS): the sign-in page and the favicon need it
// before any session exists. Serves the organisation's logo/favicon, or the
// built-in product mark when none is uploaded or storage is unreachable.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, context: { params: Promise<{ asset: string }> }): Promise<Response> {
  const { asset } = await context.params;
  if (!(BRAND_ASSET_KINDS as readonly string[]).includes(asset)) return new NextResponse(null, { status: 404 });
  const kind = asset as BrandAssetKind;
  const row = await getOrganizationProfile().catch(() => null);
  const key = row?.[ASSET_COLUMN[kind]] ?? null;
  const stored = key ? await readBrandAsset(key) : null;
  return brandAssetResponse({
    asset: stored,
    requestedVersion: new URL(req.url).searchParams.get('v'),
    currentVersion: row?.version ?? null,
  });
}
