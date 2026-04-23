'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch } from '@/lib/api-client';

export async function regenerateNarrativeAction(
  programId: string,
  style: 'thai-narrative' | 'executive-summary' | 'full-deep-dive',
): Promise<
  | { ok: true; text: string; aiInferenceId: string | null }
  | { ok: false; message: string }
> {
  try {
    const r = await apiFetch<{ text: string; aiInferenceId: string | null }>(
      `/programs/${programId}/narrative`,
      {
        method: 'POST',
        body: JSON.stringify({ style }),
      },
    );
    revalidatePath(`/programs/${programId}`);
    return { ok: true, text: r.text, aiInferenceId: r.aiInferenceId };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function submitDisagreementAction(input: {
  programId: string;
  sectionKey: string;
  aiInferenceId?: string;
  bodyEn?: string;
  bodyTh?: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await apiFetch(`/programs/${input.programId}/disagreements`, {
      method: 'POST',
      body: JSON.stringify({
        sectionKey: input.sectionKey,
        aiInferenceId: input.aiInferenceId,
        bodyEn: input.bodyEn,
        bodyTh: input.bodyTh,
      }),
    });
    revalidatePath(`/programs/${input.programId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
