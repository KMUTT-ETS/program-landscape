import { NextResponse } from 'next/server';
import { apiFetch, type ApiFetchError } from '@/lib/api-client';
import { auth } from '@/lib/auth';
import type { SessionUser } from '@kku/shared';

// One field's row, for callers that want it without the whole map — the AI
// Analyst's evidence rail and future incremental loads. The page itself does
// not use this: it server-renders every row's panels from the map payload.
// apiFetch is server-only; the browser cannot carry the session bearer.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) {
    return NextResponse.json({ data: null, error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  }
  const { slug } = await params;
  const url = new URL(req.url);
  try {
    const row = await apiFetch(`/gap/map/fields/${encodeURIComponent(slug)}?${url.searchParams.toString()}`);
    return NextResponse.json({ data: row });
  } catch (err) {
    const e = err as ApiFetchError;
    return NextResponse.json(
      { data: null, error: { code: e.code ?? 'UPSTREAM_ERROR', message: e.message } },
      { status: e.status ?? 502 },
    );
  }
}
