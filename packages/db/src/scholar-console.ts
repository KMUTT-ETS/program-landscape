// packages/db/src/scholar-console.ts
//
// The roster behind the admin Scholar console (`apps/web/app/admin/scholar`).
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

import { prisma } from './index';
import {
  inMemoryScholarRoster,
  loadScholarRoster,
  resolveScholarMember,
  type ScholarFacultyMember,
} from './scholar-fetch';

/** `ResearchOutput.source` written by the Scholar runner. Everything else is
 *  the curated library pipeline (Scopus / the kku-publications mirror). */
export const SCHOLAR_RESEARCH_SOURCE = 'google-scholar';

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
  };
}

export async function loadScholarConsoleRoster(): Promise<ScholarConsoleRoster> {
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
    latestRunPerUser(users.map((u) => u.id)),
  ]);

  const metaById = new Map(memberMeta.map((m) => [m.id, m]));

  const rows: ScholarConsoleRow[] = resolutions.map(({ user, resolved }) => {
    const member = resolved.member;
    const meta = member ? metaById.get(member.id) : undefined;
    const counts = member ? outputCounts.get(member.id) : undefined;
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
      lastRun: runs.get(user.id) ?? null,
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

/**
 * Papers per staff record, split into the Scholar writer and everything else.
 *
 * One `groupBy` rather than a count per row. `source` is nullable on
 * `ResearchOutput` (rows predating provenance tracking), and a null source is
 * NOT Scholar — the runner always stamps its own — so it counts as library.
 */
async function countPapersBySource(
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
    if (g.source === SCHOLAR_RESEARCH_SOURCE) bucket.scholar += g._count._all;
    else bucket.library += g._count._all;
    out.set(g.facultyMemberId, bucket);
  }
  return out;
}

/**
 * The newest run per account.
 *
 * Ordered ascending and overwritten as it walks, so the last write per user
 * wins and is the newest — cheaper than a correlated subquery per user and,
 * unlike `distinct`, does not depend on Prisma's ordering interacting with
 * the distinct clause in the way one hopes.
 *
 * It reads every run rather than only the newest, which is bounded by the
 * quota rather than by this query: a person may consume one self-triggered
 * and one administrator-triggered run per 30 days, so the table grows by
 * roughly two rows per active person per month. Revisit if the console starts
 * feeling slow — the fix is a lateral join, not a per-row query.
 */
async function latestRunPerUser(
  userIds: readonly string[],
): Promise<Map<string, ScholarConsoleRun>> {
  const out = new Map<string, ScholarConsoleRun>();
  if (userIds.length === 0) return out;
  const runs = await prisma.scholarFetchRun.findMany({
    where: { userId: { in: [...userIds] } },
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
  for (const { userId, ...run } of runs) out.set(userId, run);
  return out;
}

/** Re-exported so the console's server actions can type a roster without
 *  reaching past this module. */
export type { ScholarFacultyMember };
