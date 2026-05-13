import { NextResponse } from 'next/server';
import { apiFetch } from '@/lib/api-client';
import { auth } from '@/lib/auth';
import type { SessionUser } from '@kku/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// DELETE /api/proxy/analyst/conversations/:id — remove one conversation
// (and its messages + feedback, via the cascade on AnalystMessage).

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) {
    return NextResponse.json(
      { data: null, error: { code: 'UNAUTHORIZED' } },
      { status: 401 },
    );
  }
  const { id } = await params;
  try {
    const result = await apiFetch<{ deleted: true }>(
      `/analyst/conversations/${encodeURIComponent(id)}`,
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
