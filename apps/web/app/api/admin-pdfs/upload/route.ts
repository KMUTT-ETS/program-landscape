import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { auth } from '@/lib/auth';
import type { SessionUser } from '@kku/shared';

// Proxy route: browser POSTs multipart form-data here, we forward it to
// NestJS with the session bearer. Next.js's server runtime streams the
// body, keeping memory bounded for large PDFs.
//
// Why not call NestJS directly from the client: the session cookie
// (which we mint the bearer from) is HttpOnly. The browser can't read
// it. So it proxies through this server route.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Next's default body parser would try to parse multipart as JSON; we
// need the raw stream. `bodyParser: false` in route.ts terms is just
// reading req.body directly.

const API_BASE = process.env.API_URL ?? 'http://localhost:4000';

export async function POST(req: Request) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) {
    return NextResponse.json(
      { data: null, error: { code: 'UNAUTHORIZED', message: 'Sign in required' } },
      { status: 401 },
    );
  }

  const cookieName =
    process.env.NODE_ENV === 'production'
      ? '__Secure-authjs.session-token'
      : 'authjs.session-token';
  const token = (await cookies()).get(cookieName)?.value;

  const headers = new Headers();
  if (token) headers.set('authorization', `Bearer ${token}`);
  // Pass through the original Content-Type (includes the multipart boundary).
  const ct = req.headers.get('content-type');
  if (ct) headers.set('content-type', ct);

  const upstream = await fetch(`${API_BASE}/api/v1/pdfs/upload`, {
    method: 'POST',
    headers,
    body: req.body,
    // Node's fetch requires this flag when streaming a body.
    // @ts-expect-error — undici-specific, not in stock fetch typings.
    duplex: 'half',
  });

  const body = await upstream.text();
  return new NextResponse(body, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  });
}
