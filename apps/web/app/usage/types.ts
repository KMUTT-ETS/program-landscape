import type { ApiMeta } from '@kku/shared';

// ─────────────────────────────────────────────────────────────────────────
// Shape-only mirrors of the /usage responses.
//
// These are NOT re-exports of the `@kku/db` interfaces, and deliberately so:
// those carry `Date` on `window.from`, `lastSeen`, `startedAt` and so on,
// while everything here has already been through `JSON.stringify` on the api
// side, so every one of those fields arrives as an ISO string. Mirroring the
// server types directly would typecheck and then throw at runtime the first
// time someone called `.getTime()` on one.
//
// The source of truth for the field names is `packages/db/src/usage.ts`
// (`UsageSummary`, `ModuleUsage`, `ProgramUsage`, `RoleUsage`,
// `ViewerFacultyUsage`, `ActionUsage`, `UserUsageRow`, `UserTimeline`,
// `ProgramViewer`). `medianDwellMs` on the summary is added by
// `UsageService.summary()`, not by `usageSummary()`.
// ─────────────────────────────────────────────────────────────────────────

/** One `{ data, meta }` envelope, already unwrapped from `{ …, error }`. */
export interface Enveloped<T> {
  data: T;
  meta: ApiMeta;
}

/** One row of the faculty catalogue, for the by-programme filter's options. */
export interface FacultyOptionT {
  id: string;
  nameEn: string;
  nameTh: string;
}

/**
 * Fallback provenance for a card whose envelope never arrived.
 *
 * A section that failed to load still has to carry a provenance button —
 * Council-readiness rule 1 is about the SURFACE, not about the happy path,
 * and a card that quietly loses its button on the one render where the
 * reader most needs to ask "where would this have come from?" is the worst
 * moment to drop it. The sources are the two the api names for every /usage
 * endpoint (`USAGE_SOURCES` in apps/api/src/usage/usage.controller.ts); the
 * caveats are empty because the page's own are merged in by the caller.
 */
export const USAGE_FALLBACK_META: ApiMeta = {
  freshnessDate: null,
  sources: [
    { id: 'page_views', name: 'Page views recorded in-app' },
    { id: 'audit_logs', name: 'Sign-ins and actions from the audit log' },
  ],
  caveats: [],
};

/**
 * What the drawer must say beyond the api's own caveats.
 *
 * A function rather than a constant because two of these sentences are only
 * true of the controls the reader currently has set: "Exclude admin accounts"
 * changes what every figure counts, and the retention boundary is a number
 * the database owns. A static caveat list would describe a page other than
 * the one on screen the moment either moved — and a caveat that is subtly
 * wrong about its own figures is worse than none, because it is read as the
 * authority on them.
 *
 * It lives here rather than in page.tsx so a test can call it without pulling
 * in the server page's dependency graph (auth, Prisma, the api client) — this
 * module imports nothing but a type.
 */
export function pageCaveats(o: { rawRetentionDays: number; excludeAdmins: boolean }): string[] {
  return [
    `Raw page views are kept ${o.rawRetentionDays} days. Anything older comes from the daily roll-up, which keeps counts per user, page and programme but not timestamps — so dwell and the per-person timeline stop at that boundary.`,
    'Sign-ins are read from the audit log for the whole window, never from the page-view roll-up, so sign-in counts stay complete past that boundary.',
    o.excludeAdmins
      ? 'Exclude admin accounts is ON for these figures: SUPER_ADMIN and SYSTEM_ADMIN activity is hidden from every one of them.'
      : 'Exclude admin accounts is OFF for these figures: SUPER_ADMIN and SYSTEM_ADMIN activity is counted alongside everyone else’s.',
    'A view rendered while an administrator was impersonating someone is never counted, for either account.',
    'A session is a run of one person’s views with no gap longer than 30 minutes. Dwell is the time from a view to that person’s next one, so the last view of a session contributes none. Days are Asia/Bangkok days.',
    '“Last seen” is the most recent raw page view. It is not limited to the selected window, and it is blank once that view passes the raw-retention boundary — which is not the same as never having been active.',
    'The access log lists at most 500 people, busiest first.',
    'Aggregate figures are served from a 5-minute cache on the api and can be up to five minutes older than the freshness stamp; the access log and the two drill-down panels are read live.',
  ];
}

/**
 * The api's own caveats and the page's, with only the true duplicates dropped.
 *
 * The rule is deliberately narrow: an api caveat is dropped only when one of
 * the page's is, after normalisation, a prefix of it or it of them — i.e. one
 * genuinely says no more than the other. Anything that merely OPENS the same
 * way is kept, both halves.
 *
 * The earlier six-word-prefix rule failed exactly where it mattered: the api
 * and the page both begin their session caveat "A session is a run of…", so
 * the api's was dropped — and with it the only sentence on the page that
 * defines dwell, which the median-dwell figure in the summary band depends on
 * being defined. Losing a definition is a far worse outcome than printing a
 * boundary twice in two wordings.
 */
export function mergeCaveats(api: readonly string[], page: readonly string[]): string[] {
  const normalise = (s: string): string =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  const pageNormalised = page.map(normalise);
  const saysNoMore = (c: string): boolean => {
    const a = normalise(c);
    return pageNormalised.some((p) => p.startsWith(a) || a.startsWith(p));
  };
  return [...api.filter((c) => !saysNoMore(c)), ...page];
}

/** The api caps `facultyId` at 64 characters and `q` at 80. Over-long values
 *  are dropped rather than truncated: a sliced id is a DIFFERENT id, and
 *  filtering by it would quietly answer a question nobody asked. */
function param(raw: string | undefined, max: number): string | null {
  const value = raw?.trim() ?? '';
  if (value === '' || value.length > max) return null;
  return value;
}

/** Everything the page reads out of its own URL. */
export interface UsageParams {
  days: number;
  excludeAdmins: boolean;
  /** The window the two drill-down panels may ask for — see `UsageData`. */
  detailDays: number;
  facultyId: string | null;
  q: string | null;
}

/**
 * Reads the page's state out of its query string.
 *
 * Separated from the server component so it can be tested directly: every one
 * of these is a fallback that only ever runs on input nobody types by hand —
 * `?days=abc` must not reach the api as NaN, `?days=365` must narrow the
 * DRILL-DOWN window because the detail endpoints read raw page views that the
 * retention sweep has since removed, and an over-long id must be dropped
 * rather than sliced.
 *
 * `windows` and `rawRetentionDays` are parameters rather than imports so this
 * module goes on depending on nothing but a type; page.tsx passes the real
 * `USAGE_WINDOWS` and `RAW_RETENTION_DAYS` from `@kku/db`.
 */
export function resolveUsageParams(
  sp: { days?: string; excludeAdmins?: string; facultyId?: string; q?: string },
  windows: readonly number[],
  rawRetentionDays: number,
): UsageParams {
  const requested = Number(sp.days);
  const days = windows.includes(requested) ? requested : 30;
  const withinRetention = windows.filter((d) => d <= rawRetentionDays);
  const detailDays =
    days <= rawRetentionDays || withinRetention.length === 0 ? days : Math.max(...withinRetention);
  return {
    days,
    excludeAdmins: sp.excludeAdmins !== 'false',
    detailDays,
    facultyId: param(sp.facultyId, 64),
    q: param(sp.q, 80),
  };
}

export interface UsageWindowT {
  days: number;
  from: string;
  to: string;
  prevFrom: string;
  /** RAW_RETENTION_DAYS before now — the raw/roll-up horizon. */
  rawFrom: string;
  /** Where roll-ups stop and raw rows begin, or null when the window is all raw. */
  rollupFrom: string | null;
}

export interface UsageTotals {
  activeUsers: number;
  views: number;
  sessions: number;
  signins: number;
  aiCalls: number;
}

export interface UsageSummaryT {
  window: UsageWindowT;
  /** Bangkok day (YYYY-MM-DD) of the first page view ever recorded, or null. */
  recordedSince: string | null;
  signinsToday: number;
  medianDwellMs: number | null;
  current: UsageTotals;
  previous: UsageTotals;
  /** Last 30 Bangkok days, oldest first — independent of the selected window. */
  dailyActiveUsers: Array<{ day: string; users: number; signins: number }>;
}

export interface ModuleUsageT {
  module: string;
  views: number;
  users: number;
  sessions: number;
  medianDwellMs: number | null;
}

export interface ProgramUsageT {
  programId: string;
  code: string | null;
  nameEn: string | null;
  nameTh: string | null;
  facultyTh: string | null;
  views: number;
  users: number;
}

export interface RoleUsageT {
  role: string;
  users: number;
  views: number;
  sessions: number;
  signins: number;
}

/** `ViewerFacultyUsage` — the viewer's OWN faculty, not the faculty they read about. */
export interface FacultyUsageT {
  facultyId: string | null;
  nameTh: string | null;
  nameEn: string | null;
  users: number;
  views: number;
}

export interface ActionUsageT {
  /** `ActionFamily` on the server; a plain string here so a new family renders. */
  family: string;
  count: number;
  users: number;
}

export interface UserUsageT {
  userId: string;
  name: string | null;
  email: string;
  role: string;
  facultyTh: string | null;
  /** ISO timestamp — `Date | null` on the server. */
  lastSeen: string | null;
  views: number;
  sessions: number;
  signins: number;
  actions: number;
}

export interface TimelineEventT {
  at: string;
  kind: 'view' | 'signin' | 'action';
  label: string;
  path?: string;
  programId?: string | null;
  action?: string;
}

export interface UserTimelineT {
  user: { id: string; name: string | null; email: string; role: string };
  days: Array<{
    day: string;
    sessions: Array<{ startedAt: string; endedAt: string; events: TimelineEventT[] }>;
  }>;
}

export interface ProgramViewerT {
  userId: string;
  name: string | null;
  email: string;
  role: string;
  views: number;
  lastSeen: string | null;
}

export interface UsageData {
  days: number;
  excludeAdmins: boolean;
  /** `?facultyId=` — narrows the by-programme card to one faculty's programmes. */
  facultyId: string | null;
  /** `?q=` — narrows the access log to names/emails matching this term. */
  q: string | null;
  /**
   * The faculty catalogue, for the by-programme filter's options. Named
   * apart from `faculties` below, which is the by-VIEWER-faculty usage
   * aggregate — a different question entirely (who was reading, not what
   * was read).
   */
  facultyOptions: FacultyOptionT[];
  canSeeDetail: boolean;
  /**
   * The window the DRILL-DOWN endpoints accept, which is not always the one
   * on screen: `/usage/users/:id` and `/usage/programs/:id/viewers` read raw
   * page_views and refuse anything past RAW_RETENTION_DAYS, so the 365-day
   * selection has to narrow before it is sent. Resolved on the server so the
   * panel and its caption cannot disagree about which window they show.
   */
  detailDays: number;
  /** When the server built this page — the api reports no freshnessDate for
   *  usage, because every figure is computed at read time. */
  computedAt: string;
  summary: Enveloped<UsageSummaryT> | null;
  modules: Enveloped<ModuleUsageT[]> | null;
  programs: Enveloped<ProgramUsageT[]> | null;
  roles: Enveloped<RoleUsageT[]> | null;
  faculties: Enveloped<FacultyUsageT[]> | null;
  actions: Enveloped<ActionUsageT[]> | null;
  users: Enveloped<UserUsageT[]> | null;
}
