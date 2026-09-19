import { NextResponse } from 'next/server';
import { apiFetch, type ApiFetchError } from '@/lib/api-client';
import { auth } from '@/lib/auth';
import type { SessionUser } from '@kku/shared';

// "Disagree" on a brief — one Annotation row against the AiInference that
// produced it. Same server-only bearer path as the brief itself.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) {
    return NextResponse.json({ data: null, error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  try {
    const result = await apiFetch('/gap/brief/disagreements', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });
    return NextResponse.json({ data: result });
  } catch (err) {
    const e = err as ApiFetchError;
    return NextResponse.json(
      { data: null, error: { code: e.code ?? 'UPSTREAM_ERROR', message: e.message } },
      { status: e.status ?? 502 },
    );
  }
}
