import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildGrowthIndex,
  genericRoleTokens,
  matchInitiativeToOccupations,
  pickGrowth,
  type GrowthRow,
} from '../src/gap-map-signals';

const NOW = new Date('2026-09-14');
const THEN = new Date('2026-07-20');
/** One row, at the current capture unless a snapshot is named. */
const row = (
  skillId: string,
  dataScope: 'THAILAND' | 'GLOBAL',
  growthPct: number,
  snapshotAt: Date = NOW,
  contextLevel = 'career',
): GrowthRow => ({ skillId, dataScope, growthPct, snapshotAt, contextLevel });

describe('pickGrowth', () => {
  const rows: GrowthRow[] = [
    row('s1', 'THAILAND', 12),
    row('s1', 'GLOBAL', 40),
    row('s2', 'GLOBAL', 27),
    row('s3', 'THAILAND', -5),
    row('s4', 'THAILAND', 9),
  ];
  const index = buildGrowthIndex(rows);
  it('prefers THAILAND per skill, falls back to GLOBAL, keeps the top three rising', () => {
    const r = pickGrowth(index, new Set(['s1', 's2', 's3', 's4']), new Set());
    expect(r.scope).toBe('THAILAND');
    expect(r.picked.map((p) => [p.skillId, p.growthPct])).toEqual([['s2', 27], ['s1', 12], ['s4', 9]]);
  });
  it('carries the series on each pick, not just on the trio', () => {
    const r = pickGrowth(index, new Set(['s1', 's2']), new Set());
    expect(r.scope).toBe('THAILAND');
    // s2 is a GLOBAL fallback even though the trio is labelled THAILAND — a UI
    // reading only the aggregate would imply both figures were Thai.
    expect(r.picked.map((p) => [p.skillId, p.scope])).toEqual([['s2', 'GLOBAL'], ['s1', 'THAILAND']]);
  });
  it('drops generic skills and reports GLOBAL when no Thai row survives', () => {
    const r = pickGrowth(index, new Set(['s1', 's2']), new Set(['s1']));
    expect(r.picked.map((p) => p.skillId)).toEqual(['s2']);
    expect(r.scope).toBe('GLOBAL');
  });
  it('is empty, with null scope, when nothing intersects', () => {
    expect(pickGrowth(index, new Set(['zz']), new Set())).toEqual({ picked: [], scope: null });
  });

  // Regression, defect 1a: the table accumulates captures and the older rows
  // are never superseded, so reading across snapshots quoted a stale figure as
  // current. Measured on dev 2026-09-16: "Digital marketing" returned July's
  // 600% while the 2026-09-14 capture's figure for the same skill was 279.41%.
  it('quotes only the newest snapshot, even when an older one is higher', () => {
    const mixed = [row('s1', 'GLOBAL', 600, THEN), row('s1', 'GLOBAL', 279.41, NOW)];
    const r = pickGrowth(buildGrowthIndex(mixed), new Set(['s1']), new Set());
    expect(r.picked).toEqual([{ skillId: 's1', growthPct: 279.41, scope: 'GLOBAL', contexts: 1 }]);
  });
  it('does not quote a skill at all when it is absent from the newest snapshot', () => {
    const stale = [row('old', 'THAILAND', 500, THEN), row('cur', 'GLOBAL', 10, NOW)];
    const r = pickGrowth(buildGrowthIndex(stale), new Set(['old', 'cur']), new Set());
    expect(r.picked.map((p) => p.skillId)).toEqual(['cur']);
  });

  // Regression, defect 1b: taking the max picked the single most flattering
  // context out of the many a skill is demanded in (median 3, max 181 on dev).
  it('averages across the contexts a skill appears in rather than taking the best one', () => {
    const outlier = [
      row('s1', 'GLOBAL', 300, NOW, 'career'),
      row('s1', 'GLOBAL', 20, NOW, 'career'),
      row('s1', 'GLOBAL', 10, NOW, 'group'),
    ];
    const index2 = buildGrowthIndex(outlier);
    expect(index2.bySkill.get('s1')).toEqual([{ dataScope: 'GLOBAL', growthPct: 110, contexts: 3 }]);
    expect(pickGrowth(index2, new Set(['s1']), new Set()).picked[0].growthPct).toBe(110);
  });

  // The honesty fix: a mean over one context and a mean over many contexts can
  // both reach the top three by growth magnitude alone (no floor is applied —
  // see the comment at the ranking site above), so each pick must carry its
  // own true context count rather than presenting both as the same kind of
  // figure. Measured on dev, 2026-09-16: 598 of 1,788 skills are single-context.
  it('carries the context count through from buildGrowthIndex to the picked skills', () => {
    const mixed = [
      row('thin', 'GLOBAL', 782), // one context — a single raw observation
      row('broad', 'GLOBAL', 200, NOW, 'career'),
      row('broad', 'GLOBAL', 195, NOW, 'sub_group'),
      row('broad', 'GLOBAL', 205, NOW, 'group'),
    ];
    const index2 = buildGrowthIndex(mixed);
    const r = pickGrowth(index2, new Set(['thin', 'broad']), new Set());
    expect(r.picked).toEqual([
      { skillId: 'thin', growthPct: 782, scope: 'GLOBAL', contexts: 1 },
      { skillId: 'broad', growthPct: 200, scope: 'GLOBAL', contexts: 3 },
    ]);
  });

  it('reports the newest snapshot it indexed, and null for an empty table', () => {
    expect(buildGrowthIndex([row('s1', 'GLOBAL', 1, THEN), row('s1', 'GLOBAL', 2, NOW)]).newestSnapshot).toEqual(NOW);
    expect(buildGrowthIndex([])).toEqual({ newestSnapshot: null, bySkill: new Map() });
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

  // Regression, defect 2: a common business word reaching an unrelated field
  // through a "/"-joined composite label. This is the real dev shape — the
  // Biology row's occupation list carries the data-science composite, and
  // "Digital Marketing Data Analyst" was matching it on "data"/"analyst".
  it('does not pair a digital-marketing role with an unrelated field through a composite label', () => {
    // The real dev shape, scaled down but with the shares preserved: the
    // data-science composite is carried by 4 of 10 fields (40%), the digital
    // marketing label by 1 (10%). At the 10% threshold "data" and "analyst"
    // are generic; "digital" and "marketing" are not.
    const dataComposite = 'งาน data scientist/data engineer/data analyst';
    const biology = [dataComposite, 'งานวิจัยและพัฒนา'];
    const marketing = ['งาน digital marketing', 'งาน brand/product marketing'];
    const taxonomy = [
      biology,
      [dataComposite],
      [dataComposite],
      [dataComposite],
      marketing,
      ['งานพยาบาล'],
      ['Logistics / Supply Chain'],
      ['งานบัญชี'],
      ['งานก่อสร้าง'],
      ['งานเกษตร'],
    ];
    const initiative = [{ unmetRoleTh: null, unmetRoleEn: 'Digital Marketing Data Analyst' }];
    const generic = genericRoleTokens(['Digital Marketing Data Analyst'], taxonomy);
    expect([...generic].sort()).toEqual(['analyst', 'data']);
    expect(matchInitiativeToOccupations(initiative, biology, generic)).toBe(false);
    // …and the field the role is actually about still matches, via "digital".
    expect(matchInitiativeToOccupations(initiative, marketing, generic)).toBe(true);
    // Without the stoplist the same call is a false positive — this is the bug.
    expect(matchInitiativeToOccupations(initiative, biology)).toBe(true);
  });
});

describe('genericRoleTokens', () => {
  const taxonomy = [
    ['งาน data scientist/data engineer/data analyst'],
    ['งาน business analyst'],
    ['งาน digital marketing'],
    ['Logistics / Supply Chain'],
    ['งานพยาบาล'],
  ];
  it('drops a word carried by more than the given share of fields, keeps a narrower one', () => {
    // "analyst" is in 2 of 5 fields (40%), "supply" and "chain" in 1 (20%).
    expect([...genericRoleTokens(['Data Analyst', 'Supply Chain Manager'], taxonomy, 0.3)]).toEqual(['analyst']);
    expect([...genericRoleTokens(['Data Analyst', 'Supply Chain Manager'], taxonomy, 0.5)]).toEqual([]);
  });
  it('is empty when there are no fields or no roles', () => {
    expect(genericRoleTokens(['Data Analyst'], []).size).toBe(0);
    expect(genericRoleTokens([], taxonomy).size).toBe(0);
  });
});

// Provenance gating is structural, same reasoning as gap-map.test.ts's
// "computeGapMap provenance gating" describe block: `kmitl_skill_growths`
// DOES carry `ingestion_run_id` (see KmitlSkillGrowth in schema.prisma) and
// must be realDataWhere()-gated, matching how the retired seven-lens analyzer
// read the same table before v1.9.8. `jobthai_occupation_skills`
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
