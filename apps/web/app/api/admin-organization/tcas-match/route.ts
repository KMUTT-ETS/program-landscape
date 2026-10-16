import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireSession } from '@/lib/auth/role-gate';

// Proxy: the Identity form's "does this Thai name match TCAS?" helper.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const API_BASE = process.env.API_URL ?? 'http://localhost:4000';

export async function GET(req: Request) {
  const guard = await requireSession({ minRole: 'admin' });
  if (guard.kind === 'deny') return guard.response;

  const cookieName =
    process.env.NODE_ENV === 'production' ? '__Secure-authjs.session-token' : 'authjs.session-token';
  const token = (await cookies()).get(cookieName)?.value;
  const headers = new Headers();
  if (token) headers.set('authorization', `Bearer ${token}`);

  const name = new URL(req.url).searchParams.get('name') ?? '';
  const upstream = await fetch(
    `${API_BASE}/api/v1/admin/organization/tcas-match?name=${encodeURIComponent(name)}`,
    { headers, cache: 'no-store' },
  );
  return new NextResponse(await upstream.text(), {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  });
}
