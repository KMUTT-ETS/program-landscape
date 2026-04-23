'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch } from '@/lib/api-client';

export async function generateBriefAction(input: {
  scope: string;
  scopeId: string | null;
  style: 'thai-narrative' | 'executive-summary' | 'full-deep-dive';
}): Promise<
  | { ok: true; text: string; confidence: number; aiInferenceId: string | null }
  | { ok: false; message: string }
> {
  try {
    const r = await apiFetch<{
      text: string;
      confidence: number;
      aiInferenceId: string | null;
    }>('/cockpit/brief', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return { ok: true, text: r.text, confidence: r.confidence, aiInferenceId: r.aiInferenceId };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function exportCouncilPackAction(input: {
  scope: string;
  scopeId: string | null;
}): Promise<{ ok: true; pdfUrl: string } | { ok: false; message: string }> {
  try {
    const r = await apiFetch<{ pdfUrl: string }>('/cockpit/export', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return { ok: true, pdfUrl: r.pdfUrl };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function saveViewAction(input: {
  name: string;
  viewMode: 'heatmap' | 'matrix' | 'rollup';
  scope: string;
  scopeId: string | null;
  filters: Record<string, unknown>;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await apiFetch('/cockpit/saved-views', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    revalidatePath('/cockpit');
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function touchSavedViewAction(id: string): Promise<void> {
  try {
    await apiFetch(`/cockpit/saved-views/${id}/touch`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  } catch {
    // ignore — UX is best-effort
  }
}

export async function deleteSavedViewAction(
  id: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await apiFetch(`/cockpit/saved-views/${id}`, { method: 'DELETE' });
    revalidatePath('/cockpit');
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
