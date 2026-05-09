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

// Magic-byte sniff. Header `file.type` is browser-set and trivially
// spoofable, so we also inspect the first few bytes to confirm the
// content actually matches a supported image format. Returns the
// detected MIME or null when no signature matches.
function sniffImageType(bytes: Buffer): string | null {
  if (bytes.length < 12) return null;
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return 'image/png';
  // WebP: RIFF .... WEBP
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return 'image/webp';
  return null;
}

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

  // Magic-byte sniff is the trust boundary, not the header. A spoofed
  // header can still get past `ALLOWED_TYPES` (browser-set on `file.type`).
  const sniffed = sniffImageType(bytes);
  if (!sniffed || !ALLOWED_TYPES.has(sniffed)) {
    return NextResponse.json(
      {
        error: {
          code: 'UNSUPPORTED_MEDIA_TYPE',
          message: 'File contents do not match a supported image format (JPEG, PNG, WebP).',
        },
      },
      { status: 415 },
    );
  }

  // Persist with the sniffed MIME, never the browser-supplied header.
  await uploadAvatar(user.userId, bytes, sniffed);

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
