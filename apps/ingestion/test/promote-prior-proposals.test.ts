import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  aliasFindMany: vi.fn(),
  skillCreate: vi.fn(),
  skillFindUnique: vi.fn(),
  findSkillByNormalisedName: vi.fn(),
  recordAliasDecision: vi.fn(),
}));

vi.mock('@kku/db', () => ({
  prisma: {
    skillAlias: { findMany: mocks.aliasFindMany },
    skill: { create: mocks.skillCreate, findUnique: mocks.skillFindUnique },
  },
  findSkillByNormalisedName: mocks.findSkillByNormalisedName,
  recordAliasDecision: mocks.recordAliasDecision,
  relinkUsingAliases: vi.fn(),
}));

import { promotePriorProposals } from '../src/program-skills/skill-normaliser-run';

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  mocks.skillFindUnique.mockResolvedValue(null);
  mocks.findSkillByNormalisedName.mockResolvedValue(null);
  mocks.skillCreate.mockResolvedValue({ id: 'skill-new' });
  mocks.recordAliasDecision.mockResolvedValue({ id: 'a', created: false });
});

describe('promotePriorProposals (F13: earlier run without --auto-promote)', () => {
  it('queries only NEW_PROPOSED program_digest decisions at >= 0.9 for the given names', async () => {
    mocks.aliasFindMany.mockResolvedValue([]);
    await promotePriorProposals(['Thermodynamics', ' Heat Transfer ']);
    const where = mocks.aliasFindMany.mock.calls[0]![0].where;
    expect(where.status).toBe('NEW_PROPOSED');
    expect(where.sourceContext).toBe('program_digest');
    expect(where.confidence).toEqual({ gte: 0.9 });
    expect(where.rawNameLower).toEqual({ in: ['thermodynamics', 'heat transfer'] });
  });

  it('creates the skill and resolves the alias', async () => {
    mocks.aliasFindMany.mockResolvedValue([
      { rawName: 'Thermodynamics', newNameEn: 'Thermodynamics', newNameTh: 'เทอร์โมไดนามิกส์', newCategory: 'engineering', confidence: 0.95 },
    ]);
    expect(await promotePriorProposals(['Thermodynamics'])).toBe(1);
    expect(mocks.skillCreate).toHaveBeenCalledTimes(1);
    expect(mocks.recordAliasDecision).toHaveBeenCalledWith(
      expect.objectContaining({ rawName: 'Thermodynamics', decision: 'MATCH', resolvedSkillId: 'skill-new' }),
    );
  });

  it('reuses an existing skill instead of creating a duplicate', async () => {
    mocks.aliasFindMany.mockResolvedValue([
      { rawName: 'Thermo', newNameEn: 'Thermodynamics', newNameTh: 'x', newCategory: null, confidence: 0.92 },
    ]);
    mocks.findSkillByNormalisedName.mockResolvedValue({ id: 'skill-old', code: 'c', nameEn: 'Thermodynamics' });
    await promotePriorProposals(['Thermo']);
    expect(mocks.skillCreate).not.toHaveBeenCalled();
    expect(mocks.recordAliasDecision).toHaveBeenCalledWith(expect.objectContaining({ resolvedSkillId: 'skill-old' }));
  });

  it('does nothing for no names', async () => {
    expect(await promotePriorProposals([])).toBe(0);
    expect(mocks.aliasFindMany).not.toHaveBeenCalled();
  });
});
