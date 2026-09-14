import { NextResponse } from 'next/server';
import type { SessionUser } from '@kku/shared';
import { apiFetch, type ApiFetchError } from '@/lib/api-client';
import { auth } from '@/lib/auth';

// Server-side proxy for the /usage access-log drill-downs.
//
// The dashboard's side panels are the one part of /usage that fetches on
// interaction rather than on render, and a client component cannot call
// /api/v1 directly: only prod's internal nginx routes that prefix to NestJS,
// so in dev the same call 404s. Same shape and same reasoning as the
// page-view beacon's proxy at app/api/usage/page-views.
//
// This handler adds NO authorisation of its own beyond "is there a session".
// The api gates the route on `usage:read:detail` and this proxy forwards the
// caller's own bearer, so a viewer without the permission gets the api's 403
// here too — putting a second, independently-maintained copy of the rule in
// the web layer would only create somewhere for the two to drift apart.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Mirrors DetailWindowQuery in the api: a USAGE_WINDOWS value inside raw
 *  retention. Rejected here rather than forwarded so a malformed query is a
 *  400 from us instead of a 500-shaped surprise from upstream. */
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
      `/usage/users/${encodeURIComponent(params.id)}?days=${days}`,
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
