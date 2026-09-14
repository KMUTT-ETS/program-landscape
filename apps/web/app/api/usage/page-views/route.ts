import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiFetch, type ApiFetchError } from '@/lib/api-client';
import { auth } from '@/lib/auth';
import type { SessionUser } from '@kku/shared';

// Proxy for the page-view beacon (src/components/usage-recorder.tsx). Dev
// has no reverse proxy in front of the api — only prod's internal nginx
// routes /api/v1 to NestJS — so a same-origin browser POST to /api/v1
// 404s in dev. This handler forwards server-side to POST
// /api/v1/usage/page-views with the session bearer, making dev and prod
// identical from the browser's point of view. Body is forwarded
// unchanged; identity comes from the forwarded session, never the body.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 2048;

// Mirrors UsageEvent in src/lib/usage-recorder-policy.ts. Keep the field
// set identical — that module is the source of truth for what a beacon
// can legitimately contain.
const eventSchema = z
  .object({
    path: z.string().max(512),
    scope: z.enum(['university', 'faculty', 'department', 'program']).optional(),
    scopeId: z.string().max(64).optional(),
    programId: z.string().max(64).optional(),
  })
  .strict();

export async function POST(req: Request) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) {
    // Unreachable in practice — middleware already redirects an expired
    // session to /signin for this path; kept so the handler is safe if
    // the matcher ever changes.
    return NextResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  }

  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
    return new NextResponse(null, { status: 413 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: { code: 'BAD_REQUEST' } }, { status: 400 });
  }
  const parsed = eventSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'BAD_REQUEST' } }, { status: 400 });
  }

  try {
    await apiFetch<void>('/usage/page-views', {
      method: 'POST',
      body: JSON.stringify(parsed.data),
    });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    const e = err as ApiFetchError;
    // apiFetch always calls res.json(), so a bodiless 2xx from the api
    // (204 is the natural answer to this insert) arrives here as
    // category 'data' even though the write succeeded. Treat it as success.
    if (e.category === 'data' && e.status !== null && e.status >= 200 && e.status < 300) {
      return new NextResponse(null, { status: 204 });
    }
    // Never echo an upstream status straight into NextResponse.json:
    // 204/205/304 with a body throws a TypeError and the beacon 500s.
    const upstream = e.status ?? 502;
    const status = upstream >= 400 && upstream <= 599 ? upstream : 502;
    return NextResponse.json({ error: { code: 'UPSTREAM_ERROR', message: e.message } }, { status });
  }
}
