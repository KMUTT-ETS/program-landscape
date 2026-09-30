import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, hashCitizenId } from '@kku/shared';
import { staffProfileFixture } from './fixtures/staff-profile';

const mocks = vi.hoisted(() => ({
  resolveStaffForLookup: vi.fn(),
  buildStaffProfile: vi.fn(),
  recordApiRequest: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@kku/db', () => mocks);

import { StaffProfileService } from '../src/external/staff-profile.service';

const RAW_ID = '1101700203883';
const baseClient = {
  id: 'c1',
  allowedSections: ['education', 'publications'],
  allowCitizenIdLookup: true,
  allowEmailLookup: false,
  includeInactive: false,
};
const req = (client = baseClient) =>
  ({ apiClient: { client, keyId: 'k1' }, ip: '10.0.0.1', headers: {} }) as never;

async function thrown(p: Promise<unknown>): Promise<ApiError> {
  try { await p; } catch (e) { return e as ApiError; }
  throw new Error('expected a throw');
}

const svc = new StaffProfileService();

beforeEach(() => {
  mocks.resolveStaffForLookup.mockReset();
  mocks.buildStaffProfile.mockReset();
  mocks.recordApiRequest.mockClear();
});

describe('StaffProfileService.lookup', () => {
  it('returns granted sections with integration meta and logs a 200', async () => {
    mocks.resolveStaffForLookup.mockResolvedValue('fm1');
    mocks.buildStaffProfile.mockResolvedValue(staffProfileFixture());
    const out = await svc.lookup(req(), { citizenId: RAW_ID });
    expect(Object.keys(out.data).sort()).toEqual(['education', 'person', 'publications']);
    expect(out.meta.integration).toMatchObject({
      apiVersion: 'staff-profile.v1',
      publicationsCache: 'hit',
      sectionsWithheld: ['affiliation', 'teaching', 'research'],
    });
    expect(mocks.buildStaffProfile).toHaveBeenCalledWith('fm1', { courseLimit: null });
    expect(mocks.recordApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({ status: 200, lookupType: 'CITIZEN_ID', facultyMemberId: 'fm1' }),
    );
  });

  it('refuses a lookup type the client was not granted, with 403 lookup_not_permitted', async () => {
    const e = await thrown(svc.lookup(req(), { email: 'a@kku.ac.th' }));
    expect(e.code).toBe('FORBIDDEN');
    expect(e.details).toEqual({ reason: 'lookup_not_permitted' });
    expect(mocks.resolveStaffForLookup).not.toHaveBeenCalled();
  });

  it('gives one identical 404 whichever identifier missed', async () => {
    mocks.resolveStaffForLookup.mockResolvedValue(null);
    const both = { ...baseClient, allowEmailLookup: true };
    const a = await thrown(svc.lookup(req(both), { citizenId: RAW_ID }));
    const b = await thrown(svc.lookup(req(both), { email: 'nobody@kku.ac.th' }));
    expect(a.code).toBe('NOT_FOUND');
    expect(JSON.stringify([a.code, a.message, a.details])).toBe(JSON.stringify([b.code, b.message, b.details]));
  });

  it('returns 400 for a bad body, without echoing the value', async () => {
    const e = await thrown(svc.lookup(req(), { citizenId: '1101700203884' }));
    expect(e.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(e.details)).not.toContain('1101700203884');
  });

  it('reports validation issues as path and message only, whatever zod attached', async () => {
    const e = await thrown(svc.lookup(req(), { citizenId: RAW_ID, extra: 'secret.person@kku.ac.th' }));
    expect(e.code).toBe('VALIDATION_FAILED');
    const issues = (e.details as { issues: object[] }).issues;
    expect(issues.length).toBeGreaterThan(0);
    for (const i of issues) expect(Object.keys(i).sort()).toEqual(['message', 'path']);
    expect(JSON.stringify(e.details)).not.toContain('secret.person');
  });

  it('passes includeInactive through to the lookup', async () => {
    mocks.resolveStaffForLookup.mockResolvedValue(null);
    await thrown(svc.lookup(req({ ...baseClient, includeInactive: true }), { citizenId: RAW_ID }));
    expect(mocks.resolveStaffForLookup).toHaveBeenCalledWith({ citizenId: RAW_ID }, { includeInactive: true });
  });

  it('never writes the citizen id, its hash, or the email to the call log', async () => {
    const both = { ...baseClient, allowEmailLookup: true };
    mocks.resolveStaffForLookup.mockResolvedValueOnce('fm1').mockResolvedValue(null);
    mocks.buildStaffProfile.mockResolvedValue(staffProfileFixture());
    await svc.lookup(req(both), { citizenId: RAW_ID });
    await thrown(svc.lookup(req(both), { citizenId: RAW_ID }));
    await thrown(svc.lookup(req(both), { email: 'secret.person@kku.ac.th' }));
    await thrown(svc.lookup(req(both), { citizenId: '1101700203884' }));
    const logged = JSON.stringify(mocks.recordApiRequest.mock.calls);
    expect(mocks.recordApiRequest).toHaveBeenCalledTimes(4);
    for (const secret of [RAW_ID, hashCitizenId(RAW_ID)!, 'secret.person', '1101700203884']) {
      expect(logged).not.toContain(secret);
    }
  });
});
