'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch } from '@/lib/api-client';

// Server actions used by the /admin/data-sources page. Each one:
//   - calls the NestJS endpoint via apiFetch (adds the bearer token)
//   - revalidates /admin/data-sources so the page re-fetches its lists
//   - returns { ok, message? } for the client to toast

export async function runNowAction(
  dataSourceId: string,
): Promise<{ ok: true; jobId: string } | { ok: false; message: string }> {
  try {
    const r = await apiFetch<{ jobId: string }>(`/data-sources/${dataSourceId}/run`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    revalidatePath('/admin/data-sources');
    return { ok: true, jobId: r.jobId };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function patchCadenceAction(
  dataSourceId: string,
  cadenceCron: string | null,
  scheduleEnabled: boolean,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await apiFetch(`/data-sources/${dataSourceId}`, {
      method: 'PATCH',
      body: JSON.stringify({ cadenceCron, scheduleEnabled }),
    });
    revalidatePath('/admin/data-sources');
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function bulkStatusAction(
  ids: string[],
  status: 'active' | 'paused',
): Promise<{ ok: true; updated: number } | { ok: false; message: string }> {
  try {
    const r = await apiFetch<{ updated: number }>('/data-sources/bulk/status', {
      method: 'PATCH',
      body: JSON.stringify({ ids, status }),
    });
    revalidatePath('/admin/data-sources');
    return { ok: true, updated: r.updated };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
