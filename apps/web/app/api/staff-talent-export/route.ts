import { NextResponse } from 'next/server';
import { apiFetch } from '@/lib/api-client';
import { auth } from '@/lib/auth';
import type { SessionUser } from '@kku/shared';

// Teaching-talent XLSX export — POSTs to the API, which returns the
// workbook base64-encoded inside the standard response envelope, then
// streams the decoded bytes to the browser. Proxying (rather than handing
// the browser an API URL) keeps the download rooted at the dev server's
// own origin — the same reason admin-program-export proxies its PDF.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body: unknown = await req.json().catch(() => null);
  const parsed =
    body && typeof body === 'object'
      ? (body as { facultyName?: unknown; threshold?: unknown })
      : {};
  const facultyName = Array.isArray(parsed.facultyName)
    ? parsed.facultyName.filter((v): v is string => typeof v === 'string')
    : [];
  const threshold = typeof parsed.threshold === 'number' ? parsed.threshold : 4;

  // threshold is intentionally NOT re-validated against the allowed list
  // here — the API validates it with Zod and is the sole authority. The
  // browser is not a trustworthy source of truth for that rule.
  const result = await apiFetch<{
    filename: string;
    base64: string;
    rowCount: number;
    byteSize: number;
  }>('/staff/teaching-talent/export', {
    method: 'POST',
    body: JSON.stringify({ facultyName, threshold }),
  });

  const bytes = Buffer.from(result.base64, 'base64');
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${result.filename}"`,
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'private, no-store',
    },
  });
}
