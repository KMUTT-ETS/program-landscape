import { cookies } from 'next/headers';
import { ApiEnvelope } from '@kku/shared';

// Server-side fetch wrapper to the NestJS API.
//
// - Reads the session cookie from the incoming request and forwards it as
//   an Authorization: Bearer. NestJS's JwtAuthGuard verifies via jose.
// - Unwraps the envelope: returns `data` on success, throws on failure.
// - Typed by the caller: `apiFetch<T>(path)` gives you `T`.
//
// Only usable from server components / server actions / route handlers —
// never from client components. Browser traffic stays on same-origin
// Next.js; the NestJS API is internal.

const API_BASE = process.env.API_URL ?? 'http://localhost:4000';

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const cookieName =
    process.env.NODE_ENV === 'production'
      ? '__Secure-authjs.session-token'
      : 'authjs.session-token';
  const token = (await cookies()).get(cookieName)?.value;

  const headers = new Headers(init.headers ?? {});
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (init.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  const url = `${API_BASE}/api/v1${path}`;
  const res = await fetch(url, { ...init, headers, cache: 'no-store' });
  const json = (await res.json()) as ApiEnvelope<T>;

  if (!res.ok || json.error) {
    const msg = json.error?.message ?? `HTTP ${res.status}`;
    const err = new Error(msg) as Error & { code?: string };
    err.code = json.error?.code;
    throw err;
  }
  return json.data as T;
}

// Same as apiFetch, but returns the full envelope so callers can read
// `meta` (pagination, freshness, sources). Prefer this when pagination
// info from `meta.pagination` is needed — `apiFetch` discards it.
export async function apiFetchEnvelope<T>(
  path: string,
  init: RequestInit = {},
): Promise<ApiEnvelope<T>> {
  const cookieName =
    process.env.NODE_ENV === 'production'
      ? '__Secure-authjs.session-token'
      : 'authjs.session-token';
  const token = (await cookies()).get(cookieName)?.value;

  const headers = new Headers(init.headers ?? {});
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (init.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  const url = `${API_BASE}/api/v1${path}`;
  const res = await fetch(url, { ...init, headers, cache: 'no-store' });
  const json = (await res.json()) as ApiEnvelope<T>;

  if (!res.ok || json.error) {
    const msg = json.error?.message ?? `HTTP ${res.status}`;
    const err = new Error(msg) as Error & { code?: string };
    err.code = json.error?.code;
    throw err;
  }
  return json;
}
