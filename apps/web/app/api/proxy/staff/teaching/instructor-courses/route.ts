import { NextRequest, NextResponse } from 'next/server';
import { apiFetch } from '@/lib/api-client';
import { auth } from '@/lib/auth';
import type { SessionUser } from '@kku/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/proxy/staff/teaching/instructor-courses?programId=X&facultyMemberId=Y
//
// 5th-level drill on the /staff/teaching pivot — courses the instructor
// taught within ONE program. Server enforces both assertProgramAccessible
// and assertInstructorAccessible.
export async function GET(req: NextRequest): Promise<Response> {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) {
    return NextResponse.json(
      { data: null, error: { code: 'UNAUTHORIZED' } },
      { status: 401 },
    );
  }
  try {
    const result = await apiFetch<unknown>(
      `/staff/teaching/instructor-courses${req.nextUrl.search}`,
    );
    return NextResponse.json({ data: result });
  } catch (err) {
    return NextResponse.json(
      { data: null, error: { code: 'UPSTREAM_ERROR', message: (err as Error).message } },
      { status: 502 },
    );
  }
}
