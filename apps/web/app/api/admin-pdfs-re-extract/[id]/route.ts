import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { auth } from '@/lib/auth';
import type { SessionUser } from '@kku/shared';

// Proxy for POST /pdfs/:id/re-extract — used by the create-from-PDF
// wizard's "Retry AI extraction" button to re-queue the intake pipeline
// when the first Gemini pass timed out or failed.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const API_BASE = process.env.API_URL ?? 'http://localhost:4000';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) {
    return NextResponse.json(
      { data: null, error: { code: 'UNAUTHORIZED' } },
      { status: 401 },
    );
  }
  const cookieName =
    process.env.NODE_ENV === 'production'
      ? '__Secure-authjs.session-token'
      : 'authjs.session-token';
  const token = (await cookies()).get(cookieName)?.value;

  const { id } = await params;
  const headers = new Headers();
  if (token) headers.set('authorization', `Bearer ${token}`);
  const upstream = await fetch(
    `${API_BASE}/api/v1/pdfs/${encodeURIComponent(id)}/re-extract`,
    { method: 'POST', headers },
  );
  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
    },
  });
}
