'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch } from '@/lib/api-client';

export type ExternalAiSourceKind = 'URL_LIST' | 'WEB_SEARCH';
export type ExternalAiSourceStatus = 'ACTIVE' | 'PAUSED' | 'DISABLED';
export type ExternalAiSignalType = 'POLICY' | 'RESEARCH' | 'MARKET' | 'TECH' | 'NEWS';

export interface CreateExternalAiSourceInput {
  slug: string;
  name: string;
  description?: string;
  kind: ExternalAiSourceKind;
  configJson: Record<string, unknown>;
  cadenceCron?: string;
  signalType?: ExternalAiSignalType;
  defaultImpact?: number;
}

export interface UpdateExternalAiSourceInput {
  name?: string;
  description?: string | null;
  configJson?: Record<string, unknown>;
  cadenceCron?: string | null;
  signalType?: ExternalAiSignalType;
  defaultImpact?: number;
}

const ADMIN_PATH = '/admin/external/ai-search';

export async function createExternalAiSourceAction(
  input: CreateExternalAiSourceInput,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await apiFetch('/admin/external-ai-sources', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    revalidatePath(ADMIN_PATH);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function updateExternalAiSourceAction(
  id: string,
  input: UpdateExternalAiSourceInput,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await apiFetch(`/admin/external-ai-sources/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
    revalidatePath(ADMIN_PATH);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function setExternalAiSourceStatusAction(
  id: string,
  status: ExternalAiSourceStatus,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await apiFetch(`/admin/external-ai-sources/${encodeURIComponent(id)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    revalidatePath(ADMIN_PATH);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function deleteExternalAiSourceAction(
  id: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await apiFetch(`/admin/external-ai-sources/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    revalidatePath(ADMIN_PATH);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function runExternalAiSourceNowAction(
  id: string,
): Promise<
  | {
      ok: true;
      result: {
        fetched: number;
        summarised: number;
        skipped: number;
        failures: number;
        signals: Array<{ id: string; title: string; impactScore: number }>;
      };
    }
  | { ok: false; message: string }
> {
  try {
    const result = await apiFetch<{
      fetched: number;
      summarised: number;
      skipped: number;
      failures: number;
      signals: Array<{ id: string; title: string; impactScore: number }>;
    }>(`/admin/external-ai-sources/${encodeURIComponent(id)}/run-now`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    revalidatePath(ADMIN_PATH);
    return { ok: true, result };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
