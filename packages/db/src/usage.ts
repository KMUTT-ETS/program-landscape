import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  actionFamily,
  groupSessions,
  normalisePath,
  SESSION_GAP_MS,
  type ActionFamily,
} from '@kku/shared/src/usage';
import { prisma } from './index';

// ─────────────────────────────────────────────────────────────────────────────
// Platform usage — recording and every read.
//
// ONE shape underlies every aggregate: `usage_days`, a CTE that unions
//   - raw page_views (last RAW_RETENTION_DAYS), bucketed to Asia/Bangkok days,
//     sessions derived by a window function (SESSION_GAP_MS gap);
//   - page_view_daily roll-ups (older);
//   - audit_logs sign-ins, as module='signin' rows.
// Summary, modules, programmes, roles and faculties all group that CTE, so
// they cannot disagree with each other. Day bucketing is Bangkok everywhere:
// a 20:30 UTC view is the next Bangkok day.
//
// These tables never feed a Council-facing metric, so realDataWhere() does not
// apply and there is no ingestion_run_id — a deliberate decision recorded in
// the spec.
// ─────────────────────────────────────────────────────────────────────────────

export const RAW_RETENTION_DAYS = 120;
export const USAGE_WINDOWS = [7, 30, 90, 365] as const;
export type UsageWindowDays = (typeof USAGE_WINDOWS)[number];
export const ADMIN_ROLES = ['SUPER_ADMIN', 'SYSTEM_ADMIN'] as const;
const BKK = 'Asia/Bangkok';
const DAY_MS = 86_400_000;

const bkkFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: BKK,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
/** YYYY-MM-DD in Asia/Bangkok. */
export function bangkokDay(at: Date): string {
  return bkkFormat.format(at);
}

export interface UsageWindow {
  days: UsageWindowDays;
  from: Date;
  to: Date;
  prevFrom: Date;
  /**
   * The raw-retention horizon: RAW_RETENTION_DAYS before the real now — NOT
   * before this window's `to`. It must survive being narrowed into a
   * sub-window (`{ ...w, from, to }`, as `totals()` does for the previous
   * period): deriving it from `to` would slide the raw/roll-up split backwards
   * with the sub-window and read raw rows that retention has already deleted.
   */
  rawFrom: Date;
  /**
   * Where roll-ups stop and raw rows begin (equals `rawFrom`), or null when the
   * window is entirely raw. Roll-ups themselves start at `from`.
   */
  rollupFrom: Date | null;
}
export function windowFor(days: UsageWindowDays, now = new Date()): UsageWindow {
  if (!(USAGE_WINDOWS as readonly number[]).includes(days))
    throw new Error(`unsupported usage window: ${days}`);
  const from = new Date(now.getTime() - days * DAY_MS);
  const prevFrom = new Date(from.getTime() - days * DAY_MS);
  const rawFrom = new Date(now.getTime() - RAW_RETENTION_DAYS * DAY_MS);
  return { days, from, to: now, prevFrom, rawFrom, rollupFrom: from < rawFrom ? rawFrom : null };
}

/**
 * Where `usage_days` stops reading roll-ups and starts reading raw rows, for
 * one (possibly narrowed) window. Pure, and exported so a test can pin exactly
 * what the SQL uses rather than a re-derivation of it.
 *
 * `rawFrom` is clamped into [`w.from`, `w.to`]: a window entirely inside raw
 * retention has no roll-up half, and one entirely outside it has no raw half.
 * `rollupUntilDay` is the first Bangkok day the roll-up branch must NOT emit —
 * the raw branch owns that whole day, from its Bangkok midnight.
 */
export function branchBoundary(w: UsageWindow): { rawFrom: Date; rollupUntilDay: string } {
  const rawFrom = new Date(
    Math.min(Math.max(w.from.getTime(), w.rawFrom.getTime()), w.to.getTime()),
  );
  return { rawFrom, rollupUntilDay: bangkokDay(rawFrom) };
}

// ── Recording ────────────────────────────────────────────────────────────

export interface RecordPageViewInput {
  userId: string;
  role: string;
  impersonated: boolean;
  viewerFacultyId: string | null;
  rawPath: string;
  scope?: 'university' | 'faculty' | 'department' | 'program';
  scopeId?: string | null;
  programId?: string | null;
}

/**
 * Insert one page view. THROWS on any database error — it does not swallow.
 * The caller must catch: telemetry must never fail the request it describes,
 * and this function has no way to know whether it is on a request path.
 */
export async function recordPageView(input: RecordPageViewInput): Promise<void> {
  const { path, module } = normalisePath(input.rawPath);
  const facultyId = input.scope === 'faculty' ? (input.scopeId ?? null) : null;
  const departmentId = input.scope === 'department' ? (input.scopeId ?? null) : null;
  const programId = input.programId ?? (input.scope === 'program' ? (input.scopeId ?? null) : null);
  await prisma.pageView.create({
    data: {
      userId: input.userId,
      role: input.role,
      impersonated: input.impersonated,
      viewerFacultyId: input.viewerFacultyId,
      path,
      module,
      programId,
      facultyId,
      departmentId,
    },
  });
}

// ── The shared CTE ───────────────────────────────────────────────────────

/**
 * `usage_days` — one row per (day, user, role, viewer faculty, module, path,
 * programme, faculty) with views, sessions, signins. Raw rows are bucketed
 * and sessionised here; daily rows pass through; sign-ins come from
 * audit_logs for the WHOLE window, never from page_view_daily.
 *
 * Sign-ins are audit facts, not page-view facts: page_view_daily.signins is
 * only ever the roll-up of what this CTE already read out of audit_logs, so
 * reading it back here would double-count. audit_logs is kept for 7 years
 * against raw page views' 120 days, so the audit branch covers the full window
 * on its own and the roll-up branch emits 0 sign-ins.
 *
 * Time zones. Prisma binds a JS `Date` as `timestamp with time zone`, so a
 * PARAMETER needs a single `AT TIME ZONE 'Asia/Bangkok'` to become Bangkok
 * wall-clock. The COLUMNS (`page_views.created_at`, `audit_logs.created_at`)
 * are `timestamp without time zone` holding UTC wall-clock, so they need the
 * double `AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Bangkok'`. Comparing a column
 * against a parameter therefore needs `${param} AT TIME ZONE 'UTC'` — without
 * it the comparison mixes timestamp with timestamptz and its answer depends on
 * the session TimeZone.
 *
 * IMPORTANT: this function must be called fresh for every `$queryRaw` call —
 * never hoist its return value into a shared `Prisma.Sql` reused across
 * parallel queries. Reusing one `Prisma.Sql` value across concurrent
 * `$queryRaw` calls previously caused parameter-index drift in
 * `dashboard-overview.ts` (see CLAUDE.md); a factory call per use avoids it.
 *
 * `withSessions = false` drops the two `LAG` window calls for readers that do
 * not select `sessions` — the sessions column is then a literal 0, which is
 * cheaper and, more importantly, honest: a partitioned window function over a
 * filtered set is not free to compute and not meaningful to ignore.
 */
function usageDaysCte(w: UsageWindow, excludeAdmins: boolean, withSessions = true): Prisma.Sql {
  const adminFilter = excludeAdmins
    ? Prisma.sql`AND role NOT IN ('SUPER_ADMIN','SYSTEM_ADMIN')`
    : Prisma.empty;
  const { rawFrom } = branchBoundary(w);
  // Snap the raw lower bound down to Bangkok midnight ONLY when a roll-up half
  // exists (rawFrom > from). For a window served entirely by raw rows there is
  // no boundary day to align, and snapping would widen the period by up to a
  // day — so the current and previous 7/30/90-day windows would overlap.
  const rawLower =
    rawFrom.getTime() > w.from.getTime()
      ? Prisma.sql`((date_trunc('day', ${rawFrom} AT TIME ZONE ${BKK}) AT TIME ZONE ${BKK}) AT TIME ZONE 'UTC')`
      : Prisma.sql`(${rawFrom} AT TIME ZONE 'UTC')`;
  // Session threshold derived from the shared constant (SESSION_GAP_MS),
  // never retyped as a literal interval — see @kku/shared/src/usage/sessions.
  // `LAG(...) IS NULL` on the first row per user keeps the boundary explicit
  // (NULL > interval is NULL, not TRUE, so it would silently fail to start a
  // session without this branch). timestamps are stored at microsecond
  // precision while `SESSION_GAP_MS` is a JS millisecond value — a
  // sub-millisecond disagreement between the TS and SQL sessionisers is
  // possible at the exact boundary and is acceptable.
  const sessionStart = withSessions
    ? Prisma.sql`,
             CASE WHEN created_at - LAG(created_at) OVER (PARTITION BY user_id ORDER BY created_at) > make_interval(secs => ${SESSION_GAP_MS / 1000})
                  OR LAG(created_at) OVER (PARTITION BY user_id ORDER BY created_at) IS NULL THEN 1 ELSE 0 END AS session_start`
    : Prisma.empty;
  const sessionsAgg = withSessions ? Prisma.sql`SUM(session_start)::int` : Prisma.sql`0::int`;
  // The raw branch starts at the Bangkok MIDNIGHT of rawFrom's day, and the
  // roll-up branch stops before that same day, so every Bangkok day in the
  // window is served by exactly one branch. Snapping the other way — raw from
  // the bare instant — would split the boundary day between the two and
  // undercount or double-count it depending on which side moved.
  //
  // Two consequences worth knowing. (1) Sessionisation runs over the FILTERED,
  // window-bounded partition: a row excluded mid-session (impersonated, or an
  // admin under excludeAdmins) removes the bridge and splits one session in
  // two, and the first row after the lower bound always starts a session. Both
  // bias `sessions` slightly UP; neither is worth carrying unfiltered rows to
  // fix. (2) Because buckets are Bangkok days and the lower bound snaps down
  // to a day boundary, a 365-day window can span 366 day buckets.
  return Prisma.sql`
    WITH raw AS (
      SELECT (created_at AT TIME ZONE 'UTC' AT TIME ZONE ${BKK})::date AS day,
             user_id, role, viewer_faculty_id, module, path, program_id, faculty_id, created_at${sessionStart}
      FROM page_views
      WHERE created_at >= ${rawLower}
        AND created_at < (${w.to} AT TIME ZONE 'UTC') AND impersonated = false ${adminFilter}
    ),
    usage_days AS (
      SELECT day, user_id, role, viewer_faculty_id, module, path, program_id, faculty_id,
             COUNT(*)::int AS views, ${sessionsAgg} AS sessions, 0::int AS signins
      FROM raw GROUP BY 1,2,3,4,5,6,7,8
      UNION ALL
      SELECT day, user_id, role, viewer_faculty_id, module, path, program_id, faculty_id, views, sessions, 0::int AS signins
      FROM page_view_daily
      WHERE day >= (${w.from} AT TIME ZONE ${BKK})::date
        AND day < (${rawFrom} AT TIME ZONE ${BKK})::date
        ${excludeAdmins ? Prisma.sql`AND role NOT IN ('SUPER_ADMIN','SYSTEM_ADMIN')` : Prisma.empty}
      UNION ALL
      SELECT (a.created_at AT TIME ZONE 'UTC' AT TIME ZONE ${BKK})::date, a.user_id, u.role::text, u.faculty_id,
             'signin', '/signin', NULL, NULL, 0, 0, COUNT(*)::int
      FROM audit_logs a JOIN users u ON u.id = a.user_id
      WHERE a.action = 'auth.signin.ok'
        AND a.created_at >= (${w.from} AT TIME ZONE 'UTC') AND a.created_at < (${w.to} AT TIME ZONE 'UTC')
        ${excludeAdmins ? Prisma.sql`AND u.role::text NOT IN ('SUPER_ADMIN','SYSTEM_ADMIN')` : Prisma.empty}
      GROUP BY 1,2,3,4
    )`;
}

const Int = z.coerce.number().int();
const Num = z.coerce.number();

// ── Summary ──────────────────────────────────────────────────────────────

const TotalsRow = z.object({ users: Int, views: Int, sessions: Int, signins: Int });
const DayRow = z.object({ day: z.string(), users: Int, signins: Int });

export interface UsageSummary {
  window: UsageWindow;
  recordedSince: string | null;
  current: {
    activeUsers: number;
    views: number;
    sessions: number;
    signins: number;
    aiCalls: number;
  };
  previous: {
    activeUsers: number;
    views: number;
    sessions: number;
    signins: number;
    aiCalls: number;
  };
  signinsToday: number;
  /** Last 30 Bangkok days, oldest first. */
  dailyActiveUsers: Array<{ day: string; users: number; signins: number }>;
}

async function totals(
  w: UsageWindow,
  excludeAdmins: boolean,
  from: Date,
  to: Date,
): Promise<z.infer<typeof TotalsRow>> {
  const sub: UsageWindow = { ...w, from, to };
  const rows = await prisma.$queryRaw<unknown[]>(Prisma.sql`${usageDaysCte(sub, excludeAdmins)}
    SELECT COUNT(DISTINCT user_id) FILTER (WHERE views > 0 OR signins > 0)::int AS users,
           COALESCE(SUM(views),0)::int AS views, COALESCE(SUM(sessions),0)::int AS sessions, COALESCE(SUM(signins),0)::int AS signins
    FROM usage_days`);
  return TotalsRow.parse(rows[0] ?? {});
}

export async function usageSummary(
  days: UsageWindowDays,
  excludeAdmins: boolean,
  now = new Date(),
): Promise<UsageSummary> {
  const w = windowFor(days, now);
  // A row with no user (a background or system call) is not an admin row:
  // `user: { role: … }` alone would silently drop every user-less row, which
  // on dev is the great majority of ai_inferences.
  const adminWhere = excludeAdmins
    ? { OR: [{ userId: null }, { user: { role: { notIn: [...ADMIN_ROLES] } } }] }
    : {};
  const [cur, prev, aiCur, aiPrev, first, todayRows, dau] = await Promise.all([
    totals(w, excludeAdmins, w.from, w.to),
    totals(w, excludeAdmins, w.prevFrom, w.from),
    prisma.aiInference.count({ where: { createdAt: { gte: w.from, lt: w.to }, ...adminWhere } }),
    prisma.aiInference.count({
      where: { createdAt: { gte: w.prevFrom, lt: w.from }, ...adminWhere },
    }),
    prisma.pageView.findFirst({ orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
    // The conversions are deliberately asymmetric: `a.created_at` is a
    // `timestamp without time zone` holding UTC, so it needs UTC→BKK; `${now}`
    // is a bound Date, which Prisma sends as timestamptz, so ONE AT TIME ZONE
    // is what turns it into Bangkok wall-clock. Converting it twice reads it
    // as if it were already local and lands on the wrong day for 7 hours out
    // of every 24 (measured: 1 sign-in reported where the truth was 24).
    prisma.$queryRaw<
      unknown[]
    >(Prisma.sql`SELECT COUNT(*)::int AS n FROM audit_logs a JOIN users u ON u.id=a.user_id
      WHERE a.action='auth.signin.ok' AND (a.created_at AT TIME ZONE 'UTC' AT TIME ZONE ${BKK})::date = (${now} AT TIME ZONE ${BKK})::date
      ${excludeAdmins ? Prisma.sql`AND u.role::text NOT IN ('SUPER_ADMIN','SYSTEM_ADMIN')` : Prisma.empty}`),
    prisma.$queryRaw<unknown[]>(Prisma.sql`${usageDaysCte(windowFor(30, now), excludeAdmins)}
      SELECT day::text AS day, COUNT(DISTINCT user_id) FILTER (WHERE views > 0 OR signins > 0)::int AS users, COALESCE(SUM(signins),0)::int AS signins
      FROM usage_days GROUP BY day ORDER BY day`),
  ]);
  return {
    window: w,
    recordedSince: first ? bangkokDay(first.createdAt) : null,
    current: {
      activeUsers: cur.users,
      views: cur.views,
      sessions: cur.sessions,
      signins: cur.signins,
      aiCalls: aiCur,
    },
    previous: {
      activeUsers: prev.users,
      views: prev.views,
      sessions: prev.sessions,
      signins: prev.signins,
      aiCalls: aiPrev,
    },
    signinsToday: z.object({ n: Int }).parse(todayRows[0] ?? { n: 0 }).n,
    dailyActiveUsers: z.array(DayRow).parse(dau),
  };
}

// ── Modules ──────────────────────────────────────────────────────────────

const ModuleRow = z.object({ module: z.string(), views: Int, users: Int, sessions: Int });
const DwellRow = z.object({ module: z.string(), median_ms: Num.nullable() });

export interface ModuleUsage {
  module: string;
  views: number;
  users: number;
  sessions: number;
  medianDwellMs: number | null;
}

export async function usageByModule(
  days: UsageWindowDays,
  excludeAdmins: boolean,
  now = new Date(),
): Promise<ModuleUsage[]> {
  const w = windowFor(days, now);
  const [rows, dwell] = await Promise.all([
    prisma.$queryRaw<unknown[]>(Prisma.sql`${usageDaysCte(w, excludeAdmins)}
      SELECT module, SUM(views)::int AS views, COUNT(DISTINCT user_id)::int AS users, SUM(sessions)::int AS sessions
      FROM usage_days WHERE module <> 'signin' GROUP BY module ORDER BY views DESC`),
    // Dwell needs timestamps, so raw rows only (the last RAW_RETENTION_DAYS).
    prisma.$queryRaw<unknown[]>(Prisma.sql`
      WITH v AS (
        SELECT module, user_id, created_at,
               LEAD(created_at) OVER (PARTITION BY user_id ORDER BY created_at) AS next_at
        FROM page_views
        WHERE created_at >= (${w.from} AT TIME ZONE 'UTC') AND created_at < (${w.to} AT TIME ZONE 'UTC')
          AND impersonated = false
        ${excludeAdmins ? Prisma.sql`AND role NOT IN ('SUPER_ADMIN','SYSTEM_ADMIN')` : Prisma.empty})
      SELECT module, percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (next_at - created_at)) * 1000) AS median_ms
      FROM v WHERE next_at IS NOT NULL AND next_at - created_at <= make_interval(secs => ${SESSION_GAP_MS / 1000}) GROUP BY module`),
  ]);
  const dwellBy = new Map(
    z
      .array(DwellRow)
      .parse(dwell)
      .map((d) => [d.module, d.median_ms]),
  );
  return z
    .array(ModuleRow)
    .parse(rows)
    .map((r) => ({ ...r, medianDwellMs: dwellBy.get(r.module) ?? null }));
}

// ── Programmes, roles, faculties ─────────────────────────────────────────

const ProgramRow = z.object({
  program_id: z.string(),
  code: z.string().nullable(),
  name_en: z.string().nullable(),
  name_th: z.string().nullable(),
  faculty_th: z.string().nullable(),
  views: Int,
  users: Int,
});
export interface ProgramUsage {
  programId: string;
  code: string | null;
  nameEn: string | null;
  nameTh: string | null;
  facultyTh: string | null;
  views: number;
  users: number;
}

export async function usageByProgram(
  days: UsageWindowDays,
  excludeAdmins: boolean,
  facultyId: string | null,
  now = new Date(),
  limit = 50,
): Promise<ProgramUsage[]> {
  const w = windowFor(days, now);
  // No `sessions` column in the projection, so no window function is needed.
  const rows = await prisma.$queryRaw<unknown[]>(Prisma.sql`${usageDaysCte(w, excludeAdmins, false)}
    SELECT d.program_id, p.code, p.name_en, p.name_th, f.name_th AS faculty_th,
           SUM(d.views)::int AS views, COUNT(DISTINCT d.user_id)::int AS users
    FROM usage_days d
    LEFT JOIN programs p ON p.id = d.program_id
    LEFT JOIN faculties f ON f.id = p.faculty_id
    WHERE d.program_id IS NOT NULL ${facultyId ? Prisma.sql`AND p.faculty_id = ${facultyId}` : Prisma.empty}
    GROUP BY 1,2,3,4,5 ORDER BY views DESC LIMIT ${limit}`);
  return z
    .array(ProgramRow)
    .parse(rows)
    .map((r) => ({
      programId: r.program_id,
      code: r.code,
      nameEn: r.name_en,
      nameTh: r.name_th,
      facultyTh: r.faculty_th,
      views: r.views,
      users: r.users,
    }));
}

const RoleRow = z.object({ role: z.string(), users: Int, views: Int, sessions: Int, signins: Int });
export interface RoleUsage {
  role: string;
  users: number;
  views: number;
  sessions: number;
  signins: number;
}

export async function usageByRole(
  days: UsageWindowDays,
  excludeAdmins: boolean,
  now = new Date(),
): Promise<RoleUsage[]> {
  const w = windowFor(days, now);
  const rows = await prisma.$queryRaw<unknown[]>(Prisma.sql`${usageDaysCte(w, excludeAdmins)}
    SELECT role, COUNT(DISTINCT user_id)::int AS users, SUM(views)::int AS views, SUM(sessions)::int AS sessions, SUM(signins)::int AS signins
    FROM usage_days GROUP BY role ORDER BY views DESC`);
  return z.array(RoleRow).parse(rows);
}

const FacultyRow = z.object({
  faculty_id: z.string().nullable(),
  name_th: z.string().nullable(),
  name_en: z.string().nullable(),
  users: Int,
  views: Int,
});
export interface ViewerFacultyUsage {
  facultyId: string | null;
  nameTh: string | null;
  nameEn: string | null;
  users: number;
  views: number;
}

export async function usageByViewerFaculty(
  days: UsageWindowDays,
  excludeAdmins: boolean,
  now = new Date(),
): Promise<ViewerFacultyUsage[]> {
  const w = windowFor(days, now);
  // No `sessions` column in the projection, so no window function is needed.
  const rows = await prisma.$queryRaw<unknown[]>(Prisma.sql`${usageDaysCte(w, excludeAdmins, false)}
    SELECT d.viewer_faculty_id AS faculty_id, f.name_th, f.name_en, COUNT(DISTINCT d.user_id)::int AS users, SUM(d.views)::int AS views
    FROM usage_days d LEFT JOIN faculties f ON f.id = d.viewer_faculty_id
    WHERE d.module <> 'signin' GROUP BY 1,2,3 ORDER BY views DESC`);
  return z
    .array(FacultyRow)
    .parse(rows)
    .map((r) => ({
      facultyId: r.faculty_id,
      nameTh: r.name_th,
      nameEn: r.name_en,
      users: r.users,
      views: r.views,
    }));
}

// ── Actions (audit_logs) ─────────────────────────────────────────────────

export interface ActionUsage {
  family: ActionFamily;
  count: number;
  users: number;
}
export async function usageActions(
  days: UsageWindowDays,
  excludeAdmins: boolean,
  now = new Date(),
): Promise<ActionUsage[]> {
  const w = windowFor(days, now);
  const rows = await prisma.auditLog.findMany({
    where: {
      createdAt: { gte: w.from, lt: w.to },
      // As in usageSummary: a user-less row is not an admin row, so it must
      // survive the exclusion rather than be dropped by the relation filter.
      ...(excludeAdmins
        ? { OR: [{ userId: null }, { user: { role: { notIn: [...ADMIN_ROLES] } } }] }
        : {}),
    },
    select: { action: true, userId: true },
  });
  const acc = new Map<ActionFamily, { count: number; users: Set<string> }>();
  for (const r of rows) {
    const fam = actionFamily(r.action);
    if (!fam) continue;
    const e = acc.get(fam) ?? { count: 0, users: new Set<string>() };
    e.count += 1;
    if (r.userId) e.users.add(r.userId);
    acc.set(fam, e);
  }
  return [...acc.entries()]
    .map(([family, e]) => ({ family, count: e.count, users: e.users.size }))
    .sort((a, b) => b.count - a.count);
}

// ── Detail (admin-grade only) ────────────────────────────────────────────

const UserRow = z.object({
  user_id: z.string(),
  name: z.string().nullable(),
  email: z.string(),
  role: z.string(),
  faculty_th: z.string().nullable(),
  last_seen: z.date().nullable(),
  views: Int,
  sessions: Int,
  signins: Int,
});
export interface UserUsageRow {
  userId: string;
  name: string | null;
  email: string;
  role: string;
  facultyTh: string | null;
  lastSeen: Date | null;
  views: number;
  sessions: number;
  signins: number;
  actions: number;
}

export async function usageUsers(
  days: UsageWindowDays,
  excludeAdmins: boolean,
  q: string | null,
  now = new Date(),
): Promise<UserUsageRow[]> {
  const w = windowFor(days, now);
  // A search term is user input, so its LIKE metacharacters are escaped: an
  // unescaped `%` or `_` would quietly widen the search rather than match
  // literally. `ORDER BY views DESC, u.id` — without the tie-break, rows with
  // equal `views` (very common: most users have 0) come back in an unstable
  // order and LIMIT 500 returns a different 500 each call.
  const like = q ? '%' + q.replace(/[\\%_]/g, (c) => '\\' + c) + '%' : null;
  const rows = await prisma.$queryRaw<unknown[]>(Prisma.sql`${usageDaysCte(w, excludeAdmins)}
    SELECT u.id AS user_id, u.name, u.email, u.role::text AS role, f.name_th AS faculty_th,
           (SELECT MAX(created_at) FROM page_views pv WHERE pv.user_id = u.id AND pv.impersonated = false) AS last_seen,
           COALESCE(SUM(d.views),0)::int AS views, COALESCE(SUM(d.sessions),0)::int AS sessions, COALESCE(SUM(d.signins),0)::int AS signins
    FROM usage_days d JOIN users u ON u.id = d.user_id LEFT JOIN faculties f ON f.id = u.faculty_id
    ${like ? Prisma.sql`WHERE (u.name ILIKE ${like} ESCAPE '\\' OR u.email ILIKE ${like} ESCAPE '\\')` : Prisma.empty}
    GROUP BY u.id, u.name, u.email, u.role, f.name_th ORDER BY views DESC, u.id LIMIT 500`);
  const users = z.array(UserRow).parse(rows);
  const actions = await prisma.auditLog.groupBy({
    by: ['userId'],
    where: { createdAt: { gte: w.from, lt: w.to }, userId: { in: users.map((u) => u.user_id) } },
    _count: { _all: true },
  });
  const actionsBy = new Map(actions.map((a) => [a.userId, a._count._all]));
  return users.map((u) => ({
    userId: u.user_id,
    name: u.name,
    email: u.email,
    role: u.role,
    facultyTh: u.faculty_th,
    lastSeen: u.last_seen,
    views: u.views,
    sessions: u.sessions,
    signins: u.signins,
    actions: actionsBy.get(u.user_id) ?? 0,
  }));
}

export interface TimelineEvent {
  at: Date;
  kind: 'view' | 'signin' | 'action';
  label: string;
  path?: string;
  programId?: string | null;
  action?: string;
}
export interface UserTimeline {
  user: { id: string; name: string | null; email: string; role: string };
  days: Array<{
    day: string;
    sessions: Array<{ startedAt: Date; endedAt: Date; events: TimelineEvent[] }>;
  }>;
}

// Presentation, not data: this table and labelFor() belong in the web app, and
// moving them there is a separate task. Wherever they live, they must track
// normalisePath() — a route pattern it starts emitting and this map does not
// know falls back to the bare path, which reads as a bug to the operator.
const PATH_LABEL: Record<string, string> = {
  '/': 'Home',
  '/cockpit': 'Portfolio Cockpit',
  '/programs/[id]': 'Program Deep-Dive',
  '/programs/[id]/print': 'Program Deep-Dive · print',
  '/gap-analysis': 'Gap Analyzer',
  '/benchmarking': 'Benchmarking',
  '/scenarios': 'Scenarios',
  '/decisions': 'Decisions',
  '/analyst': 'AI Analyst',
  '/trends': 'Trends Radar',
  '/skills': 'Skills',
  '/usage': 'Platform usage',
  '/docs/methodology': 'Methodology',
};
function labelFor(path: string, programName: string | null): string {
  const base = PATH_LABEL[path] ?? path;
  return programName ? `${base} · ${programName}` : base;
}

export async function usageUserTimeline(
  userId: string,
  days: UsageWindowDays,
  now = new Date(),
): Promise<UserTimeline | null> {
  const w = windowFor(days, now);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true },
  });
  if (!user) return null;
  const [views, audits] = await Promise.all([
    prisma.pageView.findMany({
      // `impersonated: false` as every other reader does: an admin browsing AS
      // this user must not appear on the user's own timeline.
      where: { userId, createdAt: { gte: w.from, lt: w.to }, impersonated: false },
      select: { createdAt: true, path: true, programId: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.auditLog.findMany({
      where: { userId, createdAt: { gte: w.from, lt: w.to } },
      select: { createdAt: true, action: true },
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  const programIds = [...new Set(views.map((v) => v.programId).filter((x): x is string => !!x))];
  const programs = programIds.length
    ? await prisma.program.findMany({
        where: { id: { in: programIds } },
        select: { id: true, nameEn: true, nameTh: true },
      })
    : [];
  const nameBy = new Map(programs.map((p) => [p.id, p.nameEn ?? p.nameTh]));

  const events: TimelineEvent[] = [
    ...views.map((v) => ({
      at: v.createdAt,
      kind: 'view' as const,
      label: labelFor(v.path, v.programId ? (nameBy.get(v.programId) ?? null) : null),
      path: v.path,
      programId: v.programId,
    })),
    ...audits
      .map((a) => ({
        at: a.createdAt,
        kind: a.action === 'auth.signin.ok' ? ('signin' as const) : ('action' as const),
        label: a.action === 'auth.signin.ok' ? 'Signed in' : a.action,
        action: a.action,
      }))
      .filter((e) => e.kind === 'signin' || actionFamily(e.action) !== null),
  ];
  const sessions = groupSessions(events.map((e) => ({ ...e, path: e.path ?? e.label })));
  const byDay = new Map<string, UserTimeline['days'][number]['sessions']>();
  for (const s of sessions) {
    const day = bangkokDay(s.startedAt);
    const list = byDay.get(day) ?? [];
    list.push({ startedAt: s.startedAt, endedAt: s.endedAt, events: s.views as TimelineEvent[] });
    byDay.set(day, list);
  }
  return {
    user: { ...user, role: String(user.role) },
    days: [...byDay.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([day, sessions]) => ({ day, sessions })),
  };
}

export interface ProgramViewer {
  userId: string;
  name: string | null;
  email: string;
  role: string;
  views: number;
  lastSeen: Date | null;
}

export async function usageProgramViewers(
  programId: string,
  days: UsageWindowDays,
  now = new Date(),
): Promise<ProgramViewer[]> {
  const w = windowFor(days, now);
  const rows = await prisma.pageView.groupBy({
    by: ['userId'],
    where: {
      programId,
      createdAt: { gte: w.from, lt: w.to },
      impersonated: false,
      userId: { not: null },
    },
    _count: { _all: true },
    _max: { createdAt: true },
  });
  const users = await prisma.user.findMany({
    where: { id: { in: rows.map((r) => r.userId).filter((x): x is string => !!x) } },
    select: { id: true, name: true, email: true, role: true },
  });
  const by = new Map(users.map((u) => [u.id, u]));
  return rows
    .map((r) => ({
      userId: r.userId as string,
      name: by.get(r.userId as string)?.name ?? null,
      email: by.get(r.userId as string)?.email ?? '',
      role: String(by.get(r.userId as string)?.role ?? ''),
      views: r._count._all,
      lastSeen: r._max.createdAt,
    }))
    .sort((a, b) => b.views - a.views);
}

/**
 * Median dwell across the whole window, for the summary strip caveat. Raw rows
 * only — dwell needs timestamps, which the roll-up does not keep.
 *
 * Computed in SQL. The previous version pulled up to 200,000 rows into the
 * process and sessionised them in JS, which silently truncated the answer past
 * that limit (a `take` with no ordering guarantee of completeness is a wrong
 * median, not a slow one) and moved the whole window over the wire for one
 * number. `percentile_cont` is exact over the same set.
 */
export async function usageMedianDwell(
  days: UsageWindowDays,
  excludeAdmins: boolean,
  now = new Date(),
): Promise<number | null> {
  const w = windowFor(days, now);
  const rows = await prisma.$queryRaw<unknown[]>(Prisma.sql`
    WITH v AS (
      SELECT user_id, created_at,
             LEAD(created_at) OVER (PARTITION BY user_id ORDER BY created_at) AS next_at
      FROM page_views
      WHERE created_at >= (${w.from} AT TIME ZONE 'UTC') AND created_at < (${w.to} AT TIME ZONE 'UTC')
        AND impersonated = false AND user_id IS NOT NULL
        ${excludeAdmins ? Prisma.sql`AND role NOT IN ('SUPER_ADMIN','SYSTEM_ADMIN')` : Prisma.empty})
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (next_at - created_at)) * 1000) AS median_ms
    FROM v WHERE next_at IS NOT NULL AND next_at - created_at <= make_interval(secs => ${SESSION_GAP_MS / 1000})`);
  const median = z
    .object({ median_ms: Num.nullable() })
    .parse(rows[0] ?? { median_ms: null }).median_ms;
  return median === null ? null : Math.round(median);
}
