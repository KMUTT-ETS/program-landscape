import { NextResponse } from 'next/server';
import { apiFetch } from '@/lib/api-client';
import { auth } from '@/lib/auth';
import { isAdminGrade, type SessionUser } from '@kku/shared';

// Small Next.js route handler used by the /admin/data-sources client
// component to lazy-load the runs table for a selected source. Exists
// because apiFetch (which forwards the session cookie to NestJS as a
// bearer) is server-only — the client can't call it directly.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user || (!isAdminGrade(user.role) && user.role !== 'ANALYST')) {
    return NextResponse.json({ data: null, error: { code: 'FORBIDDEN' } }, { status: 403 });
  }
  const { id } = await params;
  const runs = await apiFetch<unknown[]>(`/data-sources/${id}/runs?limit=50`);
  return NextResponse.json({ data: runs });
}
