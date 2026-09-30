'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { apiFetch, type ApiFetchError } from '@/lib/api-client';
import { can, type SessionUser } from '@kku/shared';
import type {
  ApiClientDetail,
  ApiClientInput,
  ApiClientKeyView,
  ApiClientPatch,
  ApiClientView,
  IssuedApiKey,
} from '@kku/db';

// Server actions for /admin/external/api-clients. Each returns a
// discriminated result and never throws: a failed server action is still an
// HTTP 200, so a throw would surface as an opaque error boundary instead of
// the API's own message (e.g. "An API client with this name already exists").

const PAGE = '/admin/external/api-clients';
type Result<T> = { ok: true; data: T } | { ok: false; message: string };

/** The API's message, plus the first Zod issue when it rejected the body —
 *  "Request validation failed" alone does not tell an admin which field. */
function errorMessage(e: unknown): string {
  const err = e as Partial<ApiFetchError>;
  const base = err.message ?? 'Request failed';
  const issues = err.details?.issues;
  if (Array.isArray(issues) && issues.length > 0) {
    const first = issues[0] as { path?: unknown; message?: unknown };
    const where = Array.isArray(first.path) && first.path.length > 0 ? first.path.join('.') : null;
    const what = typeof first.message === 'string' ? first.message : null;
    if (what) return `${base}: ${where ? `${where} ` : ''}${what}`;
  }
  return base;
}

async function guard(): Promise<string | null> {
  const session = await auth();
  const user = session?.user as SessionUser | undefined;
  return user && can(user, 'api_clients:admin') ? null : 'Not permitted';
}

async function run<T>(fn: () => Promise<T>): Promise<Result<T>> {
  const denied = await guard();
  if (denied) return { ok: false, message: denied };
  try {
    const data = await fn();
    revalidatePath(PAGE);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, message: errorMessage(e) };
  }
}

export async function createApiClientAction(
  input: ApiClientInput,
): Promise<Result<{ id: string; client: ApiClientView; key: IssuedApiKey }>> {
  return run(() =>
    apiFetch<{ id: string; client: ApiClientView; key: IssuedApiKey }>('/admin/api-clients', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  );
}

export async function updateApiClientAction(id: string, patch: ApiClientPatch): Promise<Result<ApiClientView>> {
  return run(() =>
    apiFetch<ApiClientView>(`/admin/api-clients/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  );
}

export async function issueApiKeyAction(id: string, expiresAt: string | null): Promise<Result<IssuedApiKey>> {
  return run(() =>
    apiFetch<IssuedApiKey>(`/admin/api-clients/${encodeURIComponent(id)}/keys`, {
      method: 'POST',
      body: JSON.stringify({ expiresAt }),
    }),
  );
}

export async function revokeApiKeyAction(id: string, keyId: string, reason: string): Promise<Result<ApiClientKeyView>> {
  return run(() =>
    apiFetch<ApiClientKeyView>(
      `/admin/api-clients/${encodeURIComponent(id)}/keys/${encodeURIComponent(keyId)}/revoke`,
      { method: 'POST', body: JSON.stringify({ reason }) },
    ),
  );
}

export async function getApiClientDetailAction(id: string): Promise<Result<ApiClientDetail>> {
  const denied = await guard();
  if (denied) return { ok: false, message: denied };
  try {
    return { ok: true, data: await apiFetch<ApiClientDetail>(`/admin/api-clients/${encodeURIComponent(id)}`) };
  } catch (e) {
    return { ok: false, message: errorMessage(e) };
  }
}
