import { describe, expect, it } from 'vitest';
import { aggregateGrants, toStaffGrantEntry, type GrantProjectRow } from '../src/research-services';

const p = (over: Partial<GrantProjectRow>): GrantProjectRow => ({
  id: 'rsp-1',
  sourceProposalId: 1,
  titleTh: 'ก',
  titleEn: null,
  type: 'RESEARCH',
  fiscalYearBe: 2568,
  startDate: null,
  endDate: null,
  budgetThb: 100n,
  funderName: 'วช.',
  workflowStatus: 's',
  leadFacultyName: 'A',
  members: [{ role: 'LEAD', facultyMemberId: 'm1', displayName: 'L', facultyName: 'A' }],
  ...over,
});

describe('aggregateGrants', () => {
  const rows = [
    p({
      id: 'rsp-1',
      budgetThb: 100n,
      members: [
        { role: 'LEAD', facultyMemberId: 'm1', displayName: 'L', facultyName: 'A' },
        { role: 'CO_INVESTIGATOR', facultyMemberId: 'm2', displayName: 'C', facultyName: 'B' },
      ],
    }),
    p({
      id: 'rsp-2',
      sourceProposalId: 2,
      type: 'ACADEMIC_SERVICE',
      fiscalYearBe: 2569,
      budgetThb: 50n,
      funderName: null,
      leadFacultyName: 'B',
      members: [{ role: 'LEAD', facultyMemberId: null, displayName: 'X', facultyName: 'B' }],
    }),
  ];

  it('counts each project once in the KKU total and its budget', () => {
    const r = aggregateGrants(rows, { facultyName: [], page: 1, pageSize: 50, sort: 'year' });
    expect(r.kpis).toMatchObject({
      projects: 2,
      budgetThb: 150,
      staffInvolved: 2,
      membersTotal: 3,
      membersMatched: 2,
    });
  });

  it('counts only members of the filtered faculties as staff involved', () => {
    const r = aggregateGrants(rows, { facultyName: ['A'], page: 1, pageSize: 50, sort: 'year' });
    // Project count and budget stay whole-project; the B co-investigator (m2) and the
    // B-only member are not this filter's staff.
    expect(r.kpis).toMatchObject({ projects: 2, staffInvolved: 1, membersTotal: 1, membersMatched: 1 });
  });

  it('credits every participating faculty, so faculty totals exceed the KKU total', () => {
    const r = aggregateGrants(rows, { facultyName: [], page: 1, pageSize: 50, sort: 'year' });
    const a = r.byFaculty.find((f) => f.facultyName === 'A')!;
    const b = r.byFaculty.find((f) => f.facultyName === 'B')!;
    expect(a).toMatchObject({ led: 1, coOnly: 0, total: 1 });
    expect(b).toMatchObject({ led: 1, coOnly: 1, total: 2 });
    expect(r.byFaculty.reduce((s, f) => s + f.total, 0)).toBeGreaterThan(r.kpis.projects);
  });

  it('limits faculty rows to the faculties in the filter', () => {
    const r = aggregateGrants(rows, { facultyName: ['B'], page: 1, pageSize: 50, sort: 'year' });
    expect(r.byFaculty.map((f) => f.facultyName)).toEqual(['B']);
  });

  it('trends by fiscal year and type, and ranks funders with an explicit unknown bucket', () => {
    const r = aggregateGrants(rows, { facultyName: [], page: 1, pageSize: 50, sort: 'year' });
    expect(r.trend).toEqual([
      { fiscalYearBe: 2568, RESEARCH: 1, ACADEMIC_SERVICE: 0, OTHER: 0, budgetThb: 100 },
      { fiscalYearBe: 2569, RESEARCH: 0, ACADEMIC_SERVICE: 1, OTHER: 0, budgetThb: 50 },
    ]);
    expect(r.topFunders[0]).toEqual({ funderName: 'วช.', projects: 1, budgetThb: 100 });
    expect(r.topFunders.find((f) => f.funderName === null)).toEqual({
      funderName: null,
      projects: 1,
      budgetThb: 50,
    });
  });

  it('pages and sorts the project table; rows carry no person ids or hashes', () => {
    const r = aggregateGrants(rows, { facultyName: [], page: 1, pageSize: 1, sort: 'budget' });
    expect(r.table.total).toBe(2);
    expect(r.table.rows).toHaveLength(1);
    expect(r.table.rows[0]!.id).toBe('rsp-1');
    expect(JSON.stringify(r.table.rows)).not.toMatch(/facultyMemberId|citizenIdHash/);
  });
});

describe('toStaffGrantEntry', () => {
  it('formats dates as Bangkok calendar days and budget as a number', () => {
    const e = toStaffGrantEntry(
      p({
        startDate: new Date('2025-09-30T17:00:00Z'),
        endDate: new Date('2026-09-29T17:00:00Z'),
        budgetThb: 205427844n,
      }),
      'CO_INVESTIGATOR',
    );
    expect(e).toMatchObject({
      startDate: '2025-10-01',
      endDate: '2026-09-30',
      budgetThb: 205427844,
      role: 'CO_INVESTIGATOR',
      teamSize: 1,
    });
  });
});

describe('aggregateGrants budget attribution', () => {
  it('counts a multi-faculty project budget once in the KKU total', () => {
    const multi = p({
      budgetThb: 1000n,
      members: [
        { role: 'LEAD', facultyMemberId: 'm1', displayName: 'L', facultyName: 'A' },
        { role: 'CO_INVESTIGATOR', facultyMemberId: 'm2', displayName: 'C', facultyName: 'B' },
        { role: 'CO_INVESTIGATOR', facultyMemberId: 'm3', displayName: 'D', facultyName: 'C' },
      ],
    });
    const r = aggregateGrants([multi], { facultyName: [], page: 1, pageSize: 50, sort: 'year' });
    expect(r.kpis.budgetThb).toBe(1000);
    expect(r.kpis.projects).toBe(1);
    expect(r.topFunders[0]!.budgetThb).toBe(1000);
    expect(r.trend[0]!.budgetThb).toBe(1000);
  });
});

describe('aggregateGrants hardening', () => {
  it('never yields an empty-named faculty row for a blank lead unit', () => {
    const r = aggregateGrants([p({ leadFacultyName: '' })], {
      facultyName: [],
      page: 1,
      pageSize: 50,
      sort: 'year',
    });
    expect(r.byFaculty.map((f) => f.facultyName)).toEqual(['A']);
  });

  it('breaks funder ties by budget desc then name', () => {
    const rs = [
      p({ id: 'a', funderName: 'ข', budgetThb: 10n }),
      p({ id: 'b', funderName: 'ก', budgetThb: 10n }),
      p({ id: 'c', funderName: 'ค', budgetThb: 99n }),
    ];
    const r = aggregateGrants(rs, { facultyName: [], page: 1, pageSize: 50, sort: 'year' });
    expect(r.topFunders.map((x) => x.funderName)).toEqual(['ค', 'ก', 'ข']);
  });
});
