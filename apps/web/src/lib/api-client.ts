import { cookies } from 'next/headers';
import { ApiEnvelope, IMPERSONATION_COOKIE } from '@kku/shared';

// Server-side fetch wrapper to the NestJS API.
//
// - Reads the session JWT cookie and forwards it as Authorization: Bearer.
//   NestJS's JwtAuthGuard verifies via jose.
// - Forwards the kku-impersonate cookie (if set) as an X-KKU-Impersonate
//   header so the API guard applies the SAME role/scope override the
//   web's session callback already applies for SSR. Without this header
//   the API only sees the JWT-derived REAL role and silently grants
//   the super-admin's full access — the user's UI shows the impersonated
//   view, but the data behind it is still everything. Found 2026-05-09.
// - Unwraps the envelope: returns `data` on success, throws on failure.
// - Typed by the caller: `apiFetch<T>(path)` gives you `T`.
//
// Only usable from server components / server actions / route handlers —
// never from client components. Browser traffic stays on same-origin
// Next.js; the NestJS API is internal.

const API_BASE = process.env.API_URL ?? 'http://localhost:4000';

const IMPERSONATION_HEADER = 'x-kku-impersonate';

async function buildAuthHeaders(init: RequestInit): Promise<Headers> {
  const cookieName =
    process.env.NODE_ENV === 'production'
      ? '__Secure-authjs.session-token'
      : 'authjs.session-token';
  const store = await cookies();
  const token = store.get(cookieName)?.value;
  const imp = store.get(IMPERSONATION_COOKIE)?.value;

  const headers = new Headers(init.headers ?? {});
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (imp) headers.set(IMPERSONATION_HEADER, imp);
  if (init.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  return headers;
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = await buildAuthHeaders(init);
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
  const headers = await buildAuthHeaders(init);
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
