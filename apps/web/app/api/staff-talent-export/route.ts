import { NextResponse } from 'next/server';
import { apiFetch, type ApiFetchError } from '@/lib/api-client';
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
  let result: { filename: string; base64: string; rowCount: number; byteSize: number };
  try {
    result = await apiFetch<{
      filename: string;
      base64: string;
      rowCount: number;
      byteSize: number;
    }>('/staff/teaching-talent/export', {
      method: 'POST',
      body: JSON.stringify({ facultyName, threshold }),
    });
  } catch (err) {
    // The API is the sole authority on who may export (role/scope checks,
    // Zod validation of threshold, etc.) — its verdict (403 for no
    // permission, 400 for a bad body, ...) must reach the client instead
    // of collapsing into an opaque 500, or "no permission" and "server
    // broke" become indistinguishable to whoever triages the report.
    const apiErr = err as ApiFetchError;
    return NextResponse.json(
      { error: apiErr.code ?? 'export-failed', message: apiErr.message },
      { status: apiErr.status ?? 502 },
    );
  }

  const bytes = Buffer.from(result.base64, 'base64');
  // Strip quotes/control characters so an unexpected upstream filename
  // can't prematurely close the quoted Content-Disposition value (or
  // inject header content) — cheap to keep even though today's filename
  // is built server-side from a threshold and year range. Filtered by
  // char code (not a regex) to avoid a no-control-regex lint violation.
  const safeFilename = Array.from(result.filename)
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return ch !== '"' && code > 0x1f && code !== 0x7f;
    })
    .join('');
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${safeFilename}"`,
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'private, no-store',
    },
  });
}
