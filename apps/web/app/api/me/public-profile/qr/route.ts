import { NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { auth } from '@/lib/auth';
import { prisma } from '@kku/db';
import type { SessionUser } from '@kku/shared';

// Returns an SVG QR code for the requested public-profile slug.
// Authenticated — only the slug's owner can fetch their QR (prevents
// trivial QR scraping for any visited slug). Public viewers don't
// need the QR; they already have the URL.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const APP_ORIGIN =
  process.env.NEXT_PUBLIC_APP_ORIGIN ?? 'https://program-landscape.kku.ac.th';

export async function GET(req: Request) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  }
  const slug = new URL(req.url).searchParams.get('slug');
  if (!slug) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'slug query param required' } },
      { status: 400 },
    );
  }

  // Owner check — slug must belong to the caller.
  const owner = await prisma.user.findUnique({
    where: { publicProfileSlug: slug },
    select: { id: true },
  });
  if (!owner || owner.id !== user.userId) {
    return NextResponse.json({ error: { code: 'NOT_FOUND' } }, { status: 404 });
  }

  const url = `${APP_ORIGIN}/p/${slug}`;
  const svg = await QRCode.toString(url, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 256,
    color: {
      // Use plain hex — the SVG is dropped via dangerouslySetInnerHTML
      // and CSS variables won't resolve inside an inert SVG fragment.
      // Black-on-white maximises scanner compatibility.
      dark: '#000000',
      light: '#ffffff',
    },
  });
  return new NextResponse(svg, {
    headers: {
      'content-type': 'image/svg+xml',
      'cache-control': 'private, no-store',
    },
  });
}
