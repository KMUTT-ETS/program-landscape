'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch } from '@/lib/api-client';

// Server action for the class-offerings (class GPA) refresh button on
// /admin/dashboard-data-fetch. Enqueues a RUN_CLASS_OFFERINGS_LINK
// BullMQ job; the ingestion worker spawns the bundled link-class-offerings
// script which re-loads class_offerings + class_offering_teachers from
// POWERBI.VIEW_CLASS_OPEN_GROUP_OFFICER (incl. grade columns + class_gpa).

export async function refreshClassOfferingsAction(): Promise<
  { ok: true; jobId: string } | { ok: false; message: string }
> {
  try {
    const r = await apiFetch<{ jobId: string }>('/education/class-offerings/refresh', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    revalidatePath('/admin/dashboard-data-fetch');
    return { ok: true, jobId: r.jobId };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
