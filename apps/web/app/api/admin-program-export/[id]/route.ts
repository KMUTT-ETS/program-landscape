import { NextResponse } from 'next/server';
import { apiFetch } from '@/lib/api-client';
import { auth } from '@/lib/auth';
import type { SessionUser } from '@kku/shared';

// Deep-dive PDF export — hits /programs/:id/export-detail-pdf which
// renders the comprehensive tabular detail document via Gotenberg,
// then PROXIES the PDF bytes back to the browser. We do not redirect
// to the MinIO signed URL because in WSL2 / NAT-networking dev setups
// the browser cannot always reach the docker-published port directly
// (e.g., localhost:9000 forwarding is missing for non-default ports),
// which surfaces as ERR_CONNECTION_REFUSED. Proxying through this
// route keeps the URL the browser sees rooted at the same origin as
// the dev server.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const r = await apiFetch<{ pdfUrl: string; byteSize: number }>(
    `/programs/${id}/export-detail-pdf`,
    { method: 'POST', body: JSON.stringify({}) },
  );

  // Server-side fetch: localhost:9000 is reachable from the dev server
  // (same WSL2 network) even when the host browser cannot reach it.
  const upstream = await fetch(r.pdfUrl);
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      { error: 'pdf-fetch-failed', status: upstream.status },
      { status: 502 },
    );
  }
  const filename = `program-${id}-detail.pdf`;
  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
