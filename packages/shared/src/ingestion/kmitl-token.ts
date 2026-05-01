// ─────────────────────────────────────────────────────────────────────────────
// KMITL Skill Mapping API auth helpers.
//
// Two methods per the KMITL API Guideline (1.9.1-OBT, 2024-02):
//   - Method 1 (`buildDirectToken`): base64(clientId:secretKey). For trusted
//     server-to-server use only — the SECRET_KEY is in the token. This is
//     what the ingestion connector uses; the worker is server-side and the
//     env-var holding the secret never leaves the container.
//   - Method 2 (`buildEphemeralToken`): base64(clientId:sha256(clientId:
//     secretKey:timestamp):timestamp). 5-minute TTL. For ephemeral hand-off
//     to a less-trusted client (e.g., a debug page that needs to call the
//     API directly without ever holding the secret). Not used by the
//     connector itself; kept here so a future debug path can call it.
//
// Token shape gets passed as `Authorization: Bearer <token>`.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';

export interface KmitlCredentials {
  clientId: string;
  secretKey: string;
}

/** Method 1 — direct token. Server-to-server only. No expiry. */
export function buildDirectToken(creds: KmitlCredentials): string {
  if (!creds.clientId || !creds.secretKey) {
    throw new Error('KMITL credentials missing — set KMITL_SKILL_MAPPING_CLIENT_ID and KMITL_SKILL_MAPPING_SECRET_KEY');
  }
  return Buffer.from(`${creds.clientId}:${creds.secretKey}`, 'utf8').toString('base64');
}

/**
 * Method 2 — ephemeral token (5-min TTL). For untrusted clients.
 *
 * The hash combines `clientId:secretKey:timestamp`; the resulting public
 * token transports `clientId:hash:timestamp` so the recipient never sees
 * the secret. Pass `nowMs` for deterministic tests.
 */
export function buildEphemeralToken(
  creds: KmitlCredentials,
  nowMs: number = Date.now(),
): { token: string; expiresAtMs: number } {
  if (!creds.clientId || !creds.secretKey) {
    throw new Error('KMITL credentials missing — set KMITL_SKILL_MAPPING_CLIENT_ID and KMITL_SKILL_MAPPING_SECRET_KEY');
  }
  const timestamp = Math.floor(nowMs / 1000);
  const message = `${creds.clientId}:${creds.secretKey}:${timestamp}`;
  const hash = createHash('sha256').update(message).digest('hex');
  const publicMessage = `${creds.clientId}:${hash}:${timestamp}`;
  const token = Buffer.from(publicMessage, 'utf8').toString('base64');
  const expiresAtMs = nowMs + 5 * 60 * 1000;
  return { token, expiresAtMs };
}

/** Standard headers for any KMITL API call. */
export function buildKmitlHeaders(token: string): Record<string, string> {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
  };
}
