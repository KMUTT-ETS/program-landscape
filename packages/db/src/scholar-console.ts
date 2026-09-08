// packages/db/src/scholar-console.ts
//
// Two read-only things the admin Scholar console needs and the runner does
// not: the roster it lists, and the pre-flight that prices a bulk run.
//
// `planScholarBulkTargets` is shared with `apps/api`'s bulk endpoint ON
// PURPOSE. The console prices a run one round trip before the API prices the
// same run, and the API refuses if the two disagree — a check that is only
// meaningful because both sides reach the verdict through this one function.
// Two implementations of "who will actually reach Google" would make that
// check fire on their own drift rather than on a real change.
//
// WHY THIS READS PRISMA DIRECTLY INSTEAD OF CALLING THE API.
// The Scholar API exposes the run LEDGER (`GET /scholar/runs`) and nothing
// else — there is no staff-roster endpoint, and the console needs one to
// answer the question it exists to answer: who can be fetched for, who is
// linked, and who has never been. `apps/web/app/admin/users` sets the
// precedent for an admin page assembling its own listing from Prisma in a
// server component; this follows it rather than inventing a parallel one.
//
// WHY EVERY USER IS RESOLVED, NOT JUST THE PAGE ON SCREEN.
// A row is only actionable if `POST /scholar/fetch/:userId` will resolve that
// account to exactly one staff record, and resolution is the same in-memory
// name/HR-id rule the runner applies — it cannot be expressed as a WHERE
// clause, so it cannot be paginated in SQL either. Filtering by faculty
// therefore requires resolving everyone first. `inMemoryScholarRoster` makes
// that one indexed pass rather than 624 table scans; see its note.
//
// The counts and last-run columns are three grouped queries, NOT a query per
// row: at 624 accounts the per-row shape would be some 1,900 round trips.

import {
  SCHOLAR_LEDGER_LOOKBACK_MS,
  decideScholarQuota,
  type ScholarTrigger,
} from '@kku/shared';
import { prisma } from './index';
import {
  SCHOLAR_RESEARCH_OUTPUT_SOURCE,
  databaseScholarRoster,
  inMemoryScholarRoster,
  loadScholarRoster,
  resolveScholarMember,
  type ScholarAccount,
  type ScholarRosterLookup,
} from './scholar-fetch';

/**
 * Candidate source for resolving `count` accounts.
 *
 * One account takes the indexed point query on `employeeId` and only scans the
 * table if that misses; many take one read, indexed once. Choosing per call is
 * what stops a single-row action in the console loading and bucketing all
 * 3,852 staff records to answer a question about one person.
 */
function rosterLookupFor(count: number): Promise<ScholarRosterLookup> {
  return count <= 1
    ? Promise.resolve(databaseScholarRoster())
    : loadScholarRoster().then(inMemoryScholarRoster);
}

export interface ScholarConsoleRun {
  id: string;
  status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED' | 'REFUSED';
  trigger: 'SELF' | 'ADMIN' | 'ADMIN_BULK';
  startedAt: Date;
  finishedAt: Date | null;
  papersFound: number;
  papersInserted: number;
  citationsUpdated: number;
  creditsUsed: number;
  errorText: string | null;
}

export interface ScholarConsoleRow {
  userId: string;
  name: string | null;
  email: string;
  role: string;
  /** The staff record this account resolves to, or why it resolves to none.
   *  An unresolvable row can never be fetched — the runner refuses before it
   *  spends anything — so the console greys it rather than hiding it. */
  staff:
    | {
        linked: true;
        facultyMemberId: string;
        nameEn: string;
        nameTh: string;
        facultyId: string;
        facultyName: string;
        departmentId: string | null;
        departmentName: string | null;
        isActive: boolean;
      }
    | { linked: false; reason: string };
  /** A Scholar profile is linked, so a fetch would spend credits on pages.
   *  Unbound targets refuse at the binding gate and cost exactly zero. */
  profileBound: boolean;
  scholarProfileId: string | null;
  scholarBoundAt: Date | null;
  /** `research_outputs` rows on the staff record, split by writer. */
  papersFromScholar: number;
  papersFromLibrary: number;
  lastRun: ScholarConsoleRun | null;
  /**
   * The THIRD gate, reported rather than left to be inferred from a date.
   *
   * Resolution and binding are visible in the two columns above; the 30-day
   * quota is not, and without it an operator selecting a faculty of 90 people
   * refreshed three weeks ago gets a quote for work that will refuse. Null
   * when a fetch may start now — which is always the case for a SUPER_ADMIN,
   * who is exempt, so this is the viewing administrator's answer and not a
   * property of the person.
   */
  quotaRetryAt: Date | null;
  quotaReason: string | null;
}

export interface ScholarConsoleFilterOption {
  id: string;
  name: string;
  /** Rows that would remain if this were the only filter applied. Shown in
   *  the picker so an operator does not select a faculty and land on an
   *  empty table without knowing why. */
  count: number;
}

export interface ScholarConsoleRoster {
  rows: ScholarConsoleRow[];
  faculties: ScholarConsoleFilterOption[];
  /** Every department, each carrying its faculty so the picker can narrow
   *  when a faculty is chosen. */
  departments: Array<ScholarConsoleFilterOption & { facultyId: string }>;
  totals: {
    accounts: number;
    resolved: number;
    bound: number;
    /** Accounts that resolve to a staff record but have no Scholar profile
     *  linked. These are the people a bulk run would spend nothing on. */
    unbound: number;
    unresolved: number;
    /** Linked, but inside the 30-day window — a fetch refuses at step 2 and
     *  spends nothing, which is the same outcome as unbound by a different
     *  route. */
    quotaBlocked: number;
    /** Linked, outside the window: the people a fetch would actually spend
     *  credits on. */
    ready: number;
  };
}

export async function loadScholarConsoleRoster(input: {
  /** The VIEWING administrator's role. SUPER_ADMIN is exempt from the fetch
   *  quota, so the same roster is quota-blocked for one administrator and
   *  clear for another. */
  actorRole: string;
  now?: Date;
}): Promise<ScholarConsoleRoster> {
  const now = input.now ?? new Date();
  const [users, roster, memberMeta] = await Promise.all([
    prisma.user.findMany({
      select: { id: true, name: true, email: true, employeeId: true, role: true },
      orderBy: { email: 'asc' },
    }),
    loadScholarRoster(),
    prisma.facultyMember.findMany({
      select: {
        id: true,
        facultyId: true,
        departmentId: true,
        scholarBoundAt: true,
        faculty: { select: { id: true, nameEn: true, nameTh: true } },
        department: { select: { id: true, nameEn: true, nameTh: true } },
      },
    }),
  ]);

  const lookup = inMemoryScholarRoster(roster);
  const resolutions = await Promise.all(
    users.map(async (u) => ({ user: u, resolved: await resolveScholarMember(u, lookup) })),
  );

  const linkedMemberIds = resolutions
    .map((r) => r.resolved.member?.id)
    .filter((id): id is string => typeof id === 'string');

  const [outputCounts, runs] = await Promise.all([
    countPapersBySource(linkedMemberIds),
    runsPerUser(users.map((u) => u.id), now),
  ]);

  const metaById = new Map(memberMeta.map((m) => [m.id, m]));

  const rows: ScholarConsoleRow[] = resolutions.map(({ user, resolved }) => {
    const member = resolved.member;
    const meta = member ? metaById.get(member.id) : undefined;
    const counts = member ? outputCounts.get(member.id) : undefined;
    const history = runs.get(user.id);
    const quota = decideScholarQuota({
      trigger: 'ADMIN',
      actorRole: input.actorRole,
      runs: history?.window ?? [],
      now,
    });
    return {
      userId: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      staff:
        member && meta
          ? {
              linked: true,
              facultyMemberId: member.id,
              nameEn: member.nameEn,
              nameTh: member.nameTh,
              facultyId: meta.facultyId,
              // English first, Thai as the fallback: the UI is English-only,
              // but a faculty seeded without an English name must still be
              // nameable rather than render as a blank filter option.
              facultyName: meta.faculty?.nameEn || meta.faculty?.nameTh || meta.facultyId,
              departmentId: meta.departmentId,
              departmentName: meta.department
                ? meta.department.nameEn || meta.department.nameTh
                : null,
              isActive: member.isActive,
            }
          : {
              linked: false,
              reason:
                resolved.refusal ?? 'No single staff record matches this account.',
            },
      profileBound: Boolean(member?.scholarProfileId),
      scholarProfileId: member?.scholarProfileId ?? null,
      scholarBoundAt: meta?.scholarBoundAt ?? null,
      papersFromScholar: counts?.scholar ?? 0,
      papersFromLibrary: counts?.library ?? 0,
      lastRun: history?.latest ?? null,
      // ADMIN, not ADMIN_BULK: the two share one counter, and this is the
      // answer to "could I fetch this person", which is a row action.
      quotaRetryAt: quota.allowed ? null : (quota.retryAt ?? null),
      quotaReason: quota.allowed ? null : (quota.reason ?? null),
    };
  });

  return {
    rows,
    faculties: facultyOptions(rows),
    departments: departmentOptions(rows),
    totals: {
      accounts: rows.length,
      resolved: rows.filter((r) => r.staff.linked).length,
      bound: rows.filter((r) => r.profileBound).length,
      unbound: rows.filter((r) => r.staff.linked && !r.profileBound).length,
      unresolved: rows.filter((r) => !r.staff.linked).length,
      quotaBlocked: rows.filter((r) => r.profileBound && r.quotaRetryAt !== null).length,
      ready: rows.filter((r) => r.profileBound && r.quotaRetryAt === null).length,
    },
  };
}

function facultyOptions(rows: readonly ScholarConsoleRow[]): ScholarConsoleFilterOption[] {
  const byId = new Map<string, ScholarConsoleFilterOption>();
  for (const row of rows) {
    if (!row.staff.linked) continue;
    const existing = byId.get(row.staff.facultyId);
    if (existing) existing.count += 1;
    else byId.set(row.staff.facultyId, { id: row.staff.facultyId, name: row.staff.facultyName, count: 1 });
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function departmentOptions(
  rows: readonly ScholarConsoleRow[],
): Array<ScholarConsoleFilterOption & { facultyId: string }> {
  const byId = new Map<string, ScholarConsoleFilterOption & { facultyId: string }>();
  for (const row of rows) {
    if (!row.staff.linked) continue;
    const { departmentId, departmentName, facultyId } = row.staff;
    if (!departmentId || !departmentName) continue;
    const existing = byId.get(departmentId);
    if (existing) existing.count += 1;
    else byId.set(departmentId, { id: departmentId, name: departmentName, facultyId, count: 1 });
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ── Bulk pre-flight ────────────────────────────────────────────────────────

/**
 * One target's fate, decided against the SAME gates `runScholarFetch` applies,
 * in the same order.
 *
 *   resolution — no single staff record, so the run refuses before writing
 *   anything at all. Not enqueued: its job would vanish without a ledger row.
 *
 *   quota (runner step 2) — already fetched inside the 30-day window. Enqueued,
 *   refuses, writes a REFUSED row, spends NOTHING.
 *
 *   binding (runner step 4) — no linked profile. Enqueued, refuses, writes the
 *   `needs-binding` row that puts "link your profile" in front of the person,
 *   spends nothing.
 *
 * The order matters for what a target is REPORTED as, not only for what it
 * costs: quota is checked before binding, so a person who is both unlinked and
 * inside their window is a quota refusal, because that is the gate they hit.
 */
export interface ScholarBulkTargetPlan {
  userId: string;
  /** A profile is linked. Necessary but no longer sufficient for a charge —
   *  see `quotaBlocked`. */
  profileBound: boolean;
  /** Inside the 30-day window for this trigger, so the run refuses at step 2
   *  and spends nothing however well linked the profile is. */
  quotaBlocked: boolean;
  quotaRetryAt: Date | null;
  quotaReason: string | null;
  /** No single staff record matches this account. */
  resolutionRefusal: string | null;
}

export interface ScholarBulkPlan {
  targets: ScholarBulkTargetPlan[];
  /** Targets that will be enqueued: everything that resolves. */
  runnable: ScholarBulkTargetPlan[];
  /** Targets that will NOT be enqueued, with the reason. */
  skipped: ScholarBulkTargetPlan[];
  /**
   * How many targets will actually reach Google, and therefore the only ones
   * the estimate charges for.
   *
   * This is the number the console quotes and the number the API re-derives
   * before enqueueing: a quote is only a promise if both sides compute it the
   * same way. See `enqueueBulk`'s stale-quote refusal.
   */
  chargeableCount: number;
}

/**
 * Price and classify a bulk run WITHOUT enqueueing anything.
 *
 * Three queries regardless of target count — accounts, roster, ledger — then
 * everything else in memory. The naive shape is a resolve and a ledger read
 * per target, which at the 100-target cap is 200 round trips inside one HTTP
 * request.
 */
export async function planScholarBulkTargets(input: {
  userIds: readonly string[];
  /** The ADMIN's role, not the target's. SUPER_ADMIN is exempt from the quota
   *  outright, so the same roster is quota-blocked for one administrator and
   *  clear for another — the plan has to say whose view it is. */
  actorRole: string;
  /** `ADMIN` and `ADMIN_BULK` share one counter; `SELF` has its own. */
  trigger: ScholarTrigger;
  now?: Date;
}): Promise<ScholarBulkPlan> {
  const now = input.now ?? new Date();
  const distinct = [...new Set(input.userIds.map((id) => id.trim()).filter(Boolean))];

  const [accounts, lookup, ledger] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: distinct } },
      select: { id: true, name: true, employeeId: true },
    }),
    rosterLookupFor(distinct.length),
    prisma.scholarFetchRun.findMany({
      where: {
        userId: { in: distinct },
        startedAt: { gte: new Date(now.getTime() - SCHOLAR_LEDGER_LOOKBACK_MS) },
      },
      select: { userId: true, trigger: true, status: true, startedAt: true },
    }),
  ]);

  const known = new Map<string, ScholarAccount>(accounts.map((a) => [a.id, a]));
  const runsByUser = new Map<string, Array<{ trigger: ScholarTrigger; status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED' | 'REFUSED'; startedAt: Date }>>();
  for (const { userId, ...run } of ledger) {
    const existing = runsByUser.get(userId);
    if (existing) existing.push(run);
    else runsByUser.set(userId, [run]);
  }

  const targets: ScholarBulkTargetPlan[] = [];
  for (const userId of distinct) {
    const account = known.get(userId);
    if (!account) {
      // An id with no user behind it. The runner refuses on the same ground,
      // so it is reported as a resolution failure rather than silently
      // dropped — the dialog's counts have to add up to the target count.
      targets.push({
        userId,
        profileBound: false,
        quotaBlocked: false,
        quotaRetryAt: null,
        quotaReason: null,
        resolutionRefusal: 'No user record for this account.',
      });
      continue;
    }
    const { member, refusal } = await resolveScholarMember(account, lookup);
    if (!member) {
      targets.push({
        userId,
        profileBound: false,
        quotaBlocked: false,
        quotaRetryAt: null,
        quotaReason: null,
        resolutionRefusal: refusal ?? 'No single staff record matches this account.',
      });
      continue;
    }
    const quota = decideScholarQuota({
      trigger: input.trigger,
      actorRole: input.actorRole,
      runs: runsByUser.get(userId) ?? [],
      now,
    });
    targets.push({
      userId,
      profileBound: Boolean(member.scholarProfileId),
      quotaBlocked: !quota.allowed,
      quotaRetryAt: quota.retryAt ?? null,
      quotaReason: quota.allowed ? null : (quota.reason ?? null),
      resolutionRefusal: null,
    });
  }

  const runnable = targets.filter((t) => t.resolutionRefusal === null);
  return {
    targets,
    runnable,
    skipped: targets.filter((t) => t.resolutionRefusal !== null),
    chargeableCount: runnable.filter((t) => t.profileBound && !t.quotaBlocked).length,
  };
}

/**
 * Papers per staff record, split into the Scholar writer and everything else.
 *
 * One `groupBy` rather than a count per row. `source` is nullable on
 * `ResearchOutput` (rows predating provenance tracking), and a null source is
 * NOT Scholar — the runner always stamps its own — so it counts as library.
 *
 * The comparison MUST go through `SCHOLAR_RESEARCH_OUTPUT_SOURCE`, which is
 * exported from the runner precisely because it is a join key rather than a
 * label. A hardcoded copy here compiles, and quietly reports zero Scholar
 * papers for everybody while the library index absorbs them — on the page
 * whose whole job is deciding whether to spend more credits. Exported so that
 * failure is a test rather than a discovery.
 */
export async function countPapersBySource(
  facultyMemberIds: readonly string[],
): Promise<Map<string, { scholar: number; library: number }>> {
  const out = new Map<string, { scholar: number; library: number }>();
  if (facultyMemberIds.length === 0) return out;
  const grouped = await prisma.researchOutput.groupBy({
    by: ['facultyMemberId', 'source'],
    where: { facultyMemberId: { in: [...facultyMemberIds] } },
    _count: { _all: true },
  });
  for (const g of grouped) {
    if (!g.facultyMemberId) continue;
    const bucket = out.get(g.facultyMemberId) ?? { scholar: 0, library: 0 };
    if (g.source === SCHOLAR_RESEARCH_OUTPUT_SOURCE) bucket.scholar += g._count._all;
    else bucket.library += g._count._all;
    out.set(g.facultyMemberId, bucket);
  }
  return out;
}

/**
 * Per account: the newest run, and every run inside the quota window.
 *
 * One query for both, because they come from the same rows and the console
 * needs both — the newest run to render "last fetch", and the window to ask
 * `decideScholarQuota` whether another one may start. Reading the newest run
 * alone and comparing its date by hand would be a second, weaker definition of
 * the window; the quota unit is the only one.
 *
 * Bounded by `SCHOLAR_LEDGER_LOOKBACK_MS` (90 days, 3x the window) rather than
 * reading the whole table, which also bounds a ledger that otherwise grows by
 * roughly two rows per active person per month forever. The cost is that a
 * person whose only fetch was more than 90 days ago reads as "never fetched"
 * in the last-fetch column. That is the same horizon every other surface in
 * this feature uses, and the run ledger below the table is where full history
 * lives.
 */
async function runsPerUser(
  userIds: readonly string[],
  now: Date,
): Promise<
  Map<
    string,
    {
      latest: ScholarConsoleRun | null;
      window: Array<{ trigger: ScholarTrigger; status: ScholarConsoleRun['status']; startedAt: Date }>;
    }
  >
> {
  const out = new Map<
    string,
    {
      latest: ScholarConsoleRun | null;
      window: Array<{ trigger: ScholarTrigger; status: ScholarConsoleRun['status']; startedAt: Date }>;
    }
  >();
  if (userIds.length === 0) return out;
  const rows = await prisma.scholarFetchRun.findMany({
    where: {
      userId: { in: [...userIds] },
      startedAt: { gte: new Date(now.getTime() - SCHOLAR_LEDGER_LOOKBACK_MS) },
    },
    // Ascending, so the last write per user wins and is the newest — cheaper
    // than a correlated subquery per user and, unlike `distinct`, it does not
    // depend on Prisma's ordering interacting with the distinct clause in the
    // way one hopes.
    orderBy: { startedAt: 'asc' },
    select: {
      id: true,
      userId: true,
      status: true,
      trigger: true,
      startedAt: true,
      finishedAt: true,
      papersFound: true,
      papersInserted: true,
      citationsUpdated: true,
      creditsUsed: true,
      errorText: true,
    },
  });
  for (const { userId, ...run } of rows) {
    const entry = out.get(userId) ?? { latest: null, window: [] };
    entry.latest = run;
    entry.window.push({ trigger: run.trigger, status: run.status, startedAt: run.startedAt });
    out.set(userId, entry);
  }
  return out;
}
