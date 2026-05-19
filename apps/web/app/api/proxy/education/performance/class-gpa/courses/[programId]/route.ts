import { NextRequest, NextResponse } from 'next/server';
import { apiFetch } from '@/lib/api-client';
import { auth } from '@/lib/auth';
import type { SessionUser } from '@kku/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/proxy/education/performance/class-gpa/courses/:programId
//
// Per-course (Class) drill for the Faculty → Program → Class pivot in
// /education/performance. Forwards the `semester` query params (one
// per selected term — 1, 2, 3, 4) and the optional `acadYearBE` array
// to the NestJS controller. Used by the lazy expand inside
// `class-gpa-section.tsx`.

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ programId: string }> },
): Promise<Response> {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) {
    return NextResponse.json(
      { data: null, error: { code: 'UNAUTHORIZED' } },
      { status: 401 },
    );
  }
  const { programId } = await ctx.params;
  // Forward the upstream query string verbatim — the back-end Zod
  // validator handles multi-value `semester` + `acadYearBE` already.
  const qs = req.nextUrl.search; // includes leading '?'
  try {
    const result = await apiFetch<unknown>(
      `/education/performance/class-gpa/courses/${encodeURIComponent(programId)}${qs}`,
    );
    return NextResponse.json({ data: result });
  } catch (err) {
    return NextResponse.json(
      { data: null, error: { code: 'UPSTREAM_ERROR', message: (err as Error).message } },
      { status: 502 },
    );
  }
}
