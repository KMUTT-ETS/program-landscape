// Browser-facing PDF proxy. Streams the bytes from MinIO through the
// web server so:
//   - the browser never sees the internal storage endpoint
//   - works in prod where MinIO is on the docker network only
//   - the URL stays stable for embed/iframe/react-pdf use
//
// Auth is enforced via the existing session cookie + the NestJS API's
// pdf:upload permission gate (the same gate /pdfs/:id/signed-url uses).

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireSession } from '@/lib/auth/role-gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const API_BASE = process.env.API_URL ?? 'http://localhost:4000';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const guard = await requireSession({ minRole: 'admin' });
  if (guard.kind === 'deny') return guard.response;

  const { id } = await params;

  const cookieName =
    process.env.NODE_ENV === 'production'
      ? '__Secure-authjs.session-token'
      : 'authjs.session-token';
  const token = (await cookies()).get(cookieName)?.value;

  // 1. Ask the API for a presigned URL. The API is the trust boundary
  //    for "can this user read this PDF" — same gate the rest of the
  //    PDF surface uses (pdf:upload permission).
  const signedRes = await fetch(`${API_BASE}/api/v1/pdfs/${encodeURIComponent(id)}/signed-url`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!signedRes.ok) {
    const body = await signedRes.text();
    return new NextResponse(body, {
      status: signedRes.status,
      headers: { 'content-type': signedRes.headers.get('content-type') ?? 'application/json' },
    });
  }
  const envelope = (await signedRes.json()) as { data?: { url?: string } };
  const url = envelope.data?.url;
  if (!url) {
    return NextResponse.json({ error: 'No signed URL in API response' }, { status: 502 });
  }

  // 2. Stream the bytes from MinIO. AbortController forwarded so the
  //    upstream connection releases when the client disconnects.
  const upstream = await fetch(url, { signal: req.signal });
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      { error: `Storage returned HTTP ${upstream.status}` },
      { status: 502 },
    );
  }

  const headers = new Headers();
  headers.set('content-type', upstream.headers.get('content-type') ?? 'application/pdf');
  const len = upstream.headers.get('content-length');
  if (len) headers.set('content-length', len);
  // Inline so the browser opens it in the PDF viewer / iframe rather
  // than triggering a download. Operator can still right-click → save.
  headers.set('content-disposition', 'inline');
  // Short cache — signed URLs rotate every 15 min anyway, and stale
  // bytes don't help anybody on a review page.
  headers.set('cache-control', 'private, max-age=60');

  return new NextResponse(upstream.body, {
    status: 200,
    headers,
  });
}
