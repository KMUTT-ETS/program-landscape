import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, ApiMetaSchema, hashCitizenId } from '@kku/shared';
import { HTTP_CODE_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { Logger, RequestMethod } from '@nestjs/common';
import { staffProfileFixture } from './fixtures/staff-profile';

const mocks = vi.hoisted(() => ({
  resolveStaffForLookup: vi.fn(),
  buildStaffProfile: vi.fn(),
  getStaffTeachingEvaluation: vi.fn(),
  recordApiRequest: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@kku/db', () => mocks);

import { StaffProfileService } from '../src/external/staff-profile.service';
import { StaffProfileController } from '../src/external/staff-profile.controller';
import { API_KEY_AUTH_META } from '../src/external/api-key.guard';

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
  mocks.getStaffTeachingEvaluation.mockReset();
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
      sectionsWithheld: ['affiliation', 'teaching', 'research', 'teachingEvaluation'],
    });
    expect(mocks.buildStaffProfile).toHaveBeenCalledWith('fm1', { courseLimit: null, includeTalent: false });
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

  const loggedStatus = () =>
    (mocks.recordApiRequest.mock.calls.at(-1)?.[0] as { status: number }).status;

  it('logs the status actually returned for 400, 403 and 404', async () => {
    await thrown(svc.lookup(req(), { citizenId: '1101700203884' }));
    expect(loggedStatus()).toBe(400);
    await thrown(svc.lookup(req(), { email: 'a@kku.ac.th' }));
    expect(loggedStatus()).toBe(403);
    mocks.resolveStaffForLookup.mockResolvedValue(null);
    await thrown(svc.lookup(req(), { citizenId: RAW_ID }));
    expect(loggedStatus()).toBe(404);
  });

  it('logs 500 with the resolved staff id when the profile build throws unexpectedly', async () => {
    mocks.resolveStaffForLookup.mockResolvedValue('fm1');
    mocks.buildStaffProfile.mockRejectedValue(new Error('db went away'));
    await expect(svc.lookup(req(), { citizenId: RAW_ID })).rejects.toThrow('db went away');
    expect(mocks.recordApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({ status: 500, facultyMemberId: 'fm1' }),
    );
  });

  it('logs 502 when the profile build raises UPSTREAM_UNAVAILABLE', async () => {
    mocks.resolveStaffForLookup.mockResolvedValue('fm1');
    mocks.buildStaffProfile.mockRejectedValue(new ApiError('UPSTREAM_UNAVAILABLE', 'mirror down'));
    const e = await thrown(svc.lookup(req(), { citizenId: RAW_ID }));
    expect(e.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(loggedStatus()).toBe(502);
  });

  it('returns meta that satisfies the envelope schema', async () => {
    mocks.resolveStaffForLookup.mockResolvedValue('fm1');
    mocks.buildStaffProfile.mockResolvedValue(staffProfileFixture());
    const out = await svc.lookup(req(), { citizenId: RAW_ID });
    expect(() => ApiMetaSchema.parse({ freshnessDate: null, sources: [], ...out.meta })).not.toThrow();
  });

  it('withholds the email from a client without email lookup', async () => {
    mocks.resolveStaffForLookup.mockResolvedValue('fm1');
    mocks.buildStaffProfile.mockResolvedValue(staffProfileFixture());
    const out = await svc.lookup(req(), { citizenId: RAW_ID });
    expect(out.data.person.email).toBeNull();
  });

  it('refuses with UNAUTHORIZED, and logs nothing, when no client is attached', async () => {
    const e = await thrown(svc.lookup({ ip: '10.0.0.1', headers: {} } as never, { citizenId: RAW_ID }));
    expect(e.code).toBe('UNAUTHORIZED');
    expect(mocks.resolveStaffForLookup).not.toHaveBeenCalled();
    expect(mocks.recordApiRequest).not.toHaveBeenCalled();
  });
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('StaffProfileService build bounding', () => {
  it('coalesces concurrent lookups of the same person onto one build', async () => {
    const s = new StaffProfileService();
    const d = deferred<ReturnType<typeof staffProfileFixture>>();
    mocks.resolveStaffForLookup.mockResolvedValue('fm1');
    mocks.buildStaffProfile.mockReturnValue(d.promise);
    const a = s.lookup(req(), { citizenId: RAW_ID });
    const b = s.lookup(req(), { citizenId: RAW_ID });
    await tick();
    d.resolve(staffProfileFixture());
    const [ra, rb] = await Promise.all([a, b]);
    expect(mocks.buildStaffProfile).toHaveBeenCalledTimes(1);
    expect(ra.data.person.facultyMemberId).toBe('fm1');
    expect(rb.data.person.facultyMemberId).toBe('fm1');
    // Finished builds are forgotten: a later lookup builds afresh.
    mocks.buildStaffProfile.mockResolvedValue(staffProfileFixture());
    await s.lookup(req(), { citizenId: RAW_ID });
    expect(mocks.buildStaffProfile).toHaveBeenCalledTimes(2);
  });

  it('never runs more builds at once than STAFF_PROFILE_MAX_CONCURRENT_BUILDS', async () => {
    const prev = process.env.STAFF_PROFILE_MAX_CONCURRENT_BUILDS;
    process.env.STAFF_PROFILE_MAX_CONCURRENT_BUILDS = '2';
    try {
      const s = new StaffProfileService();
      let running = 0;
      let peak = 0;
      const gates: Array<() => void> = [];
      mocks.resolveStaffForLookup.mockImplementation(async (l: { citizenId: string }) => `fm-${l.citizenId}`);
      mocks.buildStaffProfile.mockImplementation(async (id: string) => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise<void>((r) => gates.push(r));
        running -= 1;
        return staffProfileFixture({ facultyMemberId: id });
      });
      // Five distinct valid citizen ids (the schema checks the checksum).
      const ids = ['1101700203883', '1101700203891', '1101700203905', '1101700203913', '1101700203921'];
      const all = Promise.all(ids.map((citizenId) => s.lookup(req(), { citizenId })));
      for (let i = 0; i < 20 && mocks.buildStaffProfile.mock.calls.length < ids.length; i++) {
        await tick();
        expect(running).toBeLessThanOrEqual(2);
        gates.splice(0).forEach((open) => open());
      }
      const out = await all;
      expect(out).toHaveLength(5);
      expect(mocks.buildStaffProfile).toHaveBeenCalledTimes(5);
      expect(peak).toBe(2);
    } finally {
      if (prev === undefined) delete process.env.STAFF_PROFILE_MAX_CONCURRENT_BUILDS;
      else process.env.STAFF_PROFILE_MAX_CONCURRENT_BUILDS = prev;
    }
  });
});

const evaluationSummary = () => ({
  overall: 4.348,
  totalAnswers: 1880,
  courseCount: 1,
  termCount: 2,
  firstYearBE: 2567,
  lastYearBE: 2568,
  latestYearBE: 2568,
  latestRating: 4.4,
  previousYearBE: 2567,
  previousRating: 4.3,
  categories: [{ tag: 'ethics', questions: 2, allTime: 4.4, latest: 4.5 }],
  untaggedQuestions: 0,
  courses: [
    { code: '000101', nameTh: 'ก', nameEn: 'A', rating: 4.348, answers: 1880, latestYearBE: 2568, latestSemester: 2 },
  ],
  freshnessDate: null,
  methodologyVersion: 'evaluations.v1',
});

describe('StaffProfileService teaching evaluation', () => {
  const granted = { ...baseClient, allowedSections: ['education', 'teachingEvaluation'] };
  const sourceIds = (meta: { sources?: Array<{ id: string }> }) => (meta.sources ?? []).map((s) => s.id);

  it('never loads evaluations for a client without the grant, and says nothing about them', async () => {
    mocks.resolveStaffForLookup.mockResolvedValue('fm1');
    mocks.buildStaffProfile.mockResolvedValue(staffProfileFixture());
    const out = await svc.lookup(req(), { citizenId: RAW_ID });
    expect(mocks.getStaffTeachingEvaluation).not.toHaveBeenCalled();
    expect(out.data).not.toHaveProperty('teachingEvaluation');
    expect(sourceIds(out.meta)).not.toContain('kku-evaluations');
    expect(out.meta.caveats!.join(' ')).not.toMatch(/teachingEvaluation|1–5 scale/);
  });

  it('loads once for a granted client and returns it with its source and caveats', async () => {
    mocks.resolveStaffForLookup.mockResolvedValue('fm1');
    mocks.buildStaffProfile.mockResolvedValue(staffProfileFixture());
    mocks.getStaffTeachingEvaluation.mockResolvedValue(evaluationSummary());
    const out = await svc.lookup(req(granted), { citizenId: RAW_ID });
    expect(mocks.getStaffTeachingEvaluation).toHaveBeenCalledTimes(1);
    expect(mocks.getStaffTeachingEvaluation).toHaveBeenCalledWith('fm1');
    expect(out.data.teachingEvaluation).toMatchObject({ overall: 4.348, totalAnswers: 1880 });
    expect(out.data.teachingEvaluation!.courses).toHaveLength(1);
    expect(sourceIds(out.meta)).toContain('kku-evaluations');
    expect(out.meta.caveats).toEqual(
      expect.arrayContaining([
        expect.stringContaining('1–5 scale'),
        expect.stringContaining('teachingEvaluation.totalAnswers counts answers'),
      ]),
    );
    expect(out.meta.integration).toMatchObject({ sectionsIncluded: ['person', 'education', 'teachingEvaluation'] });
    expect(() => ApiMetaSchema.parse({ freshnessDate: null, sources: [], ...out.meta })).not.toThrow();
  });

  it('returns null (still a returned section, with its source) when nothing is on record', async () => {
    mocks.resolveStaffForLookup.mockResolvedValue('fm1');
    mocks.buildStaffProfile.mockResolvedValue(staffProfileFixture());
    mocks.getStaffTeachingEvaluation.mockResolvedValue(null);
    const out = await svc.lookup(req(granted), { citizenId: RAW_ID });
    expect(out.data.teachingEvaluation).toBeNull();
    expect(sourceIds(out.meta)).toContain('kku-evaluations');
    expect(out.meta.integration).toMatchObject({ sectionsWithheld: ['affiliation', 'teaching', 'research', 'publications'] });
  });

  it('fails the request, logged as 500, when a granted evaluation cannot be loaded', async () => {
    mocks.resolveStaffForLookup.mockResolvedValue('fm1');
    mocks.buildStaffProfile.mockResolvedValue(staffProfileFixture());
    mocks.getStaffTeachingEvaluation.mockRejectedValue(new Error('evaluations cube down'));
    await expect(svc.lookup(req(granted), { citizenId: RAW_ID })).rejects.toThrow('evaluations cube down');
    expect(mocks.recordApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({ status: 500, facultyMemberId: 'fm1', sectionsReturned: [] }),
    );
  });

  it('still answers 404 for a missing profile even if the evaluation load also failed', async () => {
    mocks.resolveStaffForLookup.mockResolvedValue('fm1');
    mocks.buildStaffProfile.mockResolvedValue(null);
    mocks.getStaffTeachingEvaluation.mockRejectedValue(new Error('evaluations cube down'));
    const e = await thrown(svc.lookup(req(granted), { citizenId: RAW_ID }));
    expect(e.code).toBe('NOT_FOUND');
  });
});

describe('StaffProfileService response check', () => {
  it('logs the failing paths, never the values, and still returns the data', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      mocks.resolveStaffForLookup.mockResolvedValue('fm1');
      mocks.buildStaffProfile.mockResolvedValue(
        staffProfileFixture({ nameTh: 12345 as never, kkuEmail: 'secret.person@kku.ac.th' }),
      );
      const out = await new StaffProfileService().lookup(req(), { citizenId: RAW_ID });
      expect(out.data.person.name.th).toBe(12345);
      const messages = warn.mock.calls.map((c) => String(c[0]));
      const hit = messages.find((m) => m.includes('failed its schema'));
      expect(hit).toContain('person.name.th');
      expect(hit).not.toContain('12345');
      expect(mocks.recordApiRequest).toHaveBeenCalledWith(expect.objectContaining({ status: 200 }));
    } finally {
      warn.mockRestore();
    }
  });
});

describe('StaffProfileController', () => {
  const handler = StaffProfileController.prototype.lookup;

  it('is an API-key route answering POST with 200', () => {
    expect(Reflect.getMetadata(API_KEY_AUTH_META, handler)).toBe(true);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(200);
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.POST);
  });
});
