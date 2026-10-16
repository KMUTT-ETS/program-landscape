// Node-only half of instrumentation.ts. Kept in its own module so the edge
// compile of the instrumentation hook never reaches @kku/db (pg, Prisma) —
// instrumentation.ts imports this file only inside the
// `NEXT_RUNTIME === 'nodejs'` branch, which Next strips from the edge build.
import { loadOrganization, startOrganizationRefresh } from '@kku/db';

export async function loadOrganizationAtBoot(): Promise<void> {
  try {
    const inst = await loadOrganization();
    startOrganizationRefresh();
    console.info(
      `[organization] web: profile ${inst ? 'loaded' : 'not configured — fill in /admin/organization'}`,
    );
  } catch (err) {
    // A database blip at boot must not kill the web server. Every entry
    // point that reads the identity awaits ensureOrganizationLoaded()
    // (@kku/db), which retries the load on first use.
    console.error(
      `[organization] web: boot-time load failed, will retry on first use: ${(err as Error).message}`,
    );
  }
}
