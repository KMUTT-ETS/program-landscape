import { NextResponse } from 'next/server';
import { apiFetch } from '@/lib/api-client';
import { auth } from '@/lib/auth';
import type { SessionUser } from '@kku/shared';

// Mutation passthrough: POST /api/admin-job-fields/<id>/approve etc. maps
// 1:1 onto POST /api/v1/admin/job-fields/<id>/approve. The path is a
// closed set so a stray segment cannot reach an unrelated api route.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED = /^(?:[A-Za-z0-9_-]+\/(?:approve|reject|merge)|assignments|assignments\/[A-Za-z0-9_-]+\/(?:approve|reject)|[A-Za-z0-9_-]+)$/;

async function forward(req: Request, method: 'POST' | 'PATCH', path: string[]) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) return NextResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  const joined = path.join('/');
  if (!ALLOWED.test(joined)) return NextResponse.json({ error: { code: 'NOT_FOUND' } }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  try {
    const result = await apiFetch(`/admin/job-fields/${joined}`, {
      method,
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });
    return NextResponse.json({ data: result });
  } catch (err) {
    return NextResponse.json({ error: { code: 'UPSTREAM_ERROR', message: (err as Error).message } }, { status: 502 });
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  return forward(req, 'POST', (await params).path);
}
export async function PATCH(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  return forward(req, 'PATCH', (await params).path);
}
