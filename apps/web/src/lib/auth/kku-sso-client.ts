// KKU SSONext API client — pure functions, no NextAuth dependency.
//
// SSONext is a custom KKU-internal protocol, NOT OIDC. Flow:
//
//   1. browser  →  GET  ${WEB_BASE}/login?app=<AppID>
//   2. redirect →  ${REDIRECT_URI}?code=<uuid>
//   3. server   →  POST ${API_BASE}/auth.token       (JSON body, JSON response)
//   4. server   →  POST ${API_BASE}/user.profile     (Bearer token)
//
// Both /auth.token and /user.profile responses use { ok: boolean, ... } and
// return HTTP 200 even on logical failure for the token endpoint — error path
// is `{ ok: false, error: "AUTH0001" }`. The probe in
// apps/web/scripts/probe-kku-sso.mjs verifies the wire shape end to end.

import { z } from 'zod';

export interface SsonextEnv {
  webBase: string;
  apiBase: string;
  appId: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  logoutRedirectUri: string | null;
}

export function readSsonextEnv(): SsonextEnv | null {
  const webBase = process.env.KKU_SSO_WEB_BASE;
  const apiBase = process.env.KKU_SSO_API_BASE;
  const appId = process.env.KKU_SSO_APP_ID;
  const clientId = process.env.KKU_SSO_CLIENT_ID;
  const clientSecret = process.env.KKU_SSO_CLIENT_SECRET;
  const redirectUri = process.env.KKU_SSO_REDIRECT_URI;
  if (!webBase || !apiBase || !appId || !clientId || !clientSecret || !redirectUri) {
    return null;
  }
  return {
    webBase: webBase.replace(/\/$/, ''),
    apiBase: apiBase.replace(/\/$/, ''),
    appId,
    clientId,
    clientSecret,
    redirectUri,
    logoutRedirectUri: process.env.KKU_SSO_LOGOUT_REDIRECT_URI ?? null,
  };
}

export function buildLoginUrl(env: SsonextEnv): string {
  const u = new URL(`${env.webBase}/login`);
  u.searchParams.set('app', env.appId);
  return u.toString();
}

export function buildLogoutUrl(env: SsonextEnv): string {
  const u = new URL(`${env.webBase}/logout`);
  u.searchParams.set('app', env.appId);
  return u.toString();
}

// ── Token exchange ────────────────────────────────────────────────────────
//
// Schema is intentionally permissive. The published KKU doc shows camelCase
// keys, but real-world OIDC-adjacent services often use snake_case in
// production. We accept BOTH on the token endpoint and normalise downstream.

const TokenRaw = z
  .object({
    ok: z.boolean().optional(),
    error: z.string().optional(),
    // accept both casings; pick whichever is non-empty in the normaliser
    accessToken: z.string().optional(),
    access_token: z.string().optional(),
    email: z.string().optional(),
    immutableId: z.string().optional(),
    immutable_id: z.string().optional(),
    citizenId: z.string().optional(),
    citizen_id: z.string().optional(),
    firstName: z.string().optional(),
    first_name: z.string().optional(),
    lastName: z.string().optional(),
    last_name: z.string().optional(),
    employeeId: z.string().optional(),
    employee_id: z.string().optional(),
  })
  .passthrough();

export interface SsonextTokenSuccess {
  ok: true;
  accessToken: string;
  email: string;
  immutableId: string;
  citizenId: string;
  firstName: string;
  lastName: string;
  employeeId: string;
}

function pick(...candidates: Array<string | undefined>): string {
  for (const c of candidates) if (c && c.length > 0) return c;
  return '';
}

export class SsonextProtocolError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'SsonextProtocolError';
  }
}

export async function exchangeCodeForToken(
  env: SsonextEnv,
  code: string,
): Promise<SsonextTokenSuccess> {
  let res: Response;
  try {
    res = await fetch(`${env.apiBase}/auth.token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code,
        redirectUrl: env.redirectUri,
        clientId: env.clientId,
        clientSecret: env.clientSecret,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    throw new SsonextProtocolError(
      `KKU SSO /auth.token unreachable: ${(err as Error).message}`,
      'NETWORK',
      err,
    );
  }

  if (res.status !== 200) {
    throw new SsonextProtocolError(
      `KKU SSO /auth.token returned HTTP ${res.status}`,
      'HTTP_' + res.status,
    );
  }

  const rawText = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(rawText);
  } catch {
    throw new SsonextProtocolError(
      `KKU SSO /auth.token returned non-JSON: ${rawText.slice(0, 300)}`,
      'NOT_JSON',
    );
  }
  const parsed = TokenRaw.safeParse(json);
  if (!parsed.success) {
    console.error(
      'KKU SSO /auth.token unexpected shape — raw response:',
      JSON.stringify(json),
    );
    throw new SsonextProtocolError(
      `KKU SSO /auth.token response shape invalid: ${JSON.stringify(json).slice(0, 300)}`,
      'BAD_SHAPE',
      parsed.error,
    );
  }

  const data = parsed.data;
  // Failure path: ok === false (or any explicit error string).
  if (data.ok === false || (data.error && !data.accessToken && !data.access_token)) {
    throw new SsonextProtocolError(
      `KKU SSO rejected the code: ${data.error ?? 'unknown'}`,
      data.error ?? 'UNKNOWN',
    );
  }

  const accessToken = pick(data.accessToken, data.access_token);
  if (!accessToken) {
    console.error(
      'KKU SSO /auth.token returned ok=true but no access token. Raw:',
      JSON.stringify(json),
    );
    throw new SsonextProtocolError(
      `KKU SSO /auth.token did not include an access token: ${JSON.stringify(json).slice(0, 300)}`,
      'NO_ACCESS_TOKEN',
    );
  }

  return {
    ok: true,
    accessToken,
    email: pick(data.email),
    immutableId: pick(data.immutableId, data.immutable_id),
    citizenId: pick(data.citizenId, data.citizen_id),
    firstName: pick(data.firstName, data.first_name),
    lastName: pick(data.lastName, data.last_name),
    employeeId: pick(data.employeeId, data.employee_id),
  };
}

// ── Profile fetch ─────────────────────────────────────────────────────────
//
// Same posture as the token endpoint: be permissive on field names and
// shape. KKU's UAT response sometimes wraps the profile in `profile`,
// sometimes flattens it; sometimes uses camelCase, sometimes snake_case;
// sometimes omits `ok`. Anything that gives us SOME profile-shaped object
// is accepted, normalised, and passed downstream.

export interface SsonextProfile {
  email: string;
  userId: string;
  type: string;
  citizenId: string;
  title: string;
  firstname: string;
  lastname: string;
  titleEng: string;
  firstnameEng: string;
  lastnameEng: string;
  facultyName: string;
  positionName: string;
  positionTypeName: string;
  levelId: string;
  levelName: string;
  gender: string;
  workline: string;
  phoneNumber: string;
  personStatus: string;
  lastVerify: string;
  // Pass-through bag for unknown fields, surfaced in audit logs only.
  _raw?: Record<string, unknown>;
}

function asString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

function normaliseProfile(payload: unknown): SsonextProfile | null {
  if (!payload || typeof payload !== 'object') return null;
  const root = payload as Record<string, unknown>;
  // Locate the inner profile object — could be at .profile, .data, .user
  // or the root itself if KKU flattens it.
  const candidates: Array<Record<string, unknown> | undefined> = [
    root.profile && typeof root.profile === 'object' ? (root.profile as Record<string, unknown>) : undefined,
    root.data && typeof root.data === 'object' ? (root.data as Record<string, unknown>) : undefined,
    root.user && typeof root.user === 'object' ? (root.user as Record<string, unknown>) : undefined,
    root,
  ];
  for (const p of candidates) {
    if (!p) continue;
    // Accept any object that has at least an email or a userId.
    const hasEmail = typeof p.email === 'string' && p.email.length > 0;
    const hasUserId = typeof p.userId === 'string' || typeof p.user_id === 'string';
    const hasName =
      typeof p.firstname === 'string' || typeof p.first_name === 'string' ||
      typeof p.firstName === 'string';
    if (!hasEmail && !hasUserId && !hasName) continue;
    return {
      email: asString(p.email),
      userId: asString(p.userId ?? p.user_id),
      type: asString(p.type),
      citizenId: asString(p.citizenId ?? p.citizen_id),
      title: asString(p.title ?? p.titleTh),
      firstname: asString(p.firstname ?? p.first_name ?? p.firstName),
      lastname: asString(p.lastname ?? p.last_name ?? p.lastName),
      titleEng: asString(p.titleEng ?? p.title_eng ?? p.titleEn),
      firstnameEng: asString(p.firstnameEng ?? p.firstname_eng ?? p.firstNameEn),
      lastnameEng: asString(p.lastnameEng ?? p.lastname_eng ?? p.lastNameEn),
      facultyName: asString(p.facultyName ?? p.faculty_name ?? p.faculty),
      positionName: asString(p.positionName ?? p.position_name ?? p.position),
      positionTypeName: asString(p.positionTypeName ?? p.position_type_name ?? p.positionType),
      levelId: asString(p.levelId ?? p.level_id),
      levelName: asString(p.levelName ?? p.level_name ?? p.level),
      gender: asString(p.gender),
      workline: asString(p.workline ?? p.work_line),
      phoneNumber: asString(p.phoneNumber ?? p.phone_number ?? p.phone),
      personStatus: asString(p.personStatus ?? p.person_status ?? p.status),
      lastVerify: asString(p.lastVerify ?? p.last_verify),
      _raw: p,
    };
  }
  return null;
}

export async function fetchProfile(
  env: SsonextEnv,
  accessToken: string,
): Promise<SsonextProfile> {
  let res: Response;
  try {
    res = await fetch(`${env.apiBase}/user.profile`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    throw new SsonextProtocolError(
      `KKU SSO /user.profile unreachable: ${(err as Error).message}`,
      'NETWORK',
      err,
    );
  }
  if (res.status === 401) {
    throw new SsonextProtocolError(
      'KKU SSO /user.profile rejected the access token',
      'UNAUTHORIZED',
    );
  }
  if (res.status !== 200) {
    throw new SsonextProtocolError(
      `KKU SSO /user.profile returned HTTP ${res.status}`,
      'HTTP_' + res.status,
    );
  }
  const rawText = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(rawText);
  } catch {
    throw new SsonextProtocolError(
      `KKU SSO /user.profile returned non-JSON: ${rawText.slice(0, 300)}`,
      'NOT_JSON',
    );
  }
  const profile = normaliseProfile(json);
  if (!profile) {
    console.error(
      'KKU SSO /user.profile unexpected shape — raw response:',
      JSON.stringify(json),
    );
    throw new SsonextProtocolError(
      `KKU SSO /user.profile response shape invalid: ${JSON.stringify(json).slice(0, 300)}`,
      'BAD_SHAPE',
    );
  }
  return profile;
}
