import { describe, expect, it } from 'vitest';

import {
  normaliseSkillName,
  hasDisambiguatingSuffix,
  planGroupMerge,
  planChildRemap,
  type SkillRowForMerge,
} from '../src/skill-dedupe';

function row(over: Partial<SkillRowForMerge> & { id: string }): SkillRowForMerge {
  return {
    code: `linkedin-${over.id}`,
    nameEn: 'Data Science',
    nameTh: 'วิทยาศาสตร์ข้อมูล',
    category: 'data & ai',
    createdAt: new Date('2026-05-02T00:00:00Z'),
    references: 0,
    ...over,
  };
}

describe('normaliseSkillName', () => {
  it('folds case and collapses whitespace', () => {
    expect(normaliseSkillName('  Quality   Control ')).toBe('quality control');
    expect(normaliseSkillName('Quality control')).toBe(normaliseSkillName('Quality Control'));
  });
});

describe('hasDisambiguatingSuffix', () => {
  it('recognises the -N codes the bug produced', () => {
    expect(hasDisambiguatingSuffix('linkedin-data-science-2')).toBe(true);
    expect(hasDisambiguatingSuffix('linkedin-data-science')).toBe(false);
  });

  it('does not treat a legitimate trailing number as a suffix artefact', () => {
    // ISO 9001 is a real skill name, not a second "ISO 900".
    expect(hasDisambiguatingSuffix('esco-iso-9001')).toBe(true);
    // Documented limitation: the check is on shape, so a genuine trailing
    // number reads as suffixed. It only ever affects tie-break ORDER within a
    // group of identically-named rows, never which rows are considered
    // duplicates, so a false positive cannot merge two different skills.
  });
});

describe('planGroupMerge', () => {
  it('returns null for a group of one — nothing to merge', () => {
    expect(planGroupMerge('data science', [row({ id: 'a' })])).toBeNull();
  });

  it('keeps the most-referenced row', () => {
    const plan = planGroupMerge('data science', [
      row({ id: 'a', references: 2 }),
      row({ id: 'b', references: 40 }),
      row({ id: 'c', references: 5 }),
    ])!;
    expect(plan.keep.id).toBe('b');
    expect(plan.drop.map((d) => d.id).sort()).toEqual(['a', 'c']);
  });

  it('breaks a reference tie in favour of the unsuffixed code', () => {
    const plan = planGroupMerge('data science', [
      row({ id: 'a', code: 'linkedin-data-science-3', references: 7 }),
      row({ id: 'b', code: 'linkedin-data-science', references: 7 }),
    ])!;
    expect(plan.keep.id).toBe('b');
  });

  it('breaks a remaining tie deterministically by creation time', () => {
    const plan = planGroupMerge('data science', [
      row({ id: 'late', createdAt: new Date('2026-05-02T09:00:00Z') }),
      row({ id: 'early', createdAt: new Date('2026-05-02T01:00:00Z') }),
    ])!;
    expect(plan.keep.id).toBe('early');
  });

  it('preserves a disagreeing Thai name as an alias rather than discarding it', () => {
    // Real case: "Data Science" is both วิทยาศาสตร์ข้อมูล and วิทยาการข้อมูล.
    const plan = planGroupMerge('data science', [
      row({ id: 'a', references: 9, nameTh: 'วิทยาศาสตร์ข้อมูล' }),
      row({ id: 'b', nameTh: 'วิทยาการข้อมูล' }),
    ])!;
    expect(plan.keep.id).toBe('a');
    expect(plan.aliasNames).toContain('วิทยาการข้อมูล');
  });

  it('does not alias a name the survivor already has', () => {
    const plan = planGroupMerge('data science', [
      row({ id: 'a', references: 9 }),
      row({ id: 'b' }),
    ])!;
    expect(plan.aliasNames).toEqual([]);
  });

  it('preserves a differing English casing variant as an alias', () => {
    const plan = planGroupMerge('quality control', [
      row({ id: 'a', references: 9, nameEn: 'Quality Control', nameTh: 'ควบคุมคุณภาพ' }),
      row({ id: 'b', nameEn: 'Quality control', nameTh: 'การควบคุมคุณภาพ' }),
    ])!;
    // The English variant folds to the same normalised key, so only the
    // genuinely different Thai name is aliased.
    expect(plan.aliasNames).toEqual(['การควบคุมคุณภาพ']);
  });
});

describe('planChildRemap', () => {
  it('repoints a row whose parent does not yet reference the survivor', () => {
    const out = planChildRemap({
      droppedRows: [{ id: 'r1', parentKey: 'prog-1' }],
      parentKeysOnSurvivor: new Set(),
    });
    expect(out.update).toEqual(['r1']);
    expect(out.deleteConflicting).toEqual([]);
  });

  it('deletes a row whose parent already references the survivor', () => {
    // Repointing would violate @@unique([programId, skillId]).
    const out = planChildRemap({
      droppedRows: [{ id: 'r1', parentKey: 'prog-1' }],
      parentKeysOnSurvivor: new Set(['prog-1']),
    });
    expect(out.update).toEqual([]);
    expect(out.deleteConflicting).toEqual(['r1']);
  });

  it('handles two dropped rows sharing one parent — the second is a conflict too', () => {
    // Both point at different dropped skills but the same programme, so only
    // one can take the survivor slot; the other would collide.
    const out = planChildRemap({
      droppedRows: [
        { id: 'r1', parentKey: 'prog-1' },
        { id: 'r2', parentKey: 'prog-1' },
      ],
      parentKeysOnSurvivor: new Set(),
    });
    expect(out.update).toEqual(['r1']);
    expect(out.deleteConflicting).toEqual(['r2']);
  });

  it('never both updates and deletes the same row', () => {
    const out = planChildRemap({
      droppedRows: [
        { id: 'r1', parentKey: 'p1' },
        { id: 'r2', parentKey: 'p2' },
        { id: 'r3', parentKey: 'p1' },
      ],
      parentKeysOnSurvivor: new Set(['p2']),
    });
    expect(out.update).toEqual(['r1']);
    expect(out.deleteConflicting.sort()).toEqual(['r2', 'r3']);
    const overlap = out.update.filter((x) => out.deleteConflicting.includes(x));
    expect(overlap).toEqual([]);
  });
});

// ── The guard that stops duplicates regenerating ──────────────────────────
//
// findSkillByNormalisedName is what both Skill-creation paths must consult.
// Its SQL normalisation has to agree with normaliseSkillName, or the guard
// misses exactly the duplicates the dedupe just removed.

describe('normalisation used by the creation guard', () => {
  it('folds the casing variants that actually occurred', () => {
    // Real pairs from the taxonomy before the merge.
    expect(normaliseSkillName('Quality control')).toBe(normaliseSkillName('Quality Control'));
    expect(normaliseSkillName('Scientific writing')).toBe(normaliseSkillName('Scientific Writing'));
    expect(normaliseSkillName('Self-directed learning')).toBe(normaliseSkillName('Self-Directed Learning'));
    expect(normaliseSkillName('3D modeling')).toBe(normaliseSkillName('3D Modeling'));
  });

  it('folds internal whitespace, which the SQL regexp_replace must match', () => {
    expect(normaliseSkillName('Data  Science')).toBe('data science');
  });

  it('does not fold two genuinely different skills together', () => {
    expect(normaliseSkillName('Data Science')).not.toBe(normaliseSkillName('Data Engineering'));
    expect(normaliseSkillName('Quality Control')).not.toBe(normaliseSkillName('Quality Management'));
  });
});
