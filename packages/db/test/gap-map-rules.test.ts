import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GAP_THRESHOLDS,
  parseThresholds,
  pipelineArrow,
  reconcile,
  verdictFor,
} from '../src/gap-map-rules';
import { JOBTHAI_MIN_POSTINGS_FOR_SIGNAL } from '../src/jobthai-bridge';

// Decision 3 of the spec: ratio = KKU supply share ÷ demand share. White
// space = no programme; < under = under-served; between = served;
// > over = over-served; below the posting floor = no verdict.

const t = DEFAULT_GAP_THRESHOLDS;
const base = { postings: 100, programmes: 1, scoredWithSupply: 1, demandShare: 0.1, supplyShare: 0.1, thresholds: t };

describe('verdictFor', () => {
  it('white space when no programme is assigned, whatever the supply share', () => {
    expect(verdictFor({ ...base, programmes: 0, scoredWithSupply: 0, supplyShare: 0 })).toEqual({
      ratio: null,
      verdict: 'white-space',
    });
  });
  it('supply-unknown when programmes are assigned but none of them carry a supply figure', () => {
    // 0 of 1 scored programme has a supply figure — a data gap, not a
    // measured zero, so no ratio is reported at all.
    expect(verdictFor({ ...base, scoredWithSupply: 0 })).toEqual({ ratio: null, verdict: 'supply-unknown' });
  });
  it('a normal verdict once at least one scored programme has a supply figure, even if others do not', () => {
    // 1 of 2 scored programmes has a supply figure — proceeds past the
    // supply-unknown gate to the ordinary ratio computation.
    const r = verdictFor({ ...base, programmes: 2, scoredWithSupply: 1 });
    expect(r.verdict).toBe('served');
    expect(r.ratio).toBe(1);
  });
  it('under-served strictly below `under`, served at the boundary', () => {
    expect(verdictFor({ ...base, supplyShare: 0.049 }).verdict).toBe('under-served');
    expect(verdictFor({ ...base, supplyShare: 0.05 }).verdict).toBe('served');
  });
  it('over-served strictly above `over`, served at the boundary', () => {
    expect(verdictFor({ ...base, supplyShare: 0.2 }).verdict).toBe('served');
    expect(verdictFor({ ...base, supplyShare: 0.2001 }).verdict).toBe('over-served');
  });
  it('reports the ratio rounded to two decimals', () => {
    expect(verdictFor({ ...base, supplyShare: 0.0333 }).ratio).toBe(0.33);
  });
  it('no verdict below the posting floor, ratio still reported', () => {
    const r = verdictFor({ ...base, postings: JOBTHAI_MIN_POSTINGS_FOR_SIGNAL - 1 });
    expect(r).toEqual({ ratio: 1, verdict: 'too-few-postings' });
    expect(verdictFor({ ...base, postings: JOBTHAI_MIN_POSTINGS_FOR_SIGNAL }).verdict).toBe('served');
  });
  it('a programme with zero graduates is under-served, not a white space', () => {
    expect(verdictFor({ ...base, supplyShare: 0 })).toEqual({ ratio: 0, verdict: 'under-served' });
  });
  it('honours custom thresholds', () => {
    expect(verdictFor({ ...base, supplyShare: 0.06, thresholds: { under: 0.7, over: 3 } }).verdict).toBe('under-served');
  });
});

describe('parseThresholds', () => {
  it('defaults, accepts 0 < under < over, rejects anything else', () => {
    expect(parseThresholds({})).toEqual(t);
    expect(parseThresholds({ under: '0.7', over: '3' })).toEqual({ under: 0.7, over: 3 });
    expect(() => parseThresholds({ under: '2', over: '1' })).toThrow();
    expect(() => parseThresholds({ under: '0', over: '1' })).toThrow();
    expect(() => parseThresholds({ under: 'x' })).toThrow();
  });
});

describe('pipelineArrow', () => {
  it('compares pipeline ÷ 4 with graduates per year at 1.25× and 0.75×', () => {
    expect(pipelineArrow(100, 600)).toBe('up'); // 150 > 125
    expect(pipelineArrow(100, 400)).toBe('flat'); // 100
    expect(pipelineArrow(100, 280)).toBe('down'); // 70 < 75
    expect(pipelineArrow(100, 500)).toBe('flat'); // 125 is not > 125
  });
  it('is null when either side is missing or graduates are zero', () => {
    expect(pipelineArrow(null, 400)).toBeNull();
    expect(pipelineArrow(100, null)).toBeNull();
    expect(pipelineArrow(0, 400)).toBeNull();
  });
});

describe('reconcile', () => {
  it('both sides sum to 1 over field-mentions and field-graduates', () => {
    const rows = [
      { postings: 60, programmeIds: ['p1'], gradsPerYear: 100 },
      { postings: 40, programmeIds: ['p2'], gradsPerYear: 50 },
    ];
    const r = reconcile(rows, { fieldMentions: 100, fieldGraduates: 150 });
    expect(r.demandShareSum).toBeCloseTo(1, 6);
    expect(r.supplyShareSum).toBeCloseTo(1, 6);
    expect(r.multiFieldProgrammes).toBe(0);
    expect(r.fieldGraduatesTotal).toBe(150);
  });
  it('a posting naming two fields and a programme in two fields still sum to 1 on each side', () => {
    // 100 distinct postings, 20 of them name both fields → 120 mentions.
    // p2 (50 grads/yr) is assigned to both fields → 150 field-graduates
    // from 100 distinct graduates.
    const rows = [
      { postings: 80, programmeIds: ['p1', 'p2'], gradsPerYear: 100 },
      { postings: 40, programmeIds: ['p2'], gradsPerYear: 50 },
    ];
    const r = reconcile(rows, { fieldMentions: 120, fieldGraduates: 150 });
    expect(r.demandShareSum).toBeCloseTo(1, 6);
    expect(r.supplyShareSum).toBeCloseTo(1, 6);
    expect(r.multiFieldProgrammes).toBe(1);
    expect(r.fieldGraduatesTotal).toBe(150);
  });
  it('is 0 on both sides when nothing is counted', () => {
    expect(reconcile([], { fieldMentions: 0, fieldGraduates: 0 })).toEqual({
      demandShareSum: 0,
      supplyShareSum: 0,
      multiFieldProgrammes: 0,
      fieldGraduatesTotal: 0,
    });
  });
});
