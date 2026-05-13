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

export interface BulkApproveResult {
  totalPending: number;
  approved: number;
  materialised: number;
  errors: Array<{ id: string; kind: string; message: string }>;
}

export async function bulkApproveAiExtractionsAction(): Promise<
  { ok: true; result: BulkApproveResult } | { ok: false; message: string }
> {
  try {
    const result = await apiFetch<BulkApproveResult>(
      '/ai/extractions/approve-all-pending',
      { method: 'POST', body: JSON.stringify({}) },
    );
    revalidatePath('/admin/extraction-review');
    revalidatePath('/admin/queues');
    return { ok: true, result };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function bulkApprovePdfExtractionsAction(): Promise<
  | { ok: true; result: { totalPending: number; approved: number } }
  | { ok: false; message: string }
> {
  try {
    const result = await apiFetch<{ totalPending: number; approved: number }>(
      '/pdfs/extractions/approve-all-pending',
      { method: 'POST', body: JSON.stringify({}) },
    );
    revalidatePath('/admin/pdf-review');
    revalidatePath('/admin/queues');
    return { ok: true, result };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
