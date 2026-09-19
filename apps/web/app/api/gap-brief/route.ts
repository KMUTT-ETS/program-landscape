import { NextResponse } from 'next/server';
import { apiFetch, type ApiFetchError } from '@/lib/api-client';
import { auth } from '@/lib/auth';
import type { SessionUser } from '@kku/shared';

// The Council brief over the rows on screen. The browser posts here, never to
// /api/v1 — apiFetch is server-only and carries the session bearer.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) {
    return NextResponse.json({ data: null, error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  try {
    const result = await apiFetch('/gap/brief', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });
    return NextResponse.json({ data: result });
  } catch (err) {
    const e = err as ApiFetchError;
    // The api's own message is what the panel shows — an AI quota refusal or
    // a throttle says something the reader can act on, and "502" does not.
    return NextResponse.json(
      { data: null, error: { code: e.code ?? 'UPSTREAM_ERROR', message: e.message } },
      { status: e.status ?? 502 },
    );
  }
}
