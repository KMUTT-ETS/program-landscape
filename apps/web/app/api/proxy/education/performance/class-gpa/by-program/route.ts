import { NextRequest, NextResponse } from 'next/server';
import { apiFetch } from '@/lib/api-client';
import { auth } from '@/lib/auth';
import type { SessionUser } from '@kku/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/proxy/education/performance/class-gpa/by-program
//
// Refetch endpoint for the Faculty → Program pivot when the user
// changes the semester filter on /education/performance. The SSR
// already renders the table for sem 1+2 (main terms); this route
// hands over subsequent toggles without a full page reload.

export async function GET(req: NextRequest): Promise<Response> {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) {
    return NextResponse.json(
      { data: null, error: { code: 'UNAUTHORIZED' } },
      { status: 401 },
    );
  }
  const qs = req.nextUrl.search;
  try {
    const result = await apiFetch<unknown>(
      `/education/performance/class-gpa/by-program${qs}`,
    );
    return NextResponse.json({ data: result });
  } catch (err) {
    return NextResponse.json(
      { data: null, error: { code: 'UPSTREAM_ERROR', message: (err as Error).message } },
      { status: 502 },
    );
  }
}
