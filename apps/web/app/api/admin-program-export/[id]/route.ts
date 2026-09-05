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

// Signed URLs carry credentials in the query string. Log origin + path
// only — enough to tell an unreachable host from a wrong bucket, without
// writing a usable download link into the container logs.
function safeUrlForLog(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.origin}${u.pathname}`;
  } catch {
    return '(unparseable url)';
  }
}

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

  // Both steps below are reported distinctly. Previously neither was
  // wrapped, so a Gotenberg timeout, a schema rejection and an
  // unreachable MinIO endpoint all surfaced identically as a bare 500
  // with no body — which is exactly the state this route was found in
  // on prod, where it fails while dev succeeds. The stage name is the
  // first thing that narrows it.
  let r: { pdfUrl: string; byteSize: number };
  try {
    r = await apiFetch<{ pdfUrl: string; byteSize: number }>(
      `/programs/${id}/export-detail-pdf`,
      { method: 'POST', body: JSON.stringify({}) },
    );
  } catch (err) {
    const e = err as { message?: string; status?: number | null; code?: string };
    console.error('[admin-program-export] render failed', {
      programId: id,
      status: e.status ?? null,
      code: e.code ?? null,
      message: e.message,
    });
    return NextResponse.json(
      { error: 'pdf-render-failed', stage: 'api', status: e.status ?? null, message: e.message },
      { status: 502 },
    );
  }

  // Server-side fetch of the signed URL. On prod this is whatever
  // MINIO_PUBLIC_ENDPOINT signs for, which the container must be able to
  // resolve AND trust — a self-signed https endpoint throws here rather
  // than returning !ok, so the throw needs catching, not just the status.
  let upstream: Response;
  try {
    upstream = await fetch(r.pdfUrl);
  } catch (err) {
    const cause = (err as { cause?: unknown }).cause;
    console.error('[admin-program-export] signed-URL fetch threw', {
      programId: id,
      url: safeUrlForLog(r.pdfUrl),
      message: (err as Error).message,
      cause: cause instanceof Error ? cause.message : String(cause ?? ''),
    });
    return NextResponse.json(
      {
        error: 'pdf-fetch-failed',
        stage: 'storage',
        message: (err as Error).message,
        hint: 'the app server could not reach the signed storage URL — check MINIO_PUBLIC_ENDPOINT resolves and is trusted from inside the container',
      },
      { status: 502 },
    );
  }
  if (!upstream.ok || !upstream.body) {
    console.error('[admin-program-export] signed-URL fetch not ok', {
      programId: id,
      url: safeUrlForLog(r.pdfUrl),
      status: upstream.status,
    });
    return NextResponse.json(
      { error: 'pdf-fetch-failed', stage: 'storage', status: upstream.status },
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
