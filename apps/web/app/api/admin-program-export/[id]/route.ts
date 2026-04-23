import { NextResponse } from 'next/server';
import { apiFetch } from '@/lib/api-client';
import { auth } from '@/lib/auth';
import type { SessionUser } from '@kku/shared';

// Deep-dive PDF export — hits /cockpit/export with program scope, then
// redirects the browser to the MinIO signed URL. Keeping the export
// wiring centralised in /cockpit/export (which already runs through
// prompt 02c's PdfService) means the program brief shares the audit
// trail + PDF template with the Council Pack path.

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
  const r = await apiFetch<{ pdfUrl: string }>(`/cockpit/export`, {
    method: 'POST',
    body: JSON.stringify({ scope: 'program', scopeId: id, includeBrief: true }),
  });
  return NextResponse.redirect(r.pdfUrl);
}
