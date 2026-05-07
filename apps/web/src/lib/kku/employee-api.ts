// KKU Employee API client (api.kku.ac.th/docs/v3).
//
// Two endpoints used (verified against KKU IT example code 2026-05-07):
//   POST /v3/auth/token
//        Content-Type: application/x-www-form-urlencoded
//        body: client_id, secret_key
//        → { token, type, expiresIn?, ... }
//   GET  /v3/hr/employee/filter/email/{email}
//        Authorization: Bearer <token>
//        → flat employee record (firstname, lastname, faculty, etc.)
//
// The employee response includes Thai citizen ID (`identification`) and
// passport (`pass`) — both restricted PDPA personal data. The client
// here SCRUBS those fields before returning. Callers (server actions,
// UI) never see them; logs never see them.
//
// Token is cached in-memory (per Node process) for the duration of its
// expires_in to keep latency on the admin pre-provision UI fast. Failure
// modes (network, 4xx, 5xx, schema mismatch) all surface as
// KkuApiError; callers handle the unhappy path explicitly.
//
// IMPORTANT — server-only. Never import this module from a 'use client'
// boundary; the secret_key would leak to the browser bundle.

import { z } from 'zod';

// Token response — KKU's API may return either OAuth-shape
// `access_token` or Adonis-shape `token`. Schema accepts both;
// the read code prefers `token` then falls back to `access_token`.
const TokenResponseSchema = z
  .object({
    token: z.string().optional(),
    access_token: z.string().optional(),
    type: z.string().optional(),
    token_type: z.string().optional(),
    expiresIn: z.number().int().positive().optional(),
    expires_in: z.number().int().positive().optional(),
    expiresAt: z.string().optional(),
  })
  .passthrough();

// Raw response from /v3/hr/employee/filter/email/{email}. Captures
// every field the live API returns (sample obtained from KKU IT
// 2026-05-07). `identification` and `pass` are intentionally NOT
// re-exported via the public KkuEmployee type — they're scrubbed
// during the read path.
const EmployeeResponseRawSchema = z
  .object({
    id: z.union([z.number(), z.string()]).optional().nullable(),
    title: z.string().optional().nullable(),
    firstname: z.string().optional().nullable(),
    lastname: z.string().optional().nullable(),
    title_eng: z.string().optional().nullable(),
    firstname_eng: z.string().optional().nullable(),
    lastname_eng: z.string().optional().nullable(),
    statuslist: z.string().optional().nullable(),
    positype: z.string().optional().nullable(),
    workline: z.string().optional().nullable(),
    posi: z.string().optional().nullable(),
    level: z.string().optional().nullable(),
    faculty: z.string().optional().nullable(),
    division: z.string().optional().nullable(),
    job: z.string().optional().nullable(),
    unit: z.string().optional().nullable(),
    subunit: z.string().optional().nullable(),
    location: z.string().optional().nullable(),
    email: z.string().optional().nullable(),
    // PII — scrubbed before leaving this module:
    identification: z.string().optional().nullable(),
    pass: z.string().optional().nullable(),
  })
  .passthrough();

// Public-safe type. PII fields are stripped. This is what server
// actions return to the client.
export interface KkuEmployee {
  id?: number | string | null;
  title?: string | null;
  firstname?: string | null;
  lastname?: string | null;
  title_eng?: string | null;
  firstname_eng?: string | null;
  lastname_eng?: string | null;
  statuslist?: string | null;
  positype?: string | null;
  workline?: string | null;
  posi?: string | null;
  level?: string | null;
  faculty?: string | null;
  division?: string | null;
  job?: string | null;
  unit?: string | null;
  subunit?: string | null;
  location?: string | null;
  email?: string | null;
}

const PII_FIELDS = ['identification', 'pass'] as const;

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

  // Verified shape (KKU IT example, 2026-05-07):
  //   POST /v3/auth/token
  //   Content-Type: application/x-www-form-urlencoded
  //   body: client_id=…&secret_key=…
  // NOTE: KKU's field is `secret_key`, not the OAuth-standard
  // `client_secret`. Don't change this without checking the spec.
  const tokenPath = process.env.KKU_API_TOKEN_PATH ?? '/v3/auth/token';
  const url = `${base.replace(/\/$/, '')}${tokenPath}`;
  const body = new URLSearchParams({
    client_id: clientId,
    secret_key: clientSecret,
  }).toString();

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body,
  }).catch((err) => {
    throw new KkuApiError(
      `KKU API token fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      undefined,
      err,
    );
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new KkuApiError(
      `KKU API token endpoint ${res.status}: ${text.slice(0, 200)}`,
      res.status,
    );
  }

  const json = await res.json().catch((err) => {
    throw new KkuApiError(`KKU API token response not JSON`, res.status, err);
  });
  const parsed = TokenResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new KkuApiError(`KKU API token schema mismatch: ${parsed.error.message}`, res.status);
  }

  // KKU returns the token under `token` (Adonis OAT shape); some
  // alternate gateways return `access_token`. Accept either.
  const tokenStr = parsed.data.token ?? parsed.data.access_token;
  if (!tokenStr) {
    throw new KkuApiError(`KKU API token response missing token field`, res.status);
  }
  const ttlSec = parsed.data.expiresIn ?? parsed.data.expires_in ?? 3600;
  cached = { token: tokenStr, expiresAt: now + ttlSec * 1000 };
  return cached.token;
}

// Strip Thai citizen ID + passport before letting an employee
// record leave this module. Returns a fresh object so the caller
// can never accidentally pass through the raw response.
function scrubPii(raw: Record<string, unknown>): KkuEmployee {
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if ((PII_FIELDS as readonly string[]).includes(k)) continue;
    cleaned[k] = v;
  }
  return cleaned as KkuEmployee;
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

  // Verified shape (KKU IT example, 2026-05-07):
  //   GET /v3/hr/employee/filter/email/{email}
  //   Authorization: Bearer <token>
  // Email travels as a URL path segment, NOT a query parameter.
  // KKU_API_EMPLOYEE_PATH is the path PREFIX; the email is appended
  // with `/${encodeURIComponent(email)}`.
  const employeePathPrefix =
    process.env.KKU_API_EMPLOYEE_PATH ?? '/v3/hr/employee/filter/email';
  const url = `${base.replace(/\/$/, '')}${employeePathPrefix}/${encodeURIComponent(email)}`;
  console.log(`[kku-api] employee lookup → ${url}`);

  const doFetch = async (bearer: string) =>
    fetch(url, {
      method: 'GET',
      headers: { authorization: `Bearer ${bearer}`, accept: 'application/json' },
    });

  let res = await doFetch(token).catch((err) => {
    throw new KkuApiError(
      `KKU API employee fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      undefined,
      err,
    );
  });

  // Token may have been revoked early. Drop cache + retry once.
  if (res.status === 401) {
    cached = null;
    const retryToken = await fetchToken();
    res = await doFetch(retryToken);
  }

  if (res.status === 404) {
    console.log(`[kku-api] employee lookup → 404 (no record)`);
    return null;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.log(`[kku-api] employee lookup → ${res.status}: ${text.slice(0, 200)}`);
    throw new KkuApiError(
      `KKU API employee endpoint ${res.status}: ${text.slice(0, 200)}`,
      res.status,
    );
  }
  console.log(`[kku-api] employee lookup → 200 (record returned)`);

  const json = await res.json().catch((err) => {
    throw new KkuApiError(`KKU API employee response not JSON`, res.status, err);
  });
  const parsed = EmployeeResponseRawSchema.safeParse(json);
  if (!parsed.success) {
    throw new KkuApiError(`KKU API employee schema mismatch: ${parsed.error.message}`);
  }
  return scrubPii(parsed.data as Record<string, unknown>);
}

// Convenience: derive a display name from whichever fields the API
// returned. Prefer Thai then English. Falls back to email when the
// record is unusually sparse.
export function deriveDisplayName(emp: KkuEmployee): string {
  const t = (s: string | null | undefined): string | null =>
    typeof s === 'string' && s.trim() ? s.trim() : null;
  const titleTh = t(emp.title);
  const fnTh = t(emp.firstname);
  const lnTh = t(emp.lastname);
  if (fnTh && lnTh) return [titleTh, fnTh, lnTh].filter(Boolean).join(' ');
  const titleEn = t(emp.title_eng);
  const fnEn = t(emp.firstname_eng);
  const lnEn = t(emp.lastname_eng);
  if (fnEn && lnEn) return [titleEn, fnEn, lnEn].filter(Boolean).join(' ');
  return t(emp.email) ?? '(unnamed)';
}
