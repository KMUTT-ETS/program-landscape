import { NextResponse } from 'next/server';
import { prisma } from '@kku/db';
import { getAvatarBytes } from '@/lib/avatar-storage';

// Streams the user's profile photo from MinIO. Accessed via
// `<img src="/api/profile/avatar/<userId>?v=<ts>" />` from the
// profile hero + top-bar avatar.
//
// No auth on GET — avatars are non-sensitive (a person's photo and
// name are already in the staff directory). If we ever scope to
// "internal-only", add a `getServerSession` check here.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  context: { params: Promise<{ userId: string }> },
): Promise<NextResponse | Response> {
  const { userId } = await context.params;
  // Sanity-check that the user actually has an uploaded avatar before
  // hitting MinIO — saves a round trip on the (common) no-photo case.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { avatarStorageKey: true },
  });
  if (!user?.avatarStorageKey) {
    return new NextResponse(null, { status: 404 });
  }

  const blob = await getAvatarBytes(userId);
  if (!blob) {
    return new NextResponse(null, { status: 404 });
  }

  return new Response(new Uint8Array(blob.buffer), {
    status: 200,
    headers: {
      'Content-Type': blob.contentType,
      'Content-Length': String(blob.byteSize),
      // Long client-side cache; the URL carries `?v=<avatarUpdatedAt>`
      // so updates invalidate naturally.
      'Cache-Control': 'public, max-age=86400, immutable',
    },
  });
}
