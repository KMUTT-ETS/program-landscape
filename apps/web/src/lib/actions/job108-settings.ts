'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch } from '@/lib/api-client';

// ─────────────────────────────────────────────────────────────────────────
// Job-108 connector settings — server actions backing the
// /admin/external/ai-search page's "Job-108 (government announcements)"
// panel (Task 17). Mirrors lib/actions/external-ai.ts's shape exactly:
// { ok: true, data } | { ok: false, message }, so the panel can render an
// apiFetch validation-failure message inline next to the field that caused
// it rather than in a toast.
// ─────────────────────────────────────────────────────────────────────────

export interface Job108SettingsView {
  sitemapUrl: string;
  requestSpacingMs: number;
  maxAnnouncementsPerRun: number;
  defaultWindowMonths: number;
}

export type Job108SettingsPatch = Partial<Job108SettingsView>;

const ADMIN_PATH = '/admin/external/ai-search';

export async function getJob108SettingsAction(): Promise<
  { ok: true; data: Job108SettingsView } | { ok: false; message: string }
> {
  try {
    const data = await apiFetch<Job108SettingsView>('/admin/job108-settings');
    return { ok: true, data };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function updateJob108SettingsAction(
  patch: Job108SettingsPatch,
): Promise<{ ok: true; data: Job108SettingsView } | { ok: false; message: string }> {
  try {
    const data = await apiFetch<Job108SettingsView>('/admin/job108-settings', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    revalidatePath(ADMIN_PATH);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
