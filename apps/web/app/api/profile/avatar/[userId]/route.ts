import { NextResponse } from 'next/server';
import { prisma } from '@kku/db';
import { auth } from '@/lib/auth';
import { getAvatarBytes } from '@/lib/avatar-storage';

// Streams the user's profile photo from MinIO. Accessed via
// `<img src="/api/profile/avatar/<userId>?v=<ts>" />` from the
// profile hero + top-bar avatar.
//
// Requires a valid session (V7 fix from prompt-04 audit). Avatar
// content itself is not high-sensitivity — but iterating arbitrary
// userIds against an unauthenticated endpoint also leaks "this user
// has uploaded a photo" via the 200/404 distinction. Gating on auth()
// closes the enumeration vector while still allowing every signed-in
// KKU user to see colleagues' photos.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  context: { params: Promise<{ userId: string }> },
): Promise<NextResponse | Response> {
  const session = await auth();
  if (!session?.user) {
    return new NextResponse(null, { status: 401 });
  }
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
