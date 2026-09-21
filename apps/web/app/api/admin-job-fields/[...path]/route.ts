import { NextResponse } from 'next/server';
import { apiFetch, type ApiFetchError } from '@/lib/api-client';
import { auth } from '@/lib/auth';
import type { SessionUser } from '@kku/shared';

// Mutation passthrough: POST /api/admin-job-fields/<id>/approve etc. maps
// 1:1 onto POST /api/v1/admin/job-fields/<id>/approve. The path is a
// closed set so a stray segment cannot reach an unrelated api route.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Note: 'bulk-approve' (POST /admin/job-fields/bulk-approve) is already
// admitted by the bare-token alternative below — [A-Za-z0-9_-]+ was written
// for the rename-by-id PATCH path, but a literal alphanumeric-and-hyphen
// segment matches it too. Not listed separately to avoid a duplicate branch.
// 'assignments/bulk-approve' needs its own alternative and cannot borrow one:
// the bare-token class excludes '/', and 'assignments/<id>/approve' is three
// segments where this is two. Without it the proxy 404s every assignment bulk
// approval before the request reaches the api, which is what happened on dev.
export const ALLOWED = /^(?:[A-Za-z0-9_-]+\/(?:approve|reject|merge)|assignments|assignments\/bulk-approve|assignments\/[A-Za-z0-9_-]+\/(?:approve|reject)|[A-Za-z0-9_-]+)$/;

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
    const e = err as ApiFetchError;
    return NextResponse.json(
      { error: { code: e.code ?? 'UPSTREAM_ERROR', message: e.message } },
      { status: e.status ?? 502 },
    );
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  return forward(req, 'POST', (await params).path);
}
export async function PATCH(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  return forward(req, 'PATCH', (await params).path);
}

// GET passthrough — a separate, even narrower closed set than the mutation
// paths above (exact match, not a pattern): today this is ONLY
// refresh-status, the derived-layer rebuild triggers' polling endpoint.
const ALLOWED_GET = new Set(['refresh-status']);

export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) return NextResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  const joined = (await params).path.join('/');
  if (!ALLOWED_GET.has(joined)) return NextResponse.json({ error: { code: 'NOT_FOUND' } }, { status: 404 });
  try {
    const result = await apiFetch(`/admin/job-fields/${joined}`);
    return NextResponse.json({ data: result });
  } catch (err) {
    const e = err as ApiFetchError;
    return NextResponse.json(
      { error: { code: e.code ?? 'UPSTREAM_ERROR', message: e.message } },
      { status: e.status ?? 502 },
    );
  }
}
