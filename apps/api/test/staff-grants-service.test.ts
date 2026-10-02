import { describe, expect, it, vi } from 'vitest';

vi.mock('@kku/db', () => ({
  grantsFreshness: vi.fn(async () => ({ runId: 'run-9', completedAt: new Date('2026-10-02T04:00:00Z') })),
  getGrantsDashboard: vi.fn(async () => ({
    kpis: { projects: 1, budgetThb: 1, staffInvolved: 1, membersTotal: 2, membersMatched: 1 },
    trend: [], byFaculty: [], topFunders: [], table: { total: 1, page: 1, pageSize: 50, rows: [] },
    options: { yearMin: 2558, yearMax: 2570, funders: [] },
  })),
  getGrantProjectDetail: vi.fn(async () => null),
}));

import { GrantsService } from '../src/staff-dashboard/grants.service';

describe('GrantsService', () => {
  it('returns data with provenance meta: freshness, source, caveats incl. the non-additive faculty note', async () => {
    const svc = new GrantsService();
    const r = await svc.dashboard({ facultyName: [], page: 1, pageSize: 50, sort: 'year' });
    expect(r.meta.freshnessDate).toBe('2026-10-02T04:00:00.000Z');
    expect(r.meta.sources[0]!.id).toBe('kku-research-services');
    expect(r.meta.caveats!.join(' ')).toMatch(/more than the KKU total/);
    expect(r.meta.caveats!.join(' ')).toMatch(/not split/);
    expect(r.meta.methodologyParameters).toEqual([{ label: 'Staff matched to HR records', value: '1 of 2 team members (50%)' }]);
  });

  it('turns a missing or out-of-scope project into NOT_FOUND', async () => {
    const svc = new GrantsService();
    await expect(svc.detail('rsp-1', null)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
