import { NextResponse } from 'next/server';
import { apiFetch } from '@/lib/api-client';
import { auth } from '@/lib/auth';
import type { PublicProfileState, SessionUser } from '@kku/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  }
  try {
    const next = await apiFetch<PublicProfileState>(
      '/me/public-profile/regenerate-slug',
      { method: 'POST' },
    );
    return NextResponse.json(next);
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'UPSTREAM_ERROR', message: (err as Error).message } },
      { status: 502 },
    );
  }
}
