import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireSession } from '@/lib/auth/role-gate';

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
  const guard = await requireSession({ minRole: 'admin' });
  if (guard.kind === 'deny') return guard.response;
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
