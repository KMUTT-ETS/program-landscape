import { describe, expect, it } from 'vitest';
import {
  OVERLAP_THRESHOLDS,
  bandFor,
  computeEvidenceHash,
  cosine,
  dot,
  greedyMatch,
  isLanguageVariant,
  majorCourses,
  scorePair,
  serviceCourseCodes,
  shouldStorePair,
  type OverlapProgramme,
} from '../src/program-overlap/score';

const v = (deg: number): number[] => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
const course = (code: string, credits: number, opts: Partial<OverlapProgramme['courses'][number]> = {}) => ({
  id: `${code}-id`, code, credits, category: 'MAJOR_REQUIRED' as const, described: true, vector: v(0), nameTh: code, nameEn: null, ...opts,
});
const prog = (id: string, over: Partial<OverlapProgramme> = {}): OverlapProgramme => ({
  id, code: id, level: 'BACHELOR', facultyId: 'f1', nameTh: id, nameEn: id, degreeNameTh: null, language: 'TH',
  courses: [], plos: [], marketVector: null, staffIds: [], ...over,
});
const T = OVERLAP_THRESHOLDS;

describe('cosine', () => {
  it('is 1 for identical and 0 for orthogonal', () => {
    expect(cosine(v(0), v(0))).toBeCloseTo(1, 10);
    expect(cosine(v(0), v(90))).toBeCloseTo(0, 10);
  });
});

describe('greedyMatch', () => {
  it('matches one-to-one, most similar first, above the threshold', () => {
    const left = [{ id: 'a', vec: v(0) }, { id: 'b', vec: v(10) }];
    const right = [{ id: 'x', vec: v(5) }];
    const m = greedyMatch(left, right, (l, r) => cosine(l.vec, r.vec), 0.9);
    expect(m).toHaveLength(1); // x can be used once
    expect(['a', 'b']).toContain(m[0]!.left.id);
  });
  it('drops pairs below the threshold', () => {
    expect(greedyMatch([{ vec: v(0) }], [{ vec: v(60) }], (l, r) => cosine(l.vec, r.vec), 0.9)).toEqual([]);
  });
});

describe('major-course filter', () => {
  it('excludes gen-ed, free elective, thesis and service courses; keeps null/unknown', () => {
    const p = prog('p', {
      courses: [
        course('GE1', 3, { category: 'GENERAL_EDUCATION' }),
        course('FE1', 3, { category: 'FREE_ELECTIVE' }),
        course('TH1', 6, { category: 'THESIS_PROJECT' }),
        course('SV1', 3, { category: null }),
        course('MJ1', 3, { category: null }),
        course('MJ2', 3, { category: 'UNKNOWN' }),
      ],
    });
    expect(majorCourses(p, new Set(['SV1'])).map((c) => c.code)).toEqual(['MJ1', 'MJ2']);
  });
  it('flags a code used by more than 25% of programmes as a service course', () => {
    const progs = ['a', 'b', 'c', 'd'].map((id) => prog(id, { courses: [course(id === 'd' ? 'X' : 'SV', 3)] }));
    expect(serviceCourseCodes(progs, T.serviceCourseShare)).toEqual(new Set(['SV']));
  });
});

describe('scorePair', () => {
  const ctx = { serviceCodes: new Set<string>(), thresholds: T };

  it('structure: credit-weighted Dice over shared major codes', () => {
    const a = prog('a', { courses: [course('C1', 3), course('C2', 3)] });
    const b = prog('b', { courses: [course('C1', 3), course('C3', 6, { vector: v(90) })] });
    const s = scorePair(a, b, ctx);
    expect(s.sharedCredits).toBe(3);
    expect(s.structure).toBeCloseTo((2 * 3) / (6 + 9) * 100, 10);
  });

  it('content: equivalent courses with different codes, excluding code-matched ones', () => {
    const a = prog('a', { courses: [course('A1', 3, { vector: v(0) }), course('A2', 3, { vector: v(90) }), course('A3', 3, { vector: v(45) })] });
    const b = prog('b', { courses: [course('B1', 3, { vector: v(1) }), course('B2', 3, { vector: v(-90) }), course('B3', 3, { vector: v(200) })] });
    const s = scorePair(a, b, ctx);
    expect(s.equivCredits).toBe(3); // only A1~B1 clears 0.85
    expect(s.content).toBeCloseTo((2 * 3) / (9 + 9) * 100, 10);
  });

  it('content counts described courses shared by code as equivalent', () => {
    const same = [course('C1', 3), course('C2', 3), course('C3', 3)];
    const s = scorePair(prog('a', { courses: same }), prog('b', { courses: same }), ctx);
    expect(s.content).toBe(100);
    expect(s.equivCredits).toBe(0); // different-code equivalents only
  });

  it('content is null when either side has fewer than 3 embedded major courses', () => {
    const a = prog('a', { courses: [course('A1', 3), course('A2', 3), course('A3', 3, { vector: null })] });
    const b = prog('b', { courses: [course('B1', 3), course('B2', 3), course('B3', 3)] });
    expect(scorePair(a, b, ctx).content).toBeNull();
  });

  it('content counts name-only embedded courses towards the minimum (D7)', () => {
    const a = prog('a', { courses: [course('A1', 3, { described: false }), course('A2', 3, { described: false, vector: v(90) }), course('A3', 3, { described: false, vector: v(180) })] });
    const b = prog('b', { courses: [course('B1', 3, { described: false, vector: v(270) }), course('B2', 3, { described: false, vector: v(270) }), course('B3', 3, { described: false, vector: v(270) })] });
    const s = scorePair(a, b, ctx);
    expect(s.content).toBe(0);
    expect(s.evidence.coverage.embeddedA).toBe(3);
    expect(s.evidence.coverage.describedA).toBe(0);
  });

  // a: A1 at the angle under test, A2 v(90), A3 v(180); b: B1 v(0), B2 v(-90), B3 v(135).
  // Off-diagonal cosines all stay ≤ 0.71, so only A1~B1 can match.
  const nameCase = (deg: number, described: boolean) => {
    const a = prog('a', { courses: [course('A1', 3, { vector: v(deg), described }), course('A2', 3, { vector: v(90) }), course('A3', 3, { vector: v(180) })] });
    const b = prog('b', { courses: [course('B1', 3, { vector: v(0), described }), course('B2', 3, { vector: v(-90) }), course('B3', 3, { vector: v(135) })] });
    return scorePair(a, b, ctx);
  };

  it('name-only courses need the stricter 0.90 threshold (D7)', () => {
    expect(Math.cos((29.5 * Math.PI) / 180)).toBeCloseTo(0.87, 2);
    const below = nameCase(29.5, false);
    expect(below.evidence.equivalentCourses).toEqual([]);
    expect(below.equivCredits).toBe(0);

    const above = nameCase(18.2, false);
    expect(above.evidence.equivalentCourses).toHaveLength(1);
    expect(above.evidence.equivalentCourses[0]!.basis).toBe('name');
    expect(above.evidence.coverage.descriptionMatches).toBe(0);
    expect(above.equivCredits).toBe(3);
  });

  it('described courses match at 0.85 with basis description (D7)', () => {
    const s = nameCase(29.5, true);
    expect(s.evidence.equivalentCourses).toHaveLength(1);
    expect(s.evidence.equivalentCourses[0]!.basis).toBe('description');
    expect(s.evidence.coverage.descriptionMatches).toBe(1);
  });

  it('one described and one name-only course use the name threshold', () => {
    const a = prog('a', { courses: [course('A1', 3, { vector: v(29.5) }), course('A2', 3, { vector: v(90) }), course('A3', 3, { vector: v(180) })] });
    const b = prog('b', { courses: [course('B1', 3, { vector: v(0), described: false }), course('B2', 3, { vector: v(-90) }), course('B3', 3, { vector: v(135) })] });
    expect(scorePair(a, b, ctx).evidence.equivalentCourses).toEqual([]);
  });

  it('outcome: share of PLOs covered on both sides', () => {
    const a = prog('a', { plos: [{ ordinal: 1, text: 'x', vector: v(0) }, { ordinal: 2, text: 'y', vector: v(90) }] });
    const b = prog('b', { plos: [{ ordinal: 1, text: 'z', vector: v(2) }] });
    const s = scorePair(a, b, ctx);
    // a: 1 of 2 covered; b: 1 of 1 covered → 2/3
    expect(s.outcome).toBeCloseTo((2 / 3) * 100, 10);
  });

  it('index is the mean of non-null layers and never treats a null as 0', () => {
    const a = prog('a', { plos: [{ ordinal: 1, text: 'x', vector: v(0) }] });
    const b = prog('b', { plos: [{ ordinal: 1, text: 'z', vector: v(0) }] });
    const s = scorePair(a, b, ctx);
    expect(s.structure).toBeNull();
    expect(s.content).toBeNull();
    expect(s.outcome).toBe(100);
    expect(s.overlapIndex).toBe(100);
  });

  it('index is null when every layer is null', () => {
    expect(scorePair(prog('a'), prog('b'), ctx).overlapIndex).toBeNull();
  });

  it('containment is directional', () => {
    const a = prog('a', { courses: [course('C1', 3)] });
    const b = prog('b', { courses: [course('C1', 3), course('C2', 3, { vector: v(90) }), course('C3', 3, { vector: v(180) })] });
    const s = scorePair(a, b, ctx);
    expect(s.containmentAInB).toBe(100);
    expect(s.containmentBInA).toBeCloseTo(100 / 3, 10);
  });

  it('counts shared active staff and flags language variants', () => {
    const a = prog('a', { staffIds: ['s1', 's2'], nameTh: 'วศ.บ. คอม', language: 'TH' });
    const b = prog('b', { staffIds: ['s2', 's3'], nameTh: 'วศ.บ. คอม (หลักสูตรนานาชาติ)', language: 'EN' });
    const s = scorePair(a, b, ctx);
    expect(s.sharedStaff).toBe(1);
    expect(s.languageVariant).toBe(true);
  });

  it('language variant: languages differ, or exactly one side carries an international marker', () => {
    const th = prog('a', { nameTh: 'วท.ม. เภสัชวิทยา', nameEn: 'MSc Pharmacology', language: 'TH' });
    const en = prog('b', { nameTh: 'วท.ม. เภสัชวิทยา', nameEn: 'MSc Pharmacology', language: 'EN' });
    expect(isLanguageVariant(th, en)).toBe(true);
    // Both recorded MIXED on dev; one carries the marker in its Thai name.
    const mixed = prog('c', { nameTh: 'วท.ม. เภสัชวิทยา', nameEn: 'MSc Pharmacology', language: 'MIXED' });
    const mixedIntl = prog('d', { nameTh: 'วท.ม. เภสัชวิทยา (นานาชาติ)', nameEn: 'MSc Pharmacology', language: 'MIXED' });
    expect(isLanguageVariant(mixed, mixedIntl)).toBe(true);
    // ... or only in its English name.
    const mixedIntlEn = prog('e', { nameTh: 'วท.ม. เภสัชวิทยา', nameEn: 'MSc Pharmacology (International Program)', language: 'MIXED' });
    expect(isLanguageVariant(mixed, mixedIntlEn)).toBe(true);
    // Identical unmarked names in the same language: a true duplicate, not a variant.
    expect(isLanguageVariant(mixed, { ...mixed, id: 'f' })).toBe(false);
    // Both marked: two international programmes, not a variant pair.
    expect(isLanguageVariant(mixedIntl, mixedIntlEn)).toBe(false);
    // Different programmes never qualify.
    expect(isLanguageVariant(th, prog('g', { nameTh: 'วท.ม. ชีวเคมี (นานาชาติ)', language: 'EN' }))).toBe(false);
  });

  it('rescales market similarity between floor and ceiling', () => {
    const a = prog('a', { marketVector: v(0) });
    const b = prog('b', { marketVector: v(0) });
    expect(scorePair(a, b, ctx).marketSimilarity).toBe(100);
  });
});

describe('bands and actions', () => {
  it('bands at the edges', () => {
    expect(bandFor(null)).toBe('NONE');
    expect(bandFor(29.99)).toBe('NONE');
    expect(bandFor(30)).toBe('LOW');
    expect(bandFor(50)).toBe('MODERATE');
    expect(bandFor(70)).toBe('HIGH');
  });

  it('consider-merge needs index ≥ 70, containment ≥ 80 and no language variant', () => {
    const same = [course('C1', 3), course('C2', 3), course('C3', 3)];
    const a = prog('a', { courses: same, plos: [{ ordinal: 1, text: 'x', vector: v(0) }] });
    const b = prog('b', { courses: same, plos: [{ ordinal: 1, text: 'x', vector: v(0) }] });
    const s = scorePair(a, b, { serviceCodes: new Set(), thresholds: T });
    expect(s.actions).toContain('CONSIDER_MERGE_OR_TRACK');
    expect(s.actions).toContain('COORDINATE_SHARED_COURSES');
    expect(s.primaryAction).toBe('CONSIDER_MERGE_OR_TRACK');

    const bIntl = { ...b, nameTh: `${b.nameTh} (หลักสูตรนานาชาติ)`, language: 'EN' };
    const aTh = { ...a, nameTh: b.nameTh };
    const s2 = scorePair(aTh, bIntl, { serviceCodes: new Set(), thresholds: T });
    expect(s2.languageVariant).toBe(true);
    expect(s2.actions).not.toContain('CONSIDER_MERGE_OR_TRACK');
  });

  it('differentiate needs index ≥ 50 and market similarity at the threshold', () => {
    const plo = [{ ordinal: 1, text: 'x', vector: v(0) }];
    const s = scorePair(
      prog('a', { plos: plo, marketVector: v(0) }),
      prog('b', { plos: plo, marketVector: v(0) }),
      { serviceCodes: new Set(), thresholds: T },
    );
    expect(s.actions).toContain('DIFFERENTIATE');
  });

  it('shouldStorePair: index ≥ 30, a shared major course, or shared staff', () => {
    const ctx = { serviceCodes: new Set<string>(), thresholds: T };
    const plo = [{ ordinal: 1, text: 'x', vector: v(0) }];
    // index only (outcome 100), nothing shared
    expect(shouldStorePair(scorePair(prog('a', { plos: plo }), prog('b', { plos: plo }), ctx))).toBe(true);
    // shared course with a low index: 3 shared of 3 + 33 credits → structure 16.7, other layers null
    const big = Array.from({ length: 10 }, (_, i) => course(`B${i}`, 3, { vector: v(90) }));
    const shared = scorePair(prog('a', { courses: [course('C1', 3)] }), prog('b', { courses: [course('C1', 3), ...big] }), ctx);
    expect(shared.overlapIndex!).toBeLessThan(30);
    expect(shouldStorePair(shared)).toBe(true);
    // shared staff only
    const staff = scorePair(prog('a', { staffIds: ['s1'] }), prog('b', { staffIds: ['s1'] }), ctx);
    expect(staff.overlapIndex).toBeNull();
    expect(shouldStorePair(staff)).toBe(true);
    // none
    expect(shouldStorePair(scorePair(prog('a'), prog('b'), ctx))).toBe(false);
  });

  it('evidence hash is stable for equal evidence', () => {
    const a = prog('a', { courses: [course('C1', 3)] });
    const b = prog('b', { courses: [course('C1', 3)] });
    expect(scorePair(a, b, { serviceCodes: new Set(), thresholds: T }).evidenceHash).toBe(
      scorePair(a, b, { serviceCodes: new Set(), thresholds: T }).evidenceHash,
    );
  });
});

describe('review fixes', () => {
  const ctx = { serviceCodes: new Set<string>(), thresholds: T };
  const zero = (code: string, opts: Parameters<typeof course>[2] = {}) => course(code, 0, opts);

  it('cosine throws on mismatched vector lengths; dot is the unit-vector fast path', () => {
    expect(() => cosine([1, 0], [1, 0, 0])).toThrow(/length/);
    expect(() => dot([1, 0], [1])).toThrow(/length/);
    expect(dot(v(0), v(60))).toBeCloseTo(cosine(v(0), v(60)), 12);
  });

  it('greedyMatch breaks ties by left index, then right index', () => {
    const left = [{ id: 'a' }, { id: 'b' }];
    const right = [{ id: 'x' }, { id: 'y' }];
    const m = greedyMatch(left, right, () => 1, 0.5);
    expect(m.map((p) => `${p.left.id}${p.right.id}`)).toEqual(['ax', 'by']);
  });

  it('majorCourses filters before de-duplicating and keeps the max credits', () => {
    const p = prog('p', {
      courses: [
        course('C1', 3, { category: 'GENERAL_EDUCATION' }),
        course('C1', 3, { category: 'MAJOR_REQUIRED' }),
        course('C2', 2),
        course('C2', 4),
        course('C3', 3, { credits: null }),
        course('C3', 3),
      ],
    });
    const m = majorCourses(p, new Set());
    expect(m.map((c) => [c.code, c.credits, c.category])).toEqual([
      ['C1', 3, 'MAJOR_REQUIRED'],
      ['C2', 4, 'MAJOR_REQUIRED'],
      ['C3', 3, 'MAJOR_REQUIRED'],
    ]);
  });

  it('all-zero-credit programmes give null credit layers, never NaN', () => {
    const a = prog('a', { courses: [zero('A1'), zero('A2', { vector: v(90) }), zero('A3', { vector: v(180) })] });
    const b = prog('b', { courses: [zero('A1'), zero('B2', { vector: v(-90) }), zero('B3', { vector: v(135) })] });
    const s = scorePair(a, b, ctx);
    expect(s.structure).toBeNull();
    expect(s.content).toBeNull();
    expect(s.containmentAInB).toBeNull();
    expect(s.containmentBInA).toBeNull();
    expect(s.overlapIndex).toBeNull();
    expect(shouldStorePair(s)).toBe(true); // a shared 0-credit course still stores the pair
  });

  it('one zero-credit side: that side has no credit containment, the other does', () => {
    const plo = [{ ordinal: 1, text: 'x', vector: v(0) }];
    const a = prog('a', { courses: [zero('C1')], plos: plo });
    const b = prog('b', { courses: [zero('C1'), course('C2', 3, { vector: v(90) })], plos: plo });
    const s = scorePair(a, b, ctx);
    expect(s.structure).toBe(0); // 2 × 0 / (0 + 3)
    expect(s.containmentAInB).toBe(100); // credit figure null → PLO share only
    expect(s.containmentBInA).toBe(50); // mean(0 credits of 3, 100 PLO)
    expect(Number.isNaN(s.overlapIndex)).toBe(false);
  });

  it('evidence hash changes with shared staff and market similarity', () => {
    const base = { courses: [course('C1', 3)] };
    const h = (over: Partial<OverlapProgramme>, overB: Partial<OverlapProgramme> = {}) =>
      scorePair(prog('a', { ...base, ...over }), prog('b', { ...base, ...overB }), ctx).evidenceHash;
    expect(h({ staffIds: ['s1'] }, { staffIds: ['s1'] })).not.toBe(h({ staffIds: ['s1'] }, { staffIds: ['s2'] }));
    // cos 0 → 100; cos 20° = 0.940 → 97.1
    expect(h({ marketVector: v(0) }, { marketVector: v(0) })).not.toBe(h({ marketVector: v(0) }, { marketVector: v(20) }));
  });

  it('evidence hash ignores float noise below 4 dp', () => {
    const s = scorePair(prog('a', { courses: [course('C1', 3)] }), prog('b', { courses: [course('C1', 3)] }), ctx);
    const payload = (x: number) => ({
      evidence: s.evidence, structure: x, content: s.content, outcome: s.outcome,
      containmentAInB: s.containmentAInB, containmentBInA: s.containmentBInA,
      sharedStaff: s.sharedStaff, marketSimilarity: s.marketSimilarity, actions: s.actions, languageVariant: s.languageVariant,
    });
    expect(computeEvidenceHash(payload(50.00001))).toBe(computeEvidenceHash(payload(50.00002)));
    expect(computeEvidenceHash(payload(50.00001))).not.toBe(computeEvidenceHash(payload(50.1)));
  });
});
