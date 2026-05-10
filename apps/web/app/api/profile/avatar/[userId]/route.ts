import { NextResponse } from 'next/server';
import { prisma } from '@kku/db';
import { auth } from '@/lib/auth';
import { getAvatarBytes } from '@/lib/avatar-storage';

// Streams the user's profile photo from MinIO. Accessed via
// `<img src="/api/profile/avatar/<userId>?v=<ts>" />` from the
// profile hero + top-bar avatar AND from /p/<slug> public pages.
//
// Authorization: signed-in callers always pass; anonymous callers
// pass only when the target user's publicProfileEnabled=true. The
// 200/404 distinction still leaks "this user has uploaded a photo,"
// but the leak is intentional for opted-in users (their public
// profile already discloses the same fact).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  context: { params: Promise<{ userId: string }> },
): Promise<NextResponse | Response> {
  const session = await auth();
  const { userId } = await context.params;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { avatarStorageKey: true, publicProfileEnabled: true },
  });
  if (!user?.avatarStorageKey) {
    return new NextResponse(null, { status: 404 });
  }
  // Anonymous: only allow if the target user opted in.
  if (!session?.user && !user.publicProfileEnabled) {
    return new NextResponse(null, { status: 401 });
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
