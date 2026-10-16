import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { BRAND_ASSET_KINDS } from '@kku/shared';
import { requireSession } from '@/lib/auth/role-gate';

// Proxy: logo / favicon upload (multipart, streamed through) and removal.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const API_BASE = process.env.API_URL ?? 'http://localhost:4000';

function isKind(kind: string): boolean {
  return (BRAND_ASSET_KINDS as readonly string[]).includes(kind);
}

async function bearer(): Promise<string | undefined> {
  const cookieName =
    process.env.NODE_ENV === 'production'
      ? '__Secure-authjs.session-token'
      : 'authjs.session-token';
  return (await cookies()).get(cookieName)?.value;
}

async function relay(upstream: Response): Promise<NextResponse> {
  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  });
}

type Ctx = { params: Promise<{ kind: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const { kind } = await ctx.params;
  const guard = await requireSession({ minRole: 'admin' });
  if (guard.kind === 'deny') return guard.response;
  if (!isKind(kind)) return NextResponse.json({ error: { code: 'NOT_FOUND' } }, { status: 404 });

  const headers = new Headers();
  // The content-type carries the multipart boundary; it must pass unchanged.
  const ct = req.headers.get('content-type');
  if (ct) headers.set('content-type', ct);
  const token = await bearer();
  if (token) headers.set('authorization', `Bearer ${token}`);

  const init: RequestInit & { duplex: 'half' } = {
    method: 'POST',
    headers,
    body: req.body,
    duplex: 'half',
    cache: 'no-store',
  };
  return relay(await fetch(`${API_BASE}/api/v1/admin/organization/assets/${kind}`, init));
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { kind } = await ctx.params;
  const guard = await requireSession({ minRole: 'admin' });
  if (guard.kind === 'deny') return guard.response;
  if (!isKind(kind)) return NextResponse.json({ error: { code: 'NOT_FOUND' } }, { status: 404 });

  const headers = new Headers();
  const token = await bearer();
  if (token) headers.set('authorization', `Bearer ${token}`);
  return relay(
    await fetch(`${API_BASE}/api/v1/admin/organization/assets/${kind}`, {
      method: 'DELETE',
      headers,
      cache: 'no-store',
    }),
  );
}
