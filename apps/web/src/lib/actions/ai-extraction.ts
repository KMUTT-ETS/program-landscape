'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch } from '@/lib/api-client';

export async function approveAiExtractionAction(
  id: string,
  reviewNotes: string | undefined,
  editedPayload: Record<string, unknown> | undefined,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await apiFetch(`/ai/extractions/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify({ reviewNotes, editedPayload }),
    });
    revalidatePath('/admin/extraction-review');
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function rejectAiExtractionAction(
  id: string,
  reviewNotes: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await apiFetch(`/ai/extractions/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reviewNotes }),
    });
    revalidatePath('/admin/extraction-review');
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
