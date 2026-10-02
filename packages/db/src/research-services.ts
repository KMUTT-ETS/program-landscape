// KKU Research & Academic Services — read model for the Staff grants
// dashboard, the project side panel, and the per-person loader shared by
// /profile and the external Staff Profile API.
//
// Attribution (spec D4): a faculty is credited with a project for EVERY
// faculty that has a team member on it, so faculty counts sum to more than
// the KKU total. Money is never split: the KKU total counts each project's
// budget once, and a person's figure is always the project total.
//
// Plain Prisma queries + in-memory aggregation (~4.3k projects). No raw SQL,
// so no Prisma.sql fragments — /profile calls getStaffGrants inside Next.js.

import { summariseStaffGrants, type StaffGrantEntry, type StaffGrantsSummary } from '@kku/shared';
import { prisma } from './index';
import { realDataWhere } from './data-quality';

export type GrantType = 'RESEARCH' | 'ACADEMIC_SERVICE' | 'CONSULTING' | 'OTHER';
export const GRANTS_SOURCE_SLUG = 'kku-research-services';

export interface GrantMemberRow {
  role: 'LEAD' | 'CO_INVESTIGATOR';
  facultyMemberId: string | null;
  displayName: string | null;
  facultyName: string | null;
}

export interface GrantProjectRow {
  id: string;
  sourceProposalId: number;
  titleTh: string;
  titleEn: string | null;
  type: GrantType;
  fiscalYearBe: number;
  startDate: Date | null;
  endDate: Date | null;
  budgetThb: bigint | null;
  funderName: string | null;
  workflowStatus: string;
  leadFacultyName: string;
  members: GrantMemberRow[];
}

export interface GrantsFilter {
  facultyName: string[];
  yearFrom?: number;
  yearTo?: number;
  type?: GrantType[];
  funder?: string[];
  page: number;
  pageSize: number;
  sort: 'year' | 'budget' | 'title';
}

export interface GrantsTableRow {
  id: string;
  titleTh: string;
  titleEn: string | null;
  type: GrantType;
  fiscalYearBe: number;
  leadName: string | null;
  leadFacultyName: string;
  funderName: string | null;
  budgetThb: number | null;
  teamSize: number;
  workflowStatus: string;
}

export interface GrantsDashboard {
  kpis: { projects: number; budgetThb: number; staffInvolved: number; membersTotal: number; membersMatched: number };
  trend: Array<{ fiscalYearBe: number; RESEARCH: number; ACADEMIC_SERVICE: number; OTHER: number; budgetThb: number }>;
  byFaculty: Array<{ facultyName: string; led: number; coOnly: number; total: number }>;
  topFunders: Array<{ funderName: string | null; projects: number; budgetThb: number }>;
  table: { total: number; page: number; pageSize: number; rows: GrantsTableRow[] };
}

const num = (b: bigint | null): number | null => (b === null ? null : Number(b));

export function aggregateGrants(rows: readonly GrantProjectRow[], f: GrantsFilter): GrantsDashboard {
  const facultyFilter = f.facultyName.length > 0 ? new Set(f.facultyName) : null;
  const staff = new Set<string>();
  let membersTotal = 0;
  let membersMatched = 0;
  let budget = 0;
  const trend = new Map<number, GrantsDashboard['trend'][number]>();
  const fac = new Map<string, { led: number; coOnly: number }>();
  const funders = new Map<string | null, { projects: number; budgetThb: number }>();

  for (const r of rows) {
    const b = num(r.budgetThb) ?? 0;
    budget += b;
    for (const m of r.members) {
      membersTotal += 1;
      if (m.facultyMemberId) {
        membersMatched += 1;
        staff.add(m.facultyMemberId);
      }
    }
    const t = trend.get(r.fiscalYearBe) ?? { fiscalYearBe: r.fiscalYearBe, RESEARCH: 0, ACADEMIC_SERVICE: 0, OTHER: 0, budgetThb: 0 };
    if (r.type === 'RESEARCH') t.RESEARCH += 1;
    else if (r.type === 'ACADEMIC_SERVICE') t.ACADEMIC_SERVICE += 1;
    else t.OTHER += 1;
    t.budgetThb += b;
    trend.set(r.fiscalYearBe, t);

    const participating = new Set(r.members.map((m) => m.facultyName).filter((n): n is string => !!n));
    participating.add(r.leadFacultyName);
    for (const name of participating) {
      if (facultyFilter && !facultyFilter.has(name)) continue;
      const row = fac.get(name) ?? { led: 0, coOnly: 0 };
      if (name === r.leadFacultyName) row.led += 1;
      else row.coOnly += 1;
      fac.set(name, row);
    }

    const fu = funders.get(r.funderName) ?? { projects: 0, budgetThb: 0 };
    fu.projects += 1;
    fu.budgetThb += b;
    funders.set(r.funderName, fu);
  }

  const sorted = [...rows].sort((a, b) => {
    if (f.sort === 'budget') return (num(b.budgetThb) ?? -1) - (num(a.budgetThb) ?? -1);
    if (f.sort === 'title') return a.titleTh.localeCompare(b.titleTh, 'th');
    return b.fiscalYearBe - a.fiscalYearBe || (num(b.budgetThb) ?? -1) - (num(a.budgetThb) ?? -1);
  });
  const start = (f.page - 1) * f.pageSize;

  return {
    kpis: { projects: rows.length, budgetThb: budget, staffInvolved: staff.size, membersTotal, membersMatched },
    trend: [...trend.values()].sort((a, b) => a.fiscalYearBe - b.fiscalYearBe),
    byFaculty: [...fac.entries()]
      .map(([facultyName, v]) => ({ facultyName, ...v, total: v.led + v.coOnly }))
      .sort((a, b) => b.total - a.total || a.facultyName.localeCompare(b.facultyName, 'th')),
    topFunders: [...funders.entries()]
      .map(([funderName, v]) => ({ funderName, ...v }))
      .sort((a, b) => b.projects - a.projects)
      .slice(0, 15),
    table: {
      total: rows.length,
      page: f.page,
      pageSize: f.pageSize,
      rows: sorted.slice(start, start + f.pageSize).map((r) => ({
        id: r.id,
        titleTh: r.titleTh,
        titleEn: r.titleEn,
        type: r.type,
        fiscalYearBe: r.fiscalYearBe,
        leadName: r.members.find((m) => m.role === 'LEAD')?.displayName ?? null,
        leadFacultyName: r.leadFacultyName,
        funderName: r.funderName,
        budgetThb: num(r.budgetThb),
        teamSize: r.members.length,
        workflowStatus: r.workflowStatus,
      })),
    },
  };
}

const PROJECT_SELECT = {
  id: true, sourceProposalId: true, titleTh: true, titleEn: true, type: true, fiscalYearBe: true,
  startDate: true, endDate: true, budgetThb: true, funderName: true, workflowStatus: true, leadFacultyName: true,
  members: { select: { role: true, facultyMemberId: true, displayName: true, facultyName: true } },
} as const;

/** Rows visible to the filter: a project is in a faculty scope when ANY team member is. */
async function loadRows(f: GrantsFilter): Promise<GrantProjectRow[]> {
  return prisma.researchServiceProject.findMany({
    where: {
      ...realDataWhere(),
      ...(f.yearFrom || f.yearTo ? { fiscalYearBe: { gte: f.yearFrom, lte: f.yearTo } } : {}),
      ...(f.type && f.type.length > 0 ? { type: { in: f.type } } : {}),
      ...(f.funder && f.funder.length > 0 ? { funderName: { in: f.funder } } : {}),
      ...(f.facultyName.length > 0 ? { members: { some: { facultyName: { in: f.facultyName } } } } : {}),
    },
    select: PROJECT_SELECT,
  });
}

/** Completion time of the latest successful sync, or null before the first. */
export async function grantsFreshness(): Promise<{ runId: string; completedAt: Date } | null> {
  const run = await prisma.ingestionRun.findFirst({
    where: { status: 'SUCCEEDED', dataSource: { slug: GRANTS_SOURCE_SLUG } },
    orderBy: { completedAt: 'desc' },
    select: { id: true, completedAt: true },
  });
  return run?.completedAt ? { runId: run.id, completedAt: run.completedAt } : null;
}

export async function getGrantsDashboard(
  f: GrantsFilter,
): Promise<GrantsDashboard & { options: { yearMin: number | null; yearMax: number | null; funders: string[] } }> {
  const [rows, years, funderRows] = await Promise.all([
    loadRows(f),
    prisma.researchServiceProject.aggregate({ where: realDataWhere(), _min: { fiscalYearBe: true }, _max: { fiscalYearBe: true } }),
    prisma.researchServiceProject.groupBy({
      by: ['funderName'],
      where: { ...realDataWhere(), funderName: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { funderName: 'desc' } },
      take: 50,
    }),
  ]);
  return {
    ...aggregateGrants(rows, f),
    options: {
      yearMin: years._min.fiscalYearBe,
      yearMax: years._max.fiscalYearBe,
      funders: funderRows.map((r) => r.funderName).filter((n): n is string => !!n),
    },
  };
}

export interface GrantProjectDetail {
  id: string;
  titleTh: string;
  titleEn: string | null;
  type: GrantType;
  typeRaw: string;
  fiscalYearBe: number;
  startDate: string | null;
  endDate: string | null;
  budgetThb: number | null;
  funderName: string | null;
  keywords: string | null;
  workflowStatus: string;
  leadFacultyName: string;
  team: Array<{ role: 'LEAD' | 'CO_INVESTIGATOR'; displayName: string | null; facultyName: string | null; matched: boolean }>;
}

/** Null when the project does not exist or no team member is inside `facultyNames` (null = all). */
export async function getGrantProjectDetail(
  id: string,
  facultyNames: string[] | null,
): Promise<GrantProjectDetail | null> {
  const p = await prisma.researchServiceProject.findFirst({
    where: {
      id,
      ...realDataWhere(),
      ...(facultyNames ? { members: { some: { facultyName: { in: facultyNames } } } } : {}),
    },
    select: {
      id: true, titleTh: true, titleEn: true, type: true, typeRaw: true, fiscalYearBe: true, startDate: true,
      endDate: true, budgetThb: true, funderName: true, keywords: true, workflowStatus: true, leadFacultyName: true,
      members: {
        select: { role: true, displayName: true, facultyName: true, facultyMemberId: true },
        orderBy: [{ role: 'asc' }, { displayName: 'asc' }],
      },
    },
  });
  if (!p) return null;
  return {
    id: p.id, titleTh: p.titleTh, titleEn: p.titleEn, type: p.type, typeRaw: p.typeRaw, fiscalYearBe: p.fiscalYearBe,
    startDate: bangkokDay(p.startDate), endDate: bangkokDay(p.endDate), budgetThb: num(p.budgetThb),
    funderName: p.funderName, keywords: p.keywords, workflowStatus: p.workflowStatus, leadFacultyName: p.leadFacultyName,
    team: p.members.map((m) => ({ role: m.role, displayName: m.displayName, facultyName: m.facultyName, matched: !!m.facultyMemberId })),
  };
}

function bangkokDay(d: Date | null): string | null {
  return d ? new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10) : null;
}

export function toStaffGrantEntry(r: GrantProjectRow, role: 'LEAD' | 'CO_INVESTIGATOR'): StaffGrantEntry {
  return {
    sourceProposalId: r.sourceProposalId,
    titleTh: r.titleTh,
    titleEn: r.titleEn,
    type: r.type,
    role,
    fiscalYearBe: r.fiscalYearBe,
    startDate: bangkokDay(r.startDate),
    endDate: bangkokDay(r.endDate),
    funderName: r.funderName,
    budgetThb: num(r.budgetThb),
    workflowStatus: r.workflowStatus,
    teamSize: r.members.length,
  };
}

/** One staff member's grants. Callers enforce visibility: /profile passes the
 *  session user's own record; the external API calls it only for clients
 *  granted the `grants` section. */
export async function getStaffGrants(facultyMemberId: string): Promise<StaffGrantsSummary> {
  const [memberships, fresh] = await Promise.all([
    prisma.researchServiceProjectMember.findMany({
      where: { facultyMemberId, ...realDataWhere() },
      select: { role: true, project: { select: PROJECT_SELECT } },
    }),
    grantsFreshness(),
  ]);
  return summariseStaffGrants(
    memberships.map((m) => toStaffGrantEntry(m.project, m.role)),
    new Date(),
    fresh?.completedAt.toISOString() ?? null,
  );
}
