import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireSession } from '@/lib/auth/role-gate';

// Proxy: browser POSTs a multipart document here; we forward it to NestJS with the
// session bearer (the session cookie is HttpOnly, so the browser can't call
// NestJS directly). Mirrors /api/admin-pdfs/upload.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const API_BASE = process.env.API_URL ?? 'http://localhost:4000';

export async function POST(req: Request) {
  const guard = await requireSession({ minRole: 'admin' });
  if (guard.kind === 'deny') return guard.response;

  const cookieName =
    process.env.NODE_ENV === 'production'
      ? '__Secure-authjs.session-token'
      : 'authjs.session-token';
  const token = (await cookies()).get(cookieName)?.value;

  const headers = new Headers();
  if (token) headers.set('authorization', `Bearer ${token}`);
  const ct = req.headers.get('content-type');
  if (ct) headers.set('content-type', ct);

  const upstream = await fetch(`${API_BASE}/api/v1/admin/trend-documents`, {
    method: 'POST',
    headers,
    body: req.body,
    // @ts-expect-error — undici-specific, required when streaming a body.
    duplex: 'half',
  });

  const body = await upstream.text();
  return new NextResponse(body, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  });
}
