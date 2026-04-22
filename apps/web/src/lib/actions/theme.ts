'use server';

import { apiFetch } from '@/lib/api-client';
import { ThemePreferenceSchema, type ThemePreference } from '@kku/shared';

export async function setThemePreferenceAction(
  themePreference: ThemePreference,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const parsed = ThemePreferenceSchema.safeParse(themePreference);
  if (!parsed.success) {
    return { ok: false, message: 'Invalid theme preference' };
  }
  try {
    await apiFetch<{ id: string; themePreference: ThemePreference }>(
      '/me/theme',
      {
        method: 'PATCH',
        body: JSON.stringify({ themePreference: parsed.data }),
      },
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
