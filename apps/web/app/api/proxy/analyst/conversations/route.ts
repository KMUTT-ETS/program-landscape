import { NextResponse } from 'next/server';
import { apiFetch } from '@/lib/api-client';
import { auth } from '@/lib/auth';
import type { SessionUser } from '@kku/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// DELETE /api/proxy/analyst/conversations — wipe ALL of the caller's
// conversations. Audit-logged on the NestJS side.

export async function DELETE(): Promise<Response> {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) {
    return NextResponse.json(
      { data: null, error: { code: 'UNAUTHORIZED' } },
      { status: 401 },
    );
  }
  try {
    const result = await apiFetch<{ deletedCount: number }>(
      '/analyst/conversations',
      { method: 'DELETE' },
    );
    return NextResponse.json({ data: result });
  } catch (err) {
    return NextResponse.json(
      { data: null, error: { code: 'UPSTREAM_ERROR', message: (err as Error).message } },
      { status: 502 },
    );
  }
}
