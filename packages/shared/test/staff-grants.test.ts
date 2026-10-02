import { describe, expect, it } from 'vitest';
import { summariseStaffGrants, type StaffGrantEntry } from '../src/staff-profile/grants';

const e = (over: Partial<StaffGrantEntry>): StaffGrantEntry => ({
  sourceProposalId: 1,
  titleTh: 'โครงการ',
  titleEn: null,
  type: 'RESEARCH',
  role: 'LEAD',
  fiscalYearBe: 2568,
  startDate: null,
  endDate: null,
  funderName: null,
  budgetThb: null,
  workflowStatus: 'x',
  teamSize: 1,
  ...over,
});
const TODAY = new Date('2026-10-02T05:00:00Z');

describe('summariseStaffGrants', () => {
  it('counts led and co-investigator projects and types', () => {
    const s = summariseStaffGrants(
      [
        e({ sourceProposalId: 1 }),
        e({ sourceProposalId: 2, role: 'CO_INVESTIGATOR', type: 'ACADEMIC_SERVICE' }),
      ],
      TODAY,
      null,
    );
    expect(s.led).toBe(1);
    expect(s.coInvestigator).toBe(1);
    expect(s.byType).toEqual({ RESEARCH: 1, ACADEMIC_SERVICE: 1, CONSULTING: 0, OTHER: 0 });
  });

  it('keeps one entry per project, preferring LEAD when a person is listed twice', () => {
    const s = summariseStaffGrants(
      [
        e({ sourceProposalId: 7, role: 'CO_INVESTIGATOR' }),
        e({ sourceProposalId: 7, role: 'LEAD' }),
      ],
      TODAY,
      null,
    );
    expect(s.projects).toHaveLength(1);
    expect(s.projects[0]!.role).toBe('LEAD');
    expect(s.led).toBe(1);
    expect(s.coInvestigator).toBe(0);
  });

  it('counts a project active only when today falls inside both stated dates', () => {
    const s = summariseStaffGrants(
      [
        e({ sourceProposalId: 1, startDate: '2026-01-01', endDate: '2026-12-31' }),
        e({ sourceProposalId: 2, startDate: '2025-01-01', endDate: '2025-12-31' }),
        e({ sourceProposalId: 3, startDate: '2026-01-01', endDate: null }),
      ],
      TODAY,
      null,
    );
    expect(s.active).toBe(1);
  });

  it('sorts newest fiscal year first, then lead before co-investigator, then title', () => {
    const s = summariseStaffGrants(
      [
        e({ sourceProposalId: 1, fiscalYearBe: 2566, titleTh: 'ก' }),
        e({ sourceProposalId: 2, fiscalYearBe: 2569, role: 'CO_INVESTIGATOR', titleTh: 'ก' }),
        e({ sourceProposalId: 3, fiscalYearBe: 2569, titleTh: 'ข' }),
      ],
      TODAY,
      '2026-10-02T04:00:00.000Z',
    );
    expect(s.projects.map((p) => p.sourceProposalId)).toEqual([3, 2, 1]);
    expect(s.freshnessDate).toBe('2026-10-02T04:00:00.000Z');
  });

  it('breaks a full tie by source proposal id so the order is deterministic', () => {
    const s = summariseStaffGrants(
      [e({ sourceProposalId: 9, titleTh: 'ก' }), e({ sourceProposalId: 4, titleTh: 'ก' })],
      TODAY,
      null,
    );
    expect(s.projects.map((p) => p.sourceProposalId)).toEqual([4, 9]);
  });

  it('keeps LEAD when LEAD is seen first and CO_INVESTIGATOR follows', () => {
    const s = summariseStaffGrants(
      [
        e({ sourceProposalId: 7, role: 'LEAD' }),
        e({ sourceProposalId: 7, role: 'CO_INVESTIGATOR' }),
      ],
      TODAY,
      null,
    );
    expect(s.projects).toHaveLength(1);
    expect(s.projects[0]!.role).toBe('LEAD');
  });
});

describe('summariseStaffGrants — budget totals', () => {
  it('sums each project budget once, skipping projects with no stated budget', () => {
    const s = summariseStaffGrants(
      [
        e({ sourceProposalId: 1, budgetThb: 1_000 }),
        e({ sourceProposalId: 1, role: 'CO_INVESTIGATOR', budgetThb: 1_000 }),
        e({ sourceProposalId: 2, role: 'CO_INVESTIGATOR', budgetThb: 500 }),
        e({ sourceProposalId: 3, budgetThb: null }),
      ],
      TODAY,
      null,
    );
    expect(s.totalBudgetThb).toBe(1_500);
  });

  it('builds a continuous fiscal-year series, oldest first, split by role', () => {
    const s = summariseStaffGrants(
      [
        e({ sourceProposalId: 1, fiscalYearBe: 2565, budgetThb: 100 }),
        e({ sourceProposalId: 2, fiscalYearBe: 2567, role: 'CO_INVESTIGATOR', budgetThb: 40 }),
        e({ sourceProposalId: 3, fiscalYearBe: 2567, budgetThb: 10 }),
        e({ sourceProposalId: 4, fiscalYearBe: 2567, budgetThb: null }),
      ],
      TODAY,
      null,
    );
    expect(s.byYear).toEqual([
      { fiscalYearBe: 2565, ledThb: 100, coThb: 0, projects: 1 },
      { fiscalYearBe: 2566, ledThb: 0, coThb: 0, projects: 0 },
      { fiscalYearBe: 2567, ledThb: 10, coThb: 40, projects: 3 },
    ]);
  });

  it('returns an empty series and a zero total when there are no projects', () => {
    const s = summariseStaffGrants([], TODAY, null);
    expect(s.byYear).toEqual([]);
    expect(s.totalBudgetThb).toBe(0);
  });
});
