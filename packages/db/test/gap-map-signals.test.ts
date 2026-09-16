import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { matchInitiativeToOccupations, pickGrowth, type GrowthRow } from '../src/gap-map-signals';

describe('pickGrowth', () => {
  const rows: GrowthRow[] = [
    { skillId: 's1', dataScope: 'THAILAND', growthPct: 12 },
    { skillId: 's1', dataScope: 'GLOBAL', growthPct: 40 },
    { skillId: 's2', dataScope: 'GLOBAL', growthPct: 27 },
    { skillId: 's3', dataScope: 'THAILAND', growthPct: -5 },
    { skillId: 's4', dataScope: 'THAILAND', growthPct: 9 },
  ];
  it('prefers THAILAND per skill, falls back to GLOBAL, keeps the top three rising', () => {
    const r = pickGrowth(rows, new Set(['s1', 's2', 's3', 's4']), new Set());
    expect(r.scope).toBe('THAILAND');
    expect(r.picked.map((p) => [p.skillId, p.growthPct])).toEqual([['s2', 27], ['s1', 12], ['s4', 9]]);
  });
  it('drops generic skills and reports GLOBAL when no Thai row survives', () => {
    const r = pickGrowth(rows, new Set(['s1', 's2']), new Set(['s1']));
    expect(r.picked.map((p) => p.skillId)).toEqual(['s2']);
    expect(r.scope).toBe('GLOBAL');
  });
  it('is empty, with null scope, when nothing intersects', () => {
    expect(pickGrowth(rows, new Set(['zz']), new Set())).toEqual({ picked: [], scope: null });
  });
});

describe('matchInitiativeToOccupations', () => {
  it('matches an unmet role against occupation subcategories in either language, case- and space-insensitive', () => {
    const occ = ['Logistics / Supply Chain', 'นักวิเคราะห์ข้อมูล'];
    expect(matchInitiativeToOccupations([{ unmetRoleTh: 'เจ้าหน้าที่โลจิสติกส์', unmetRoleEn: 'logistics coordinator' }], occ)).toBe(true);
    expect(matchInitiativeToOccupations([{ unmetRoleTh: 'นักวิเคราะห์ข้อมูล', unmetRoleEn: 'Data analyst' }], occ)).toBe(true);
    expect(matchInitiativeToOccupations([{ unmetRoleTh: 'พยาบาล', unmetRoleEn: 'Nurse' }], occ)).toBe(false);
    expect(matchInitiativeToOccupations(null, occ)).toBe(false);
  });
});

// Provenance gating is structural, same reasoning as gap-map.test.ts's
// "computeGapMap provenance gating" describe block: `kmitl_skill_growths`
// DOES carry `ingestion_run_id` (see KmitlSkillGrowth in schema.prisma) and
// must be realDataWhere()-gated, matching the long-standing read of the same
// table in gap-analysis.ts's computeOpportunities(). `jobthai_occupation_skills`
// has no ingestion_run_id column at all, so it genuinely cannot be gated —
// asserting its absence here so nobody "fixes" it into a gate that doesn't
// compile against a column that isn't there.
describe('globalSignalForFields provenance gating', () => {
  const src = readFileSync(path.join(__dirname, '..', 'src', 'gap-map-signals.ts'), 'utf8');
  it('gates the kmitlSkillGrowth read with realDataWhere()', () => {
    expect(src).toMatch(/kmitlSkillGrowth\.findMany\(\{\s*where: \{[\s\S]{0,120}?realDataWhere\(\)/);
  });
  it('does NOT gate the jobThaiOccupationSkill read (the table has no ingestion_run_id column)', () => {
    const match = src.match(/jobThaiOccupationSkill\.findMany\(\{[\s\S]{0,300}?\}\),/);
    expect(match).not.toBeNull();
    expect(match![0]).not.toContain('realDataWhere()');
  });
});
