import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireSession } from '@/lib/auth/role-gate';

// Proxy for POST /pdfs/fix-filenames on the NestJS API. Called by the
// admin "Check / rewrite filenames" button on /admin/pdf-review.

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

  const headers = new Headers({ 'content-type': 'application/json' });
  if (token) headers.set('authorization', `Bearer ${token}`);

  const body = await req.text();
  const upstream = await fetch(`${API_BASE}/api/v1/pdfs/fix-filenames`, {
    method: 'POST',
    headers,
    body,
  });
  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
    },
  });
}
