'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch } from '@/lib/api-client';

// Server actions for /admin/pdf-review — each wraps a NestJS call +
// revalidates the review page so the UI refreshes.

export async function approveExtractionAction(
  extractionId: string,
  reviewNotes: string | undefined,
  editedPayload: Record<string, unknown> | undefined,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await apiFetch(`/pdfs/extractions/${extractionId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ reviewNotes, editedPayload }),
    });
    revalidatePath('/admin/pdf-review');
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function rejectExtractionAction(
  extractionId: string,
  reviewNotes: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await apiFetch(`/pdfs/extractions/${extractionId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reviewNotes }),
    });
    revalidatePath('/admin/pdf-review');
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function reExtractAction(
  pdfDocumentId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await apiFetch(`/pdfs/${pdfDocumentId}/re-extract`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    revalidatePath('/admin/pdf-review');
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
