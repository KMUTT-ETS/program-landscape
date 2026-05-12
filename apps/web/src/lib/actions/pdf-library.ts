'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch } from '@/lib/api-client';

export type PdfLifecycleStatus = 'ACTIVE' | 'ARCHIVED' | 'DEPRECATED';

export async function setPdfLifecycleAction(
  pdfId: string,
  lifecycleStatus: PdfLifecycleStatus,
  note?: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await apiFetch(`/pdfs/${encodeURIComponent(pdfId)}/lifecycle`, {
      method: 'PATCH',
      body: JSON.stringify({ lifecycleStatus, note }),
    });
    revalidatePath('/admin/pdf-review');
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function deletePdfAction(
  pdfId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await apiFetch(`/pdfs/${encodeURIComponent(pdfId)}`, {
      method: 'DELETE',
    });
    revalidatePath('/admin/pdf-review');
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function reExtractPdfAction(
  pdfId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await apiFetch(`/pdfs/${encodeURIComponent(pdfId)}/re-extract`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    revalidatePath('/admin/pdf-review');
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
