import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import type { SessionUser } from '@kku/shared';
import { prisma } from '@kku/db';
import { uploadAvatar, avatarKeyForUser } from '@/lib/avatar-storage';

// Profile-avatar upload endpoint. Accepts multipart/form-data with an
// `image` field — already cropped to a square on the client (see
// AvatarUploader). Stores in MinIO + records the key on the User row.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 4 * 1024 * 1024; // 4 MB — generous; cropped JPEGs are typically <300 KB
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Sign in required' } },
      { status: 401 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Expected multipart/form-data' } },
      { status: 400 },
    );
  }
  const file = form.get('image');
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Field "image" missing or not a file' } },
      { status: 400 },
    );
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      {
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: `Image is ${(file.size / 1024 / 1024).toFixed(1)} MB; limit is ${MAX_BYTES / 1024 / 1024} MB.`,
        },
      },
      { status: 413 },
    );
  }
  const contentType = file.type || 'image/jpeg';
  if (!ALLOWED_TYPES.has(contentType)) {
    return NextResponse.json(
      {
        error: {
          code: 'UNSUPPORTED_MEDIA_TYPE',
          message: `Content-Type ${contentType} not supported. Use JPEG, PNG, or WebP.`,
        },
      },
      { status: 415 },
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  await uploadAvatar(user.userId, bytes, contentType);

  // Persist the storage key + bump avatarUpdatedAt so cache-busting
  // URLs (`?v=<ts>`) resolve to the new image immediately.
  const updated = await prisma.user.update({
    where: { id: user.userId },
    data: {
      avatarStorageKey: avatarKeyForUser(user.userId),
      avatarUpdatedAt: new Date(),
    },
    select: { avatarUpdatedAt: true },
  });

  return NextResponse.json({
    ok: true,
    avatarUpdatedAt: updated.avatarUpdatedAt?.toISOString() ?? null,
  });
}
