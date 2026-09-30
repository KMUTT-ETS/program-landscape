import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/index';
import { bangkokDay, branchBoundary, RAW_RETENTION_DAYS, windowFor } from '../src/usage';
import { computeRetentionCutoffs } from '../src/retention';
import {
  planRollupDays,
  rollupPageViews,
  type RollupPrismaLike,
  type RollupTxLike,
} from '../src/usage-retention';

const DAY_MS = 86_400_000;

describe('planRollupDays', () => {
  it('lists every Bangkok day strictly older than the cutoff that still has raw rows', () => {
    const cutoff = new Date('2026-09-14T00:00:00Z');
    const days = planRollupDays(['2026-05-10', '2026-05-11', '2026-09-14', '2026-09-15'], cutoff);
    expect(days).toEqual(['2026-05-10', '2026-05-11']);
  });

  it('is empty when nothing is old enough', () => {
    expect(planRollupDays(['2026-09-14'], new Date('2026-09-14T00:00:00Z'))).toEqual([]);
  });

  // The cutoff is an instant, and the day it belongs to is a BANGKOK day —
  // reading it in UTC keeps the boundary day alive for seven hours too long
  // (or kills it seven hours early), which is the exact class of bug the
  // reader's own day bucketing had. 2026-09-13 20:30 UTC is already the 14th
  // in Bangkok, so the 13th is rollable and the 14th is not.
  it('reads the cutoff in Bangkok, not UTC', () => {
    const cutoff = new Date('2026-09-13T20:30:00Z');
    expect(planRollupDays(['2026-09-12', '2026-09-13', '2026-09-14'], cutoff)).toEqual([
      '2026-09-12',
      '2026-09-13',
    ]);
  });

  it('sorts oldest-first and de-duplicates', () => {
    expect(
      planRollupDays(['2026-05-11', '2026-05-10', '2026-05-10'], new Date('2026-09-14T00:00:00Z')),
    ).toEqual(['2026-05-10', '2026-05-11']);
  });
});

// The retention rule and the reader must agree on exactly one thing: which
// Bangkok day is the first one still served from raw rows. If retention rolled
// up one day further than `usage_days` stops reading roll-ups, that day would
// be counted twice; one day short and it would vanish. Neither is visible as
// an error — both just report wrong numbers — so it is pinned here.
describe('the retention cutoff and the reader boundary', () => {
  it('agree on the first Bangkok day that stays raw', () => {
    const now = new Date('2026-09-14T09:00:00Z');
    // The cutoff the sweep will actually use, not a local re-derivation of it —
    // otherwise the test would keep passing after `pageViewRawRetention` was
    // pointed at some other window, which is the failure it exists to catch.
    const cutoff = computeRetentionCutoffs(now).pageViewRollupBefore;
    expect(bangkokDay(cutoff)).toBe(branchBoundary(windowFor(365, now)).rollupUntilDay);
  });
});

describe('rollupPageViews', () => {
  function fakeClient(days: Array<{ day: string; n: number }>) {
    const calls: string[] = [];
    const client: RollupPrismaLike = {
      $queryRaw: vi.fn(async () => days),
      $executeRaw: vi.fn(async (q: Prisma.Sql) => {
        calls.push(q.strings.join('?'));
        return 1;
      }),
      $transaction: vi.fn(async <T>(fn: (tx: RollupTxLike) => Promise<T>) => fn(client)),
    };
    return { client, calls };
  }

  const CUTOFF = new Date('2026-09-14T00:00:00Z');

  it('upserts a day into page_view_daily BEFORE deleting its raw rows, one transaction per day', async () => {
    const { client, calls } = fakeClient([
      { day: '2026-05-10', n: 7 },
      { day: '2026-05-11', n: 3 },
    ]);
    const r = await rollupPageViews({ prisma: client, cutoff: CUTOFF, dryRun: false });

    expect(r.daysRolledUp).toBe(2);
    expect(r.days).toEqual(['2026-05-10', '2026-05-11']);
    expect(client.$transaction).toHaveBeenCalledTimes(2);
    const kinds = calls.map((c) =>
      /INSERT INTO "?page_view_daily/i.test(c)
        ? 'insert'
        : /DELETE FROM "?page_views/i.test(c)
          ? 'delete'
          : 'other',
    );
    expect(kinds).toEqual(['insert', 'delete', 'insert', 'delete']);
  });

  it('never folds impersonated views into the roll-up, and sets rather than adds the totals', async () => {
    const { client, calls } = fakeClient([{ day: '2026-05-10', n: 1 }]);
    await rollupPageViews({ prisma: client, cutoff: CUTOFF, dryRun: false });
    const insert = calls.find((c) => /INSERT INTO "?page_view_daily/i.test(c))!;
    expect(insert).toMatch(/impersonated = false/);
    // SET, not `views = page_view_daily.views + EXCLUDED.views`: a re-run after
    // a crash between the upsert and the delete must rewrite the same counts.
    expect(insert).toMatch(/DO UPDATE SET\s+views = EXCLUDED\.views/);
    // Catches an additive upsert written EITHER way round: the statement has no
    // legitimate dot-qualified reference to the target table.
    expect(insert).not.toMatch(/page_view_daily\.\w/);
    // signins are audit facts read for the whole window by usage_days; a
    // non-zero value here would be double-counted by every reader.
    expect(insert).toMatch(/0 AS signins/);
  });

  it('reports the raw rows in scope without touching anything in dry run', async () => {
    const { client } = fakeClient([
      { day: '2026-05-10', n: 7 },
      { day: '2026-09-20', n: 4 },
    ]);
    const r = await rollupPageViews({ prisma: client, cutoff: CUTOFF, dryRun: true });
    expect(r.daysRolledUp).toBe(1);
    expect(r.days).toEqual(['2026-05-10']);
    // Only the rollable day's rows — the too-recent day's 4 are not in scope.
    expect(r.rowsDeleted).toBe(7);
    expect(r.dryRun).toBe(true);
    expect(client.$executeRaw).not.toHaveBeenCalled();
    expect(client.$transaction).not.toHaveBeenCalled();
  });

  it('does nothing at all when no day is old enough', async () => {
    const { client } = fakeClient([{ day: '2026-09-20', n: 4 }]);
    const r = await rollupPageViews({ prisma: client, cutoff: CUTOFF, dryRun: false });
    expect(r).toMatchObject({ daysRolledUp: 0, days: [], rowsDeleted: 0, dryRun: false });
    expect(client.$transaction).not.toHaveBeenCalled();
  });

  // A day that throws must not take the whole night's report with it. The four
  // destructive rules have already run and committed by this point, and the
  // days rolled before the failure are committed too — so the rule RETURNS what
  // happened instead of throwing, and stops rather than skipping ahead (a later
  // day succeeding would not repair the one that failed).
  it('stops at the first failing day, reports it, and leaves the later days untouched', async () => {
    const days = [
      { day: '2026-05-10', n: 7 },
      { day: '2026-05-11', n: 3 },
      { day: '2026-05-12', n: 2 },
    ];
    let attempts = 0;
    const client: RollupPrismaLike = {
      $queryRaw: vi.fn(async () => days),
      $executeRaw: vi.fn(async () => 1),
      $transaction: vi.fn(async <T>(fn: (tx: RollupTxLike) => Promise<T>) => {
        attempts += 1;
        if (attempts === 2) throw new Error('deadlock detected');
        return fn(client);
      }),
    };

    const r = await rollupPageViews({ prisma: client, cutoff: CUTOFF, dryRun: false });

    expect(r.daysRolledUp).toBe(1);
    expect(r.days).toEqual(['2026-05-10']);
    expect(r.failedDay).toBe('2026-05-11');
    expect(r.failedReason).toContain('deadlock detected');
    // The third day is never attempted — two transactions opened, not three.
    expect(client.$transaction).toHaveBeenCalledTimes(2);
  });
});

// ── Against the real database ────────────────────────────────────────────
//
// The rule is mostly SQL, so a mock proves the call ORDER and nothing about
// the answer. This runs it for real and rolls the whole thing back, so the dev
// database is left exactly as found (it holds 0 page views today, and this
// test must keep it that way).
//
// `rollupPageViews` opens one transaction per day; Prisma has no nested
// interactive transactions, so the adapter below hands the rule the enclosing
// `tx` and makes its `$transaction` a pass-through. The atomicity the rule
// wants is still there — it is the outer transaction's.

const postgresUp: boolean = await (async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
})();

const NOW = new Date();
const OLD = new Date(NOW.getTime() - 130 * DAY_MS);
const RECENT = new Date(NOW.getTime() - 10 * DAY_MS);
const CUTOFF = new Date(NOW.getTime() - RAW_RETENTION_DAYS * DAY_MS);

interface TxLike {
  $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T>;
  $executeRaw(query: Prisma.Sql): Promise<number>;
}

/** Insert one raw view at an exact instant. `created_at` is a `timestamp
 *  without time zone` holding UTC wall-clock, so the bound Date — which Prisma
 *  sends as timestamptz — needs `AT TIME ZONE 'UTC'`; without it the session
 *  TimeZone decides which day the row lands on. */
async function insertView(
  tx: TxLike,
  id: string,
  at: Date,
  impersonated: boolean,
  path = '/cockpit',
): Promise<void> {
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO page_views (id, user_id, role, impersonated, path, module, created_at)
    VALUES (${id}, NULL, 'VIEWER', ${impersonated}, ${path}, 'cockpit', (${at} AT TIME ZONE 'UTC'))`);
}

/** Roll-up rows for ONE Bangkok day.
 *
 *  Scoped to the day under test rather than reading the whole table: this runs
 *  against a live database, and `page_view_daily` holds whatever the real
 *  nightly sweep has already written. An unscoped `toEqual` would be asserting
 *  that nobody has ever used the application. */
async function dailyRowsForDay(
  tx: TxLike,
  day: string,
): Promise<Array<{ day: string; views: number; sessions: number; signins: number }>> {
  return tx.$queryRaw(Prisma.sql`
    SELECT day::text AS day, views, sessions, signins FROM page_view_daily
    WHERE day = ${day}::date ORDER BY day, path`);
}

/** Fixture rows still present on `at`'s Bangkok day.
 *
 *  The `pvt-` scope is load-bearing, not tidiness. Without it this counts real
 *  telemetry that happens to share the day: on 2026-09-30 the fixture's RECENT
 *  day (NOW − 10 days) was 2026-09-20, which already held 33 genuine page
 *  views, so the assertion below read 35 instead of 2 and the suite failed for
 *  a reason that had nothing to do with the roll-up. Every row this test
 *  inserts is prefixed `pvt-`. */
async function rawCount(tx: TxLike, at: Date): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ n: number }>>(Prisma.sql`
    SELECT COUNT(*)::int AS n FROM page_views
    WHERE id LIKE 'pvt-%'
      AND (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Bangkok')::date = ${bangkokDay(at)}::date`);
  return rows[0]?.n ?? 0;
}

describe.skipIf(!postgresUp)('rollupPageViews against postgres', () => {
  it('rolls a whole Bangkok day up, deletes only that day, and is idempotent', async () => {
    const before = await prisma.$queryRaw<Array<{ n: number }>>(
      Prisma.sql`SELECT COUNT(*)::int AS n FROM page_views`,
    );

    const seen: Record<string, unknown> = {};
    await prisma
      .$transaction(
        async (tx) => {
          const client: RollupPrismaLike = {
            $queryRaw: (q) => tx.$queryRaw(q),
            $executeRaw: (q) => tx.$executeRaw(q),
            $transaction: async (fn) => fn(tx),
          };

          // Three views on the old day: two 1 minute apart (one session) and one
          // two hours later (a second session, gap > SESSION_GAP_MS).
          await insertView(tx, 'pvt-old-1', OLD, false);
          await insertView(tx, 'pvt-old-2', new Date(OLD.getTime() + 60_000), false);
          await insertView(tx, 'pvt-old-3', new Date(OLD.getTime() + 2 * 3_600_000), false);
          // An impersonated view on the same day: deleted with the rest, but it
          // must NOT reach the roll-up (page_view_daily has no such column and
          // its schema comment promises they are never folded in).
          await insertView(tx, 'pvt-old-imp', new Date(OLD.getTime() + 120_000), true);
          // Two views inside raw retention: untouched.
          await insertView(tx, 'pvt-new-1', RECENT, false);
          await insertView(tx, 'pvt-new-2', new Date(RECENT.getTime() + 60_000), false);

          const first = await rollupPageViews({ prisma: client, cutoff: CUTOFF, dryRun: false });
          seen.first = first;
          seen.dailyAfterFirst = await dailyRowsForDay(tx, bangkokDay(OLD));
          seen.oldRawAfterFirst = await rawCount(tx, OLD);
          seen.recentRawAfterFirst = await rawCount(tx, RECENT);

          // Crash-recovery shape: the raw rows are back (the upsert committed,
          // the delete did not). A second pass must REWRITE the day's totals, not
          // add to them.
          await insertView(tx, 'pvt-old-1b', OLD, false);
          await insertView(tx, 'pvt-old-2b', new Date(OLD.getTime() + 60_000), false);
          await insertView(tx, 'pvt-old-3b', new Date(OLD.getTime() + 2 * 3_600_000), false);
          seen.second = await rollupPageViews({ prisma: client, cutoff: CUTOFF, dryRun: false });
          seen.dailyAfterSecond = await dailyRowsForDay(tx, bangkokDay(OLD));

          throw new Error('rollback');
        },
        // Two roll-up passes plus a dozen inserts inside one interactive
        // transaction: the 5 s default `timeout` (and the 2 s `maxWait` for a
        // pool slot) can flake on a loaded runner, and the failure looks like a
        // logic bug rather than a clock.
        { maxWait: 10_000, timeout: 60_000 },
      )
      .catch((e: unknown) => {
        if (!(e instanceof Error) || e.message !== 'rollback') throw e;
      });

    // `days` CONTAINS the fixture's day rather than equalling `[it]`, and the
    // run's total `rowsDeleted` is not asserted at all. Both were exact, and
    // both were only passing by luck: the roll-up consumes every Bangkok day
    // older than the cutoff, so the moment this database holds real page views
    // past raw retention — which is a matter of time, not of correctness — a
    // whole-run total stops being a fact about the fixture.
    //
    // Nothing is lost. "Only the eligible days roll up" is the planner's
    // property and `planRollupDays` covers it exhaustively above, without a
    // database. What this test uniquely proves is the SQL round-trip, and the
    // scoped assertions below still carry all of it: the impersonated row was
    // deleted (oldRawAfterFirst === 0) but never folded into the totals
    // (views === 3, not 4).
    expect((seen.first as { days: string[] }).days).toContain(bangkokDay(OLD));
    // One roll-up row: the three non-impersonated views collapse on the shared
    // key, and the impersonated one is not there at all.
    expect(seen.dailyAfterFirst).toEqual([
      { day: bangkokDay(OLD), views: 3, sessions: 2, signins: 0 },
    ]);
    expect(seen.oldRawAfterFirst).toBe(0);
    expect(seen.recentRawAfterFirst).toBe(2);

    // Idempotent: still ONE row (NULLS NOT DISTINCT matched it) and still 3
    // views. An additive upsert would read 6 here — which is what the
    // dailyAfterSecond assertion below actually catches, so the whole-run
    // total is dropped for the same reason as above.
    expect((seen.second as { days: string[] }).days).toContain(bangkokDay(OLD));
    expect(seen.dailyAfterSecond).toEqual([
      { day: bangkokDay(OLD), views: 3, sessions: 2, signins: 0 },
    ]);

    const after = await prisma.$queryRaw<Array<{ n: number }>>(
      Prisma.sql`SELECT COUNT(*)::int AS n FROM page_views`,
    );
    expect(after[0]!.n).toBe(before[0]!.n);
  });
});
