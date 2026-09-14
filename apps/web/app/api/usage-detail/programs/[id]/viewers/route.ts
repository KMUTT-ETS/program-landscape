import { NextResponse } from 'next/server';
import type { SessionUser } from '@kku/shared';
import { apiFetch, type ApiFetchError } from '@/lib/api-client';
import { auth } from '@/lib/auth';

// "Who viewed this programme" for the /usage dashboard. Server-side proxy for
// the same reason as the sibling users/[id] handler: /api/v1 is only reachable
// from the browser in prod. Authorisation stays with the api — the forwarded
// bearer carries the caller's own `usage:read:detail` decision.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_DAYS = new Set([7, 30, 90]);

/** A cuid is 25 characters and the api caps its own id params at 64. Bounding
 *  it here keeps an arbitrarily long path segment from being forwarded into an
 *  upstream query at all, rather than relying on the api to refuse it. */
const MAX_ID_LENGTH = 64;

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  }

  if (params.id.length === 0 || params.id.length > MAX_ID_LENGTH) {
    return NextResponse.json({ error: { code: 'BAD_REQUEST' } }, { status: 400 });
  }

  const days = Number(new URL(req.url).searchParams.get('days') ?? 30);
  if (!ALLOWED_DAYS.has(days)) {
    return NextResponse.json({ error: { code: 'BAD_REQUEST' } }, { status: 400 });
  }

  try {
    const data = await apiFetch<unknown>(
      `/usage/programs/${encodeURIComponent(params.id)}/viewers?days=${days}`,
    );
    return NextResponse.json({ data });
  } catch (err) {
    const e = err as ApiFetchError;
    const upstream = e.status ?? 502;
    const status = upstream >= 400 && upstream <= 599 ? upstream : 502;
    return NextResponse.json(
      { error: { code: e.code ?? 'UPSTREAM_ERROR', message: e.message } },
      { status },
    );
  }
}
