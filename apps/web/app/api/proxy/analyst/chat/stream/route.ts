import { cookies } from 'next/headers';
import { auth } from '@/lib/auth';
import type { SessionUser } from '@kku/shared';

// Streaming proxy for /analyst/chat/stream — forwards the SSE response
// from the NestJS API straight through to the browser. Keeps the
// Authorization bearer in this Node hop so the client never sees the
// session JWT.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const API_BASE = process.env.API_URL ?? 'http://localhost:4000';

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  if (!user?.userId) {
    return new Response('Unauthorized', { status: 401 });
  }

  const cookieName =
    process.env.NODE_ENV === 'production'
      ? '__Secure-authjs.session-token'
      : 'authjs.session-token';
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) return new Response('Unauthorized', { status: 401 });

  const body = await req.text();
  const upstream = await fetch(`${API_BASE}/api/v1/analyst/chat/stream`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      accept: 'text/event-stream',
    },
    body,
    // Keep the connection alive for the lifetime of the SSE stream;
    // Node fetch defaults are fine but explicit signal-forwarding lets
    // a client disconnect cancel the upstream request cleanly.
    signal: req.signal,
  });

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => '');
    return new Response(text || 'Upstream error', { status: upstream.status });
  }

  // Pipe straight through. The upstream is already emitting
  // text/event-stream; we re-export the same content-type so EventSource-
  // compatible parsing keeps working on the browser side.
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
