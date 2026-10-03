import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { SessionUser } from '@kku/shared';
import { PERMISSION_META, PROVENANCE_META } from '../src/common/decorators';
import { ZodValidationPipe } from '../src/common/zod-validation.pipe';

// program-overlap.v1 read endpoints. The read models are unit-tested in
// packages/db; here the db layer and the scope helpers are stubbed and the
// controllers' authorization, clamping and envelope are asserted.

const mocks = vi.hoisted(() => ({
  overlapMatrix: vi.fn(),
  overlapPairDetail: vi.fn(),
  programOverlapSection: vi.fn(),
  selfCompetitionRows: vi.fn(),
  latestOverlapRunCompletedAt: vi.fn(),
  programFindMany: vi.fn(),
  assertCanSeeFacultyDashboards: vi.fn(),
  clampFacultyIdFilter: vi.fn(),
  resolveEffectiveScope: vi.fn(),
  assertProgramAccessible: vi.fn(),
}));

vi.mock('@kku/db', async () => {
  const actual = await vi.importActual<typeof import('@kku/db')>('@kku/db');
  return {
    ...actual,
    overlapMatrix: mocks.overlapMatrix,
    overlapPairDetail: mocks.overlapPairDetail,
    programOverlapSection: mocks.programOverlapSection,
    selfCompetitionRows: mocks.selfCompetitionRows,
    latestOverlapRunCompletedAt: mocks.latestOverlapRunCompletedAt,
    prisma: { program: { findMany: mocks.programFindMany } },
  };
});

vi.mock('../src/common/scope-guards', async () => {
  const actual = await vi.importActual<typeof import('../src/common/scope-guards')>('../src/common/scope-guards');
  return {
    ...actual,
    assertCanSeeFacultyDashboards: mocks.assertCanSeeFacultyDashboards,
    clampFacultyIdFilter: mocks.clampFacultyIdFilter,
    resolveEffectiveScope: mocks.resolveEffectiveScope,
    assertProgramAccessible: mocks.assertProgramAccessible,
  };
});

const { OverlapMatrixQuery, ProgramOverlapController } = await import('../src/education/program-overlap.controller');
const { DeepDiveController } = await import('../src/programs/deep-dive.controller');
const { RisksController, SelfCompetitionQuerySchema } = await import('../src/risks/risks.controller');
const { PROGRAM_OVERLAP_VERSION, RISK_SCORING_VERSION } = await import('@kku/db');

const user = (role: string, facultyId: string | null = null) =>
  ({ userId: 'u1', role, facultyId, departmentId: null, programId: null, email: 'x@kku.ac.th', name: null }) as unknown as SessionUser;

const meta = <T,>(key: symbol, m: unknown): T => Reflect.getMetadata(key, m as object) as T;

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  mocks.assertCanSeeFacultyDashboards.mockResolvedValue(undefined);
  mocks.assertProgramAccessible.mockResolvedValue(undefined);
  mocks.clampFacultyIdFilter.mockImplementation(async (f: { facultyId: string | null }) => f);
  mocks.resolveEffectiveScope.mockResolvedValue({ mode: 'all', facultyIds: [], programIds: [] });
});

describe('OverlapMatrixQuery', () => {
  const parse = (q: Record<string, unknown>) => new ZodValidationPipe(OverlapMatrixQuery).transform(q, {} as never);
  it('defaults to bachelor; the measure is chosen client-side, so no layer is passed through', () => {
    expect(parse({})).toEqual({ level: 'BACHELOR' });
    expect(parse({ level: 'MASTER', layer: 'market', facultyId: 'f1' })).toEqual({ level: 'MASTER', facultyId: 'f1' });
    expect(() => parse({ level: 'POSTDOC' })).toThrow();
  });
});

describe('ProgramOverlapController', () => {
  const c = new ProgramOverlapController();

  it('is gated like the faculty-grain education dashboards and carries overlap provenance', () => {
    for (const m of [ProgramOverlapController.prototype.matrix, ProgramOverlapController.prototype.pair]) {
      expect(meta(PERMISSION_META, m)).toBe('institution:read:dashboard');
      const prov = meta<{ methodologyVersion: string; caveats: string[]; sources: Array<{ id: string }> }>(PROVENANCE_META, m);
      expect(prov.methodologyVersion).toBe(PROGRAM_OVERLAP_VERSION);
      expect(prov.caveats).toHaveLength(3);
      expect(prov.sources.map((s) => s.id)).toEqual(['program-overlap', 'program-courses-extract', 'program-skills-detailed']);
    }
  });

  it('clamps the faculty filter and returns the run time as freshness', async () => {
    mocks.clampFacultyIdFilter.mockResolvedValue({ facultyId: 'own' });
    mocks.overlapMatrix.mockResolvedValue({ completedAt: '2026-10-01T00:00:00.000Z' });
    const r = await c.matrix(user('FACULTY_USER', 'own'), { level: 'BACHELOR', facultyId: 'other' });
    expect(mocks.assertCanSeeFacultyDashboards).toHaveBeenCalled();
    expect(mocks.clampFacultyIdFilter).toHaveBeenCalledWith({ facultyId: 'other' }, expect.anything());
    expect(mocks.overlapMatrix).toHaveBeenCalledWith({ level: 'BACHELOR', facultyId: 'own' });
    expect(r.meta.freshnessDate).toBe('2026-10-01T00:00:00.000Z');
  });

  it('propagates the dashboard guard', async () => {
    mocks.assertCanSeeFacultyDashboards.mockRejectedValue(new ForbiddenException());
    await expect(c.matrix(user('FACULTY_USER'), { level: 'BACHELOR' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(mocks.overlapMatrix).not.toHaveBeenCalled();
  });

  const detail = { programA: { facultyId: 'f1' }, programB: { facultyId: 'f2' }, completedAt: null };

  it('pair detail: 404 for an unknown pair', async () => {
    mocks.overlapPairDetail.mockResolvedValue(null);
    await expect(c.pair(user('SYSTEM_ADMIN'), 'x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('pair detail: a scoped caller needs AT LEAST ONE programme in scope', async () => {
    mocks.overlapPairDetail.mockResolvedValue(detail);
    // f1 granted, f2 outside → allowed (outside siblings are shown in the matrix).
    mocks.resolveEffectiveScope.mockResolvedValue({ mode: 'scoped', facultyIds: ['f1'], programIds: [] });
    await expect(c.pair(user('FACULTY_USER', 'f1'), 'p')).resolves.toMatchObject({ data: detail });

    // Neither side in scope → 403.
    mocks.resolveEffectiveScope.mockResolvedValue({ mode: 'scoped', facultyIds: ['f9'], programIds: [] });
    await expect(c.pair(user('FACULTY_USER', 'f9'), 'p')).rejects.toBeInstanceOf(ForbiddenException);

    // A programme grant in f2 rolls up to f2, as clampFacultyIdFilter does.
    mocks.resolveEffectiveScope.mockResolvedValue({ mode: 'scoped', facultyIds: [], programIds: ['prog-in-f2'] });
    mocks.programFindMany.mockResolvedValue([{ facultyId: 'f2' }]);
    await expect(c.pair(user('PROGRAM_USER'), 'p')).resolves.toMatchObject({ data: detail });
  });

  it('pair detail: university-wide callers pass', async () => {
    mocks.overlapPairDetail.mockResolvedValue(detail);
    await expect(c.pair(user('UNIVERSITY_USER'), 'p')).resolves.toMatchObject({ data: detail, meta: { freshnessDate: null } });
  });
});

describe('DeepDiveController overlap', () => {
  const c = new DeepDiveController({} as never, {} as never, {} as never);

  it('is gated on programs:read:all with overlap provenance', () => {
    const m = DeepDiveController.prototype.overlap;
    expect(meta(PERMISSION_META, m)).toBe('programs:read:all');
    expect(meta<{ methodologyVersion: string }>(PROVENANCE_META, m).methodologyVersion).toBe(PROGRAM_OVERLAP_VERSION);
  });

  it('checks programme access before reading, and passes null through (section hidden)', async () => {
    mocks.programOverlapSection.mockResolvedValue(null);
    const r = await c.overlap(user('SYSTEM_ADMIN'), 'p1');
    expect(mocks.assertProgramAccessible).toHaveBeenCalledWith('p1', expect.anything());
    expect(r).toEqual({ data: null, meta: { freshnessDate: null } });

    mocks.assertProgramAccessible.mockRejectedValue(new ForbiddenException());
    mocks.programOverlapSection.mockClear();
    await expect(c.overlap(user('FACULTY_USER'), 'p2')).rejects.toBeInstanceOf(ForbiddenException);
    expect(mocks.programOverlapSection).not.toHaveBeenCalled();
  });
});

describe('RisksController self-competition', () => {
  const c = new RisksController({} as never);
  const parse = (q: Record<string, unknown>) => new ZodValidationPipe(SelfCompetitionQuerySchema).transform(q, {} as never);

  it('is gated like the portfolio', () => {
    const m = RisksController.prototype.selfCompetition;
    expect(meta(PERMISSION_META, m)).toBe(meta(PERMISSION_META, RisksController.prototype.portfolio));
    expect(meta<{ methodologyVersion: string }>(PROVENANCE_META, m).methodologyVersion).toBe(RISK_SCORING_VERSION);
  });

  it('403s an account with no grants', async () => {
    mocks.resolveEffectiveScope.mockResolvedValue({ mode: 'none', facultyIds: [], programIds: [] });
    await expect(c.selfCompetition(user('FACULTY_USER'), parse({}))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('clamps a scoped caller to their grants and refuses a cross-scope facultyId', async () => {
    mocks.resolveEffectiveScope.mockResolvedValue({ mode: 'scoped', facultyIds: ['f1'], programIds: ['p9'] });
    mocks.selfCompetitionRows.mockResolvedValue([]);
    await c.selfCompetition(user('FACULTY_USER', 'f1'), parse({ level: 'BACHELOR' }));
    expect(mocks.selfCompetitionRows).toHaveBeenCalledWith({ level: 'BACHELOR', facultyIds: ['f1'], programIds: ['p9'] });
    await expect(c.selfCompetition(user('FACULTY_USER', 'f1'), parse({ facultyId: 'f2' }))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a scoped facultyId restricts to that faculty only — programme grants elsewhere are not ORed in', async () => {
    mocks.resolveEffectiveScope.mockResolvedValue({ mode: 'scoped', facultyIds: ['f1', 'f2'], programIds: ['p9'] });
    mocks.selfCompetitionRows.mockResolvedValue([]);
    await c.selfCompetition(user('FACULTY_USER', 'f1'), parse({ facultyId: 'f2' }));
    expect(mocks.selfCompetitionRows).toHaveBeenCalledWith({ level: undefined, facultyIds: ['f2'] });
  });

  it('freshness is the newest contributing breach, else the overlap run', async () => {
    const breach = (observedAt: string) => ({ programId: 'a', indicatorSlug: 'curriculum_overlap_max', severity: 'WARN', value: 55, observedAt });
    mocks.selfCompetitionRows.mockResolvedValue([
      { pairId: 'x', breaches: [breach('2026-10-01T00:00:00.000Z'), breach('2026-10-02T05:00:00.000Z')] },
      { pairId: 'y', breaches: [breach('2026-09-30T00:00:00.000Z')] },
    ]);
    const r = await c.selfCompetition(user('SYSTEM_ADMIN'), parse({ level: 'BACHELOR' }));
    expect(r.data).toHaveLength(2);
    expect(r.meta.freshnessDate).toBe('2026-10-02T05:00:00.000Z');
    expect(mocks.latestOverlapRunCompletedAt).not.toHaveBeenCalled();

    mocks.selfCompetitionRows.mockResolvedValue([]);
    mocks.latestOverlapRunCompletedAt.mockResolvedValue('2026-10-03T01:00:00.000Z');
    const empty = await c.selfCompetition(user('SYSTEM_ADMIN'), parse({ level: 'MASTER' }));
    expect(mocks.latestOverlapRunCompletedAt).toHaveBeenCalledWith('MASTER');
    expect(empty.meta.freshnessDate).toBe('2026-10-03T01:00:00.000Z');
  });

  it('passes an admin facultyId filter through', async () => {
    mocks.selfCompetitionRows.mockResolvedValue([]);
    await c.selfCompetition(user('SYSTEM_ADMIN'), parse({ facultyId: 'f3' }));
    expect(mocks.selfCompetitionRows).toHaveBeenCalledWith({ level: undefined, facultyIds: ['f3'] });
  });
});
