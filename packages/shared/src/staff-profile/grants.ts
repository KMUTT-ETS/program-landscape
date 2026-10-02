// Research & academic-service grants for one staff member — the summary behind
// the /profile "Grants & academic service" panel and the external API's `grants`
// section. Browser-safe on purpose (types + pure maths only): the panel imports
// its types from here. Budget is always the WHOLE project's budget — the source
// states no per-person share, so none is invented.

export const GRANT_PROJECT_TYPES = ['RESEARCH', 'ACADEMIC_SERVICE', 'CONSULTING', 'OTHER'] as const;
export type GrantProjectType = (typeof GRANT_PROJECT_TYPES)[number];
export type GrantRole = 'LEAD' | 'CO_INVESTIGATOR';

export interface StaffGrantEntry {
  sourceProposalId: number;
  titleTh: string;
  titleEn: string | null;
  type: GrantProjectType;
  role: GrantRole;
  fiscalYearBe: number;
  /** ISO date `YYYY-MM-DD`, Bangkok calendar day. */
  startDate: string | null;
  endDate: string | null;
  funderName: string | null;
  /** Whole-project budget, THB. */
  budgetThb: number | null;
  workflowStatus: string;
  teamSize: number;
}

export interface StaffGrantsSummary {
  led: number;
  coInvestigator: number;
  active: number;
  byType: Record<GrantProjectType, number>;
  /** Sum of whole-project budgets, each project once; projects with no stated budget add 0. */
  totalBudgetThb: number;
  /** One row per fiscal year from the first to the last, oldest first; empty years are zero rows. */
  byYear: GrantYearTotal[];
  projects: StaffGrantEntry[];
  /** Completion time of the sync the rows came from. */
  freshnessDate: string | null;
}

export interface GrantYearTotal {
  fiscalYearBe: number;
  /** Project totals of projects this person led. */
  ledThb: number;
  /** Project totals of projects this person was a co-investigator on. */
  coThb: number;
  projects: number;
}

function bangkokDay(d: Date): string {
  return new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
}

export function summariseStaffGrants(
  entries: readonly StaffGrantEntry[],
  today: Date,
  freshnessDate: string | null,
): StaffGrantsSummary {
  const byProject = new Map<number, StaffGrantEntry>();
  for (const entry of entries) {
    const prev = byProject.get(entry.sourceProposalId);
    if (!prev || (prev.role === 'CO_INVESTIGATOR' && entry.role === 'LEAD')) {
      byProject.set(entry.sourceProposalId, entry);
    }
  }
  const projects = [...byProject.values()].sort(
    (a, b) =>
      b.fiscalYearBe - a.fiscalYearBe ||
      (a.role === b.role ? 0 : a.role === 'LEAD' ? -1 : 1) ||
      a.titleTh.localeCompare(b.titleTh, 'th') ||
      a.sourceProposalId - b.sourceProposalId,
  );
  const day = bangkokDay(today);
  const byType: Record<GrantProjectType, number> = {
    RESEARCH: 0,
    ACADEMIC_SERVICE: 0,
    CONSULTING: 0,
    OTHER: 0,
  };
  let led = 0;
  let active = 0;
  let totalBudgetThb = 0;
  const years = new Map<number, GrantYearTotal>();
  for (const p of projects) {
    byType[p.type] += 1;
    if (p.role === 'LEAD') led += 1;
    if (p.startDate && p.endDate && p.startDate <= day && day <= p.endDate) active += 1;
    const budget = p.budgetThb ?? 0;
    totalBudgetThb += budget;
    const y = years.get(p.fiscalYearBe) ?? { fiscalYearBe: p.fiscalYearBe, ledThb: 0, coThb: 0, projects: 0 };
    if (p.role === 'LEAD') y.ledThb += budget;
    else y.coThb += budget;
    y.projects += 1;
    years.set(p.fiscalYearBe, y);
  }
  const byYear: GrantYearTotal[] = [];
  if (years.size > 0) {
    const first = Math.min(...years.keys());
    const last = Math.max(...years.keys());
    for (let fy = first; fy <= last; fy += 1) {
      byYear.push(years.get(fy) ?? { fiscalYearBe: fy, ledThb: 0, coThb: 0, projects: 0 });
    }
  }
  return {
    led,
    coInvestigator: projects.length - led,
    active,
    byType,
    totalBudgetThb,
    byYear,
    projects,
    freshnessDate,
  };
}
