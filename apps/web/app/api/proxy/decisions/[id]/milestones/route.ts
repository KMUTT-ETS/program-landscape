import { NextResponse } from 'next/server';
import { apiFetch } from '@/lib/api-client';
import { auth } from '@/lib/auth';
import type { SessionUser } from '@kku/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) return NextResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  const { id } = await params;
  const body = await req.json();
  try {
    const result = await apiFetch(`/decisions/${id}/milestones`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });
    return NextResponse.json({ data: result });
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'UPSTREAM_ERROR', message: (err as Error).message } },
      { status: 502 },
    );
  }
}
