import { NextRequest, NextResponse } from 'next/server';
import { apiFetchEnvelope } from '@/lib/api-client';
import { auth } from '@/lib/auth';
import type { SessionUser } from '@kku/shared';

// One grant project's detail for the /staff/grants side panel. apiFetch is
// server-only (it carries the session bearer), so the client calls this.
// The API applies the caller's faculty scope; an out-of-scope project is a
// 404 there and is passed through as one here.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) {
    return NextResponse.json({ data: null, error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  }
  const { id } = await ctx.params;
  try {
    const env = await apiFetchEnvelope<unknown>(
      `/staff-dashboard/grants/${encodeURIComponent(id)}`,
    );
    return NextResponse.json({ data: env.data, meta: env.meta, error: null });
  } catch (err) {
    // apiFetchEnvelope carries the envelope's error code, not an HTTP status.
    const code = (err as { code?: string }).code;
    const status = code === 'NOT_FOUND' ? 404 : code === 'FORBIDDEN' ? 403 : 502;
    return NextResponse.json(
      { data: null, error: { code: 'UPSTREAM_ERROR', message: (err as Error).message } },
      { status },
    );
  }
}
