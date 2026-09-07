'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch } from '@/lib/api-client';

export async function setAiModelOverrideAction(
  methodPrefix: string,
  modelId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await apiFetch(`/admin/ai-settings/method/${encodeURIComponent(methodPrefix)}`, {
      method: 'PUT',
      body: JSON.stringify({ modelId }),
    });
    revalidatePath('/admin/app/ai-settings');
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function clearAiModelOverrideAction(
  methodPrefix: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await apiFetch(`/admin/ai-settings/method/${encodeURIComponent(methodPrefix)}`, {
      method: 'DELETE',
    });
    revalidatePath('/admin/app/ai-settings');
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export interface SwapCandidate {
  methodPrefix: string;
  effectiveModel: string;
  isPinned: boolean;
  lockedModel: string | null;
}

export interface SwapPlan {
  rewrite: SwapCandidate[];
  create: SwapCandidate[];
  skipped: SwapCandidate[];
}

// Bulk "replace every method using model X" action. `apply: false` (the
// default) only previews the plan — nothing is written. `apply: true`
// executes it in one transaction on the API side.
export async function swapAiModelsAction(
  fromModelId: string,
  toModelId: string,
  apply: boolean,
): Promise<
  | { ok: true; plan: SwapPlan; applied: boolean }
  | { ok: false; message: string }
> {
  try {
    const res = await apiFetch<{ plan: SwapPlan; applied: boolean }>('/admin/ai-settings/swap', {
      method: 'POST',
      body: JSON.stringify({ fromModelId, toModelId, apply }),
    });
    if (apply) revalidatePath('/admin/app/ai-settings');
    return { ok: true, plan: res.plan, applied: res.applied };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

// Re-fetch the Google Gemini model list from OpenRouter (discovery only —
// model name, description, pricing). `ok:true` with a `warning` means
// OpenRouter was unreachable but the existing catalog is intact.
export async function refreshAiModelsAction(): Promise<
  | { ok: true; count: number; lastFetchedAt: string | null; warning?: string }
  | { ok: false; message: string }
> {
  try {
    const res = await apiFetch<{
      ok: boolean;
      count: number;
      error?: string;
      lastFetchedAt: string | null;
    }>('/admin/ai-settings/refresh-models', { method: 'POST' });
    revalidatePath('/admin/app/ai-settings');
    return {
      ok: true,
      count: res.count,
      lastFetchedAt: res.lastFetchedAt,
      warning: res.ok ? undefined : res.error,
    };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
