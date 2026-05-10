import { NextResponse } from 'next/server';
import { apiFetch } from '@/lib/api-client';
import { auth } from '@/lib/auth';
import type { PublicProfileState, SessionUser } from '@kku/shared';

// Proxy for the public-profile toggle. Client component on /profile
// posts here; we forward to NestJS api with the JWT bearer.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  }
  const body = (await req.json()) as unknown;
  try {
    const next = await apiFetch<PublicProfileState>('/me/public-profile', {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    return NextResponse.json(next);
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'UPSTREAM_ERROR', message: (err as Error).message } },
      { status: 502 },
    );
  }
}
