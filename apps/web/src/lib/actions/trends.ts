'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch } from '@/lib/api-client';

export async function markReviewedAction(
  signalId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await apiFetch(`/trends/${signalId}/mark-reviewed`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    revalidatePath(`/trends/${signalId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function annotateTrendAction(input: {
  signalId: string;
  bodyEn?: string;
  bodyTh?: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await apiFetch(`/trends/${input.signalId}/annotate`, {
      method: 'POST',
      body: JSON.stringify({
        bodyEn: input.bodyEn,
        bodyTh: input.bodyTh,
        kind: 'comment',
      }),
    });
    revalidatePath(`/trends/${input.signalId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function subscribeAction(input: {
  filterType: 'program' | 'skill' | 'sector' | 'signal_type';
  filterValue: string;
  minImpactScore?: number;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await apiFetch('/notifications/subscriptions', {
      method: 'POST',
      body: JSON.stringify({
        filterType: input.filterType,
        filterValue: input.filterValue,
        minImpactScore: input.minImpactScore ?? 0,
      }),
    });
    revalidatePath('/inbox');
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function markNotificationRead(
  id: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await apiFetch(`/notifications/${id}/mark-read`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    revalidatePath('/inbox');
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function markAllNotificationsRead(): Promise<
  { ok: true } | { ok: false; message: string }
> {
  try {
    await apiFetch('/notifications/mark-all-read', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    revalidatePath('/inbox');
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
