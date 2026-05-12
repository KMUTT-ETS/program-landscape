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
