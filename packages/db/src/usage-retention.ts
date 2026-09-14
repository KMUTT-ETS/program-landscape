import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { SESSION_GAP_MS } from '@kku/shared/src/usage';
import { bangkokDay } from './usage';

// ─────────────────────────────────────────────────────────────────────────────
// page_views retention: roll a whole Bangkok day into page_view_daily, THEN
// delete its raw rows — one transaction per day, never the other way round.
// The roll-up is what the reader falls back to past RAW_RETENTION_DAYS, so a
// delete that outran its upsert would not fail, it would silently erase a day
// from every usage chart.
//
// Three rules this module has to keep, all of them invisible when broken:
//
//   1. IMPERSONATED VIEWS ARE NOT ROLLED UP. page_view_daily has no such
//      column and its schema comment promises they are never folded in, so the
//      raw side of `usage_days` filters them and this must match. They are
//      still DELETED — they are raw page views past their retention window.
//
//   2. `signins` STAYS 0. Sign-ins are audit facts: `usage_days` reads them
//      from audit_logs for the whole window (kept 7 years, against raw views'
//      120 days), so anything non-zero here would be counted twice.
//
//   3. THE UPSERT SETS, IT DOES NOT ADD. If the process dies between the
//      upsert and the delete, the next run sees the same raw rows and must
//      rewrite the same totals. `views = page_view_daily.views + EXCLUDED.views`
//      would double the day on every retry.
//
// Whole Bangkok days only. The cutoff instant names a day; that day is still
// being served from raw rows, so it is never rolled up — only days strictly
// before it are. That is exactly where `branchBoundary()` puts the reader's
// raw/roll-up split (`usage-retention.test.ts` pins the two together), so
// every Bangkok day is owned by exactly one side at all times.
//
// Grain: (day, user, role, viewer faculty, module, path, programme, faculty) —
// the NULLS NOT DISTINCT unique index. No `departmentId`: the daily table does
// not have one, and grouping on it would produce rows the key cannot address.
// ─────────────────────────────────────────────────────────────────────────────

const BKK = 'Asia/Bangkok';

/**
 * The transaction-scoped half of the client. Separate from `RollupPrismaLike`
 * because Prisma's interactive-transaction client has no `$transaction` of its
 * own (`ITXClientDenyList`) — a single interface carrying both would not accept
 * the real client.
 */
export interface RollupTxLike {
  $executeRaw(query: Prisma.Sql): Promise<number>;
}

/** Minimum Prisma surface the rule needs, so tests can inject a fake. */
export interface RollupPrismaLike extends RollupTxLike {
  $queryRaw(query: Prisma.Sql): Promise<unknown>;
  $transaction<T>(
    fn: (tx: RollupTxLike) => Promise<T>,
    options?: { maxWait?: number; timeout?: number },
  ): Promise<T>;
}

/**
 * The Bangkok days (YYYY-MM-DD) that may be rolled up: those strictly before
 * the cutoff's own Bangkok day. Pure, so the boundary is testable without a
 * database — and the boundary is the whole rule.
 */
export function planRollupDays(candidateDays: ReadonlyArray<string>, cutoff: Date): string[] {
  const cutoffDay = bangkokDay(cutoff);
  return [...new Set(candidateDays)].filter((d) => d < cutoffDay).sort();
}

const DayRows = z.array(z.object({ day: z.string(), n: z.coerce.number().int() }));

export interface RollupResult {
  /** Bangkok days rolled into page_view_daily (or that would be, in dry run). */
  daysRolledUp: number;
  days: string[];
  /** Raw page_views rows deleted (or that would be, in dry run). */
  rowsDeleted: number;
  dryRun: boolean;
  /** The day whose transaction threw, if the loop stopped early. Every day
   *  before it is committed; this one and all later ones are untouched, and
   *  tonight's exit status must be non-zero so the next night retries them. */
  failedDay?: string;
  failedReason?: string;
}

/**
 * Half-open [00:00, 24:00) of one Bangkok day, expressed against `created_at`.
 *
 * Written as a range rather than `(created_at AT TIME ZONE …)::date = …` so the
 * predicate stays sargable — the expression form cannot use
 * `page_views_created_at_idx` and seq-scans the table once per day rolled.
 * `${day}::timestamp AT TIME ZONE 'Asia/Bangkok'` reads the day as Bangkok
 * wall-clock and yields the instant; the trailing `AT TIME ZONE 'UTC'` turns it
 * back into the UTC wall-clock the column actually stores.
 */
function bangkokDayRange(day: string): Prisma.Sql {
  return Prisma.sql`created_at >= ((${day}::timestamp AT TIME ZONE ${BKK}) AT TIME ZONE 'UTC')
      AND created_at < (((${day}::timestamp + interval '1 day') AT TIME ZONE ${BKK}) AT TIME ZONE 'UTC')`;
}

export async function rollupPageViews(opts: {
  prisma: RollupPrismaLike;
  cutoff: Date;
  dryRun: boolean;
}): Promise<RollupResult> {
  // `${cutoff}` is a bound Date, which Prisma sends as timestamptz, so it needs
  // `AT TIME ZONE 'UTC'` to be comparable with the column at all — without it
  // the answer depends on the session TimeZone. This is a coarse pre-filter:
  // it can admit part of the cutoff's own Bangkok day, and planRollupDays is
  // what actually decides.
  //
  // `to_char(…, 'YYYY-MM-DD')` rather than `::date::text`: the cast's output
  // follows the session's `DateStyle`, so a server (or a role) set to
  // `SQL, DMY` would return `10/05/2026` and every day key would then sort and
  // compare wrongly against `planRollupDays`' ISO strings. to_char is explicit.
  const candidates = DayRows.parse(
    await opts.prisma.$queryRaw(Prisma.sql`
      SELECT to_char((created_at AT TIME ZONE 'UTC' AT TIME ZONE ${BKK})::date, 'YYYY-MM-DD') AS day,
             COUNT(*)::int AS n
      FROM page_views
      WHERE created_at < (${opts.cutoff} AT TIME ZONE 'UTC')
      GROUP BY 1 ORDER BY 1`),
  );
  const days = planRollupDays(
    candidates.map((c) => c.day),
    opts.cutoff,
  );
  if (opts.dryRun) {
    const byDay = new Map(candidates.map((c) => [c.day, c.n]));
    return {
      daysRolledUp: days.length,
      days,
      rowsDeleted: days.reduce((n, d) => n + (byDay.get(d) ?? 0), 0),
      dryRun: true,
    };
  }

  let rowsDeleted = 0;
  const rolled: string[] = [];
  for (const day of days) {
    try {
      rowsDeleted += await opts.prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw(Prisma.sql`
          INSERT INTO page_view_daily
            (id, day, user_id, role, viewer_faculty_id, module, path, program_id, faculty_id, views, sessions, signins)
          -- The model declares @default(cuid()), which is generated CLIENT-side
          -- by Prisma, so raw SQL has to supply an id of its own. Nothing reads
          -- this column — the row is addressed by the NULLS NOT DISTINCT unique
          -- key — so the two id shapes coexist by design rather than by accident.
          SELECT gen_random_uuid()::text, r.day, r.user_id, r.role, r.viewer_faculty_id,
                 r.module, r.path, r.program_id, r.faculty_id,
                 COUNT(*)::int AS views, SUM(r.session_start)::int AS sessions, 0 AS signins
          FROM (
            SELECT ${day}::date AS day, user_id, role, viewer_faculty_id, module, path,
                   program_id, faculty_id,
                   -- Sessionised PER DAY, so a session spanning Bangkok
                   -- midnight starts on both sides and is counted twice. The
                   -- reader sessionises raw rows across the WHOLE window, so a
                   -- given day's "sessions" ticks UP by its cross-midnight
                   -- count on the night it passes RAW_RETENTION_DAYS. At a
                   -- 30-minute gap that is 23:30–00:30 traffic only; carrying
                   -- the neighbouring days into each transaction to fix it
                   -- would make the roll-up non-idempotent, which is worse.
                   CASE WHEN created_at - LAG(created_at) OVER (PARTITION BY user_id ORDER BY created_at) > make_interval(secs => ${SESSION_GAP_MS / 1000})
                        OR LAG(created_at) OVER (PARTITION BY user_id ORDER BY created_at) IS NULL
                        THEN 1 ELSE 0 END AS session_start
            FROM page_views
            WHERE impersonated = false AND ${bangkokDayRange(day)}
          ) r
          GROUP BY r.day, r.user_id, r.role, r.viewer_faculty_id, r.module, r.path, r.program_id, r.faculty_id
          ON CONFLICT (day, user_id, role, viewer_faculty_id, module, path, program_id, faculty_id)
          DO UPDATE SET
            views = EXCLUDED.views,
            sessions = EXCLUDED.sessions,
            signins = EXCLUDED.signins`);
          // Everything for the day, impersonated rows included — they are raw
          // page views past their retention window even though no roll-up row
          // carries them.
          return tx.$executeRaw(Prisma.sql`
          DELETE FROM page_views WHERE ${bangkokDayRange(day)}`);
        },
        // A busy day is a lot of rows to group and delete; the 5 s interactive
        // default would abort the sweep rather than slow it down. The unit that
        // runs this allows 1800 s in total (`TimeoutStartSec=1800` in
        // program-landscape-retention.service), so a day that actually ran for
        // 600 s would be killed by systemd first — and that is safe: SIGTERM
        // mid-transaction rolls that day back, the days already committed stay
        // committed, and the report still prints (see the failedDay path below
        // and the runner's failure envelope).
        { maxWait: 30_000, timeout: 600_000 },
      );
      rolled.push(day);
    } catch (e) {
      // Stop at the first bad day rather than skip it: the days are ordered and
      // a later success would not repair this one, so carrying on would leave a
      // hole in the roll-up that nothing ever fills. What committed stays
      // committed, and the report still prints — the caller turns `failedDay`
      // into a non-zero exit so tonight is visibly a partial run and tomorrow
      // retries from here.
      return {
        daysRolledUp: rolled.length,
        days: rolled,
        rowsDeleted,
        dryRun: false,
        failedDay: day,
        failedReason: e instanceof Error ? e.message : String(e),
      };
    }
  }
  return { daysRolledUp: rolled.length, days: rolled, rowsDeleted, dryRun: false };
}
