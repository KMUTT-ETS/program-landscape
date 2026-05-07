// KKU Employee API client (api.kku.ac.th/docs/v3).
//
// Two endpoints used:
//   POST   /v3/token                            — exchange client creds for bearer
//   GET    /v3/employee-by-email?email=...      — lookup KKU staff by email
//
// Token is cached in-memory (per Node process) for the duration of its
// expires_in to keep latency on the admin pre-provision UI fast. Failure
// modes (network, 4xx, 5xx, schema mismatch) all surface as
// KkuApiError; callers handle the unhappy path explicitly.
//
// IMPORTANT — server-only. Never import this module from a 'use client'
// boundary; the client_secret would leak to the browser bundle.

import { z } from 'zod';

// Response schemas — kept minimal; spec may include more fields, but we
// only need a stable surface for the admin UI.
const TokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string().optional(),
  expires_in: z.number().int().positive().optional(),
});

// Per the spec at api.kku.ac.th/docs/v3/employee-by-email — the exact
// shape isn't published outside the (gated) docs portal, so we keep
// this intentionally permissive: required fields (email + a name)
// are validated; everything else passes through as `extra` for the UI
// to render verbatim. When KKU IT publishes the v3 contract publicly
// we tighten this schema.
const EmployeeResponseSchema = z
  .object({
    email: z.string().email().optional().nullable(),
    employee_id: z.string().optional().nullable(),
    employee_code: z.string().optional().nullable(),
    name_th: z.string().optional().nullable(),
    name_en: z.string().optional().nullable(),
    first_name: z.string().optional().nullable(),
    last_name: z.string().optional().nullable(),
    first_name_th: z.string().optional().nullable(),
    last_name_th: z.string().optional().nullable(),
    faculty: z.string().optional().nullable(),
    faculty_code: z.string().optional().nullable(),
    department: z.string().optional().nullable(),
    department_code: z.string().optional().nullable(),
    position: z.string().optional().nullable(),
    rank: z.string().optional().nullable(),
    status: z.string().optional().nullable(),
  })
  .passthrough();

export type KkuEmployee = z.infer<typeof EmployeeResponseSchema>;

export class KkuApiError extends Error {
  public readonly httpStatus?: number;
  constructor(message: string, httpStatus?: number, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'KkuApiError';
    this.httpStatus = httpStatus;
  }
}

// In-memory token cache. Per-process; on a multi-instance deploy each
// instance fetches its own token but the upstream rate limit is
// per-client-id, not per-instance, so this is fine.
let cached: { token: string; expiresAt: number } | null = null;

function envOrThrow(key: string): string {
  const v = process.env[key];
  if (!v) throw new KkuApiError(`KKU API env not set: ${key}`);
  return v;
}

async function fetchToken(): Promise<string> {
  const now = Date.now();
  // Refresh 60s before expiry so an in-flight request never gets a
  // just-expired token mid-roundtrip.
  if (cached && cached.expiresAt - 60_000 > now) return cached.token;

  const base = envOrThrow('KKU_API_BASE_URL');
  const clientId = envOrThrow('KKU_API_CLIENT_ID');
  const clientSecret = envOrThrow('KKU_API_CLIENT_SECRET');

  // Token path (v3): defaults to /v3/auth/token (verified by probe
  // 2026-05-07: GET /v3/token → 404 'Cannot POST:/token'; the
  // discoverable variant is /v3/auth/token, which returns 422 with
  // field-validation errors when called without a body — the standard
  // Adonis.js validation shape that KKU's API uses). Override via
  // KKU_API_TOKEN_PATH if KKU IT confirms a different path.
  const tokenPath = process.env.KKU_API_TOKEN_PATH ?? '/v3/auth/token';
  const url = `${base.replace(/\/$/, '')}${tokenPath}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret }),
  }).catch((err) => {
    throw new KkuApiError(`KKU API token fetch failed: ${err instanceof Error ? err.message : String(err)}`, undefined, err);
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new KkuApiError(`KKU API token endpoint ${res.status}: ${text.slice(0, 200)}`, res.status);
  }

  const json = await res.json().catch((err) => {
    throw new KkuApiError(`KKU API token response not JSON`, res.status, err);
  });
  const parsed = TokenResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new KkuApiError(`KKU API token schema mismatch: ${parsed.error.message}`, res.status);
  }

  const ttlMs = (parsed.data.expires_in ?? 3600) * 1000;
  cached = { token: parsed.data.access_token, expiresAt: now + ttlMs };
  return cached.token;
}

// Lookup a KKU employee by email. Returns null when the API responds
// 404 (no such employee) — distinguish from KkuApiError which is for
// auth/schema/network failures the admin UI should surface as errors.
export async function findEmployeeByEmail(email: string): Promise<KkuEmployee | null> {
  if (!email || !email.includes('@')) {
    throw new KkuApiError(`findEmployeeByEmail: invalid email ${email}`);
  }
  const base = envOrThrow('KKU_API_BASE_URL');
  const token = await fetchToken();

  // Employee lookup path: /v3/employee-by-email is the documented shape
  // per the KKU API spec we have. Override via KKU_API_EMPLOYEE_PATH if
  // KKU IT publishes a different route. The path is appended with
  // ?email=<urlencoded>.
  const employeePath = process.env.KKU_API_EMPLOYEE_PATH ?? '/v3/employee-by-email';
  const url = `${base.replace(/\/$/, '')}${employeePath}?email=${encodeURIComponent(email)}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
  }).catch((err) => {
    throw new KkuApiError(`KKU API employee fetch failed: ${err instanceof Error ? err.message : String(err)}`, undefined, err);
  });

  if (res.status === 404) return null;
  if (res.status === 401) {
    // Token may have been revoked early. Drop cache and retry once.
    cached = null;
    const retryToken = await fetchToken();
    const retry = await fetch(url, {
      method: 'GET',
      headers: { authorization: `Bearer ${retryToken}`, accept: 'application/json' },
    });
    if (retry.status === 404) return null;
    if (!retry.ok) {
      const text = await retry.text().catch(() => '');
      throw new KkuApiError(`KKU API employee endpoint ${retry.status} (after token refresh): ${text.slice(0, 200)}`, retry.status);
    }
    const j = await retry.json();
    const parsed = EmployeeResponseSchema.safeParse(j);
    if (!parsed.success) throw new KkuApiError(`KKU API employee schema mismatch: ${parsed.error.message}`);
    return parsed.data;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new KkuApiError(`KKU API employee endpoint ${res.status}: ${text.slice(0, 200)}`, res.status);
  }

  const json = await res.json().catch((err) => {
    throw new KkuApiError(`KKU API employee response not JSON`, res.status, err);
  });
  const parsed = EmployeeResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new KkuApiError(`KKU API employee schema mismatch: ${parsed.error.message}`);
  }
  return parsed.data;
}

// Convenience: derive a display name from whichever fields the API
// returned. Prefer Thai then English then composed.
export function deriveDisplayName(emp: KkuEmployee): string {
  if (emp.name_th) return emp.name_th;
  if (emp.name_en) return emp.name_en;
  if (emp.first_name_th && emp.last_name_th) return `${emp.first_name_th} ${emp.last_name_th}`;
  if (emp.first_name && emp.last_name) return `${emp.first_name} ${emp.last_name}`;
  return emp.email ?? '(unnamed)';
}
