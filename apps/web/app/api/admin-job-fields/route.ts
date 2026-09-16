import { NextResponse } from 'next/server';
import { apiFetch, type ApiFetchError } from '@/lib/api-client';
import { auth } from '@/lib/auth';
import type { SessionUser } from '@kku/shared';

// Proxy for the /admin/job-fields client refresh. apiFetch is server-only;
// the browser cannot carry the session bearer.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) return NextResponse.json({ data: null, error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  try {
    const [fields, assignments] = await Promise.all([
      apiFetch('/admin/job-fields'),
      apiFetch('/admin/job-fields/assignments'),
    ]);
    return NextResponse.json({ data: { fields, assignments } });
  } catch (err) {
    const e = err as ApiFetchError;
    return NextResponse.json(
      { data: null, error: { code: e.code ?? 'UPSTREAM_ERROR', message: e.message } },
      { status: e.status ?? 502 },
    );
  }
}
