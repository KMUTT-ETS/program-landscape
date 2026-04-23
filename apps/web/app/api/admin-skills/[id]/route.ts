import { NextResponse } from 'next/server';
import { apiFetch } from '@/lib/api-client';
import { auth } from '@/lib/auth';
import type { SessionUser } from '@kku/shared';

// Proxy for the /skills client-side detail fetch. apiFetch is
// server-only; the client can't carry the session bearer.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) {
    return NextResponse.json(
      { data: null, error: { code: 'UNAUTHORIZED' } },
      { status: 401 },
    );
  }
  const { id } = await params;
  const url = new URL(req.url);
  const detail = await apiFetch(`/skills/${id}?${url.searchParams.toString()}`);
  return NextResponse.json({ data: detail });
}
