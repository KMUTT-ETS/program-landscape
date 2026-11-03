import { describe, expect, it, vi } from 'vitest';

import {
  ensureProgramSkills,
  skillTaxonomyBuildEnabled,
  type EnsureSkillsDeps,
} from '../src/program-skills/ensure-skill-taxonomy';

function deps(over: Partial<EnsureSkillsDeps> = {}): EnsureSkillsDeps {
  return {
    findDigestExtractionId: vi.fn().mockResolvedValue('ext-1'),
    countUnmatchedSkillNames: vi.fn().mockResolvedValue(0),
    countProgramSkills: vi.fn().mockResolvedValue(3),
    materialise: vi.fn().mockResolvedValue({ skillsLinked: 4, skillsProposed: 0 }),
    runNormaliser: vi.fn().mockResolvedValue({ matched: 2, newProposed: 5, failed: 0 }),
    ...over,
  };
}

describe('ensureProgramSkills (pipeline phase 2)', () => {
  it('unmatched names: normalises, then re-applies the SAME stored digest', async () => {
    const order: string[] = [];
    const d = deps({
      countUnmatchedSkillNames: vi.fn().mockResolvedValue(12),
      runNormaliser: vi.fn().mockImplementation(async () => {
        order.push('normalise');
        return { matched: 2, newProposed: 10, failed: 0 };
      }),
      materialise: vi.fn().mockImplementation(async (id: string) => {
        order.push(`materialise:${id}`);
        return { skillsLinked: 12, skillsProposed: 0 };
      }),
    });
    const r = await ensureProgramSkills('p1', d, true);
    expect(r.status).toBe('rebuilt');
    expect(order).toEqual(['normalise', 'materialise:ext-1']);
  });

  it('matched taxonomy: the normaliser is not called and nothing is re-applied', async () => {
    const d = deps();
    const r = await ensureProgramSkills('p1', d, true);
    expect(r.status).toBe('matched');
    expect(d.runNormaliser).not.toHaveBeenCalled();
    expect(d.materialise).not.toHaveBeenCalled();
  });

  it('names match but the programme has no links yet: re-applies without the normaliser', async () => {
    const d = deps({ countProgramSkills: vi.fn().mockResolvedValue(0) });
    const r = await ensureProgramSkills('p1', d, true);
    expect(r.status).toBe('rematerialised');
    expect(d.runNormaliser).not.toHaveBeenCalled();
    expect(d.materialise).toHaveBeenCalledWith('ext-1');
  });

  it('no digest: does nothing', async () => {
    const d = deps({ findDigestExtractionId: vi.fn().mockResolvedValue(null) });
    expect((await ensureProgramSkills('p1', d, true)).status).toBe('no-digest');
    expect(d.runNormaliser).not.toHaveBeenCalled();
  });

  it('disabled by the gate: does nothing', async () => {
    const d = deps({ countUnmatchedSkillNames: vi.fn().mockResolvedValue(9) });
    expect((await ensureProgramSkills('p1', d, false)).status).toBe('disabled');
    expect(d.findDigestExtractionId).not.toHaveBeenCalled();
  });

  it('a normaliser failure is reported, not thrown', async () => {
    const d = deps({
      countUnmatchedSkillNames: vi.fn().mockResolvedValue(3),
      runNormaliser: vi.fn().mockRejectedValue(new Error('no AI key')),
    });
    const r = await ensureProgramSkills('p1', d, true);
    expect(r.status).toBe('failed');
    expect(r.notes).toMatch(/no AI key/);
    expect(d.materialise).not.toHaveBeenCalled();
  });

  it('the gate defaults on and honours an explicit off', () => {
    expect(skillTaxonomyBuildEnabled({})).toBe(true);
    expect(skillTaxonomyBuildEnabled({ PIPELINE_BUILD_SKILL_TAXONOMY: '1' })).toBe(true);
    expect(skillTaxonomyBuildEnabled({ PIPELINE_BUILD_SKILL_TAXONOMY: 'false' })).toBe(false);
    expect(skillTaxonomyBuildEnabled({ PIPELINE_BUILD_SKILL_TAXONOMY: '0' })).toBe(false);
  });
});
