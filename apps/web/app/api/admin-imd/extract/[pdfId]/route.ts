import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { auth } from '@/lib/auth';
import type { SessionUser } from '@kku/shared';

// Proxy: POST /api/admin-imd/extract/<pdfId> → NestJS POST /admin/imd/extract/<pdfId>.
// Used by the IMD upload widget on /admin/data-sources/imd-rankings.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const API_BASE = process.env.API_URL ?? 'http://localhost:4000';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ pdfId: string }> },
) {
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

  const { pdfId } = await params;
  const upstream = await fetch(
    `${API_BASE}/api/v1/admin/imd/extract/${encodeURIComponent(pdfId)}`,
    { method: 'POST', headers },
  );
  const body = await upstream.text();
  return new NextResponse(body, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  });
}
