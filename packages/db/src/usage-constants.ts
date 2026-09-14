// Leaf module — no imports on purpose. `retention.ts` reads these at module
// top level, and `usage.ts` sits inside the barrel's import cycle (it imports
// `prisma` from './index', which re-exports './retention'). A top-level read
// of a `./usage` export from inside that cycle throws "cannot access before
// initialization" whenever `usage.ts` is the entry module (a tsx probe, a
// test importing it directly). Constants that other modules need at import
// time live here; `usage.ts` re-exports them so callers see one surface.

/** Raw page_views rows are kept this many whole Bangkok days, then rolled up. */
export const RAW_RETENTION_DAYS = 120;

export const USAGE_WINDOWS = [7, 30, 90, 365] as const;
export type UsageWindowDays = (typeof USAGE_WINDOWS)[number];

export const ADMIN_ROLES = ['SUPER_ADMIN', 'SYSTEM_ADMIN'] as const;
