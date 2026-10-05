import type { ApiMeta } from '@kku/shared';
import { apiFetchEnvelope } from '@/lib/api-client';

/** A chapter's data + envelope meta, or null when the endpoint fails. The
 *  failure is logged server-side and the chapter renders its own fallback,
 *  so one slow or broken chapter never breaks the page. */
export async function fetchChapter<T>(path: string): Promise<{ data: T; meta: ApiMeta } | null> {
  try {
    const env = await apiFetchEnvelope<T>(path);
    return env.error === null ? { data: env.data, meta: env.meta } : null;
  } catch (err) {
    console.error(`[executive-landscape] ${path} failed`, err);
    return null;
  }
}
