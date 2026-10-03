import { describe, expect, it, vi } from 'vitest';

// No real client: nothing here can reach the dev database.
vi.mock('../src/index', () => ({ prisma: {} }));

import {
  evaluateKris,
  MARKET_CONFUSION_CRITICAL,
  MARKET_CONFUSION_WARN,
  RISK_INDICATOR_CATALOG,
  RISK_SCORING_VERSION,
} from '../src/risk-scoring';
import { deriveRuleMeasures, RISK_MEASURE_RULES_VERSION } from '../src/risk-measure-rules';
import { overlapBreachFlags, overlapMeasureEvidence } from '../src/program-overlap/risk';

const base = { programId: 'p', level: 'BACHELOR', status: 'ACTIVE', tcasFunnel: [], enrollment: [], skills: [] } as never;
const withOverlap = (o: object) => ({ ...(base as object), overlap: o }) as never;
const thresholds = Object.fromEntries(RISK_INDICATOR_CATALOG.map((c) => [c.slug, c]));
const signal = (o: object = {}) => ({
  curriculumOverlapMax: null, curriculumSiblingId: null, curriculumPairId: null, curriculumRunId: null,
  curriculumContainmentMax: null, curriculumActions: [],
  mergeCandidate: false, marketConfusionMax: null, marketSiblingId: null, marketPairId: null, marketRunId: null,
  runId: 'r', ...o,
});

describe('overlap KRIs', () => {
  it('version is v1.14 and the catalogue has both slugs', () => {
    expect(RISK_SCORING_VERSION).toBe('risk-scoring.v1.14');
    expect(RISK_MEASURE_RULES_VERSION).toBe('risk-measure-rules.v2');
    expect(RISK_INDICATOR_CATALOG.map((c) => c.slug)).toEqual(expect.arrayContaining(['curriculum_overlap_max', 'market_confusion_max']));
  });
  it('catalogue thresholds: curriculum 50/70, market from the provisional constants', () => {
    const c = thresholds['curriculum_overlap_max']!;
    expect([c.warnThreshold, c.criticalThreshold, c.alarmDirection]).toEqual([50, 70, 'high']);
    const m = thresholds['market_confusion_max']!;
    expect([m.warnThreshold, m.criticalThreshold, m.alarmDirection]).toEqual([MARKET_CONFUSION_WARN, MARKET_CONFUSION_CRITICAL, 'high']);
  });
  it('curriculum KRI description is course-only: no PLO alignment in the index (D9)', () => {
    const c = thresholds['curriculum_overlap_max']!;
    expect(c.descriptionEn).toMatch(/courses only/);
    expect(c.descriptionEn).not.toMatch(/PLO/);
    expect(c.descriptionTh).not.toMatch(/ผลลัพธ์การเรียนรู้/);
  });
  it('null without an overlap run', () => {
    const out = evaluateKris(base, new Date('2026-10-03'));
    expect(out.find((b) => b.indicatorSlug === 'curriculum_overlap_max')).toBeUndefined();
    expect(out.find((b) => b.indicatorSlug === 'market_confusion_max')).toBeUndefined();
  });
  it('overlap undefined and overlap null both emit no overlap rows', () => {
    for (const o of [undefined, null]) {
      const out = evaluateKris({ ...(base as object), overlap: o } as never, new Date('2026-10-03'));
      expect(out.filter((b) => b.indicatorSlug.endsWith('_max'))).toEqual([]);
    }
  });
  it('a covering run with no stored value emits OK rows with a null value, each KRI independently', () => {
    const none = evaluateKris(withOverlap(signal()), new Date('2026-10-03')).filter((b) => b.indicatorSlug.endsWith('_max'));
    expect(none.map((b) => [b.indicatorSlug, b.severity, b.value])).toEqual([
      ['curriculum_overlap_max', 'OK', null],
      ['market_confusion_max', 'OK', null],
    ]);
    const onlyMarket = evaluateKris(withOverlap(signal({ marketConfusionMax: 80 })), new Date('2026-10-03'))
      .filter((b) => b.indicatorSlug.endsWith('_max'));
    expect(onlyMarket.map((b) => [b.indicatorSlug, b.severity, b.value])).toEqual([
      ['curriculum_overlap_max', 'OK', null],
      ['market_confusion_max', 'CRITICAL', 80],
    ]);
    // an OK/null row fires no rule
    expect(deriveRuleMeasures(none, thresholds)).toEqual([]);
  });
  it('WARN at 50, CRITICAL at 70', () => {
    const at = (v: number) => evaluateKris(withOverlap({ curriculumOverlapMax: v, marketConfusionMax: null, mergeCandidate: false, curriculumSiblingId: 'q', marketSiblingId: null }), new Date('2026-10-03'))
      .find((b) => b.indicatorSlug === 'curriculum_overlap_max')!.severity;
    expect(at(49.9)).toBe('OK');
    expect(at(50)).toBe('WARN');
    expect(at(69.9)).toBe('WARN');
    expect(at(70)).toBe('CRITICAL');
  });
  it('curriculum overlap 100 is CRITICAL with no evidence cap (course-based index, D9)', () => {
    const row = evaluateKris(
      withOverlap(signal({ curriculumOverlapMax: 100, curriculumSiblingId: 'q', mergeCandidate: false })),
      new Date('2026-10-03'),
    ).find((b) => b.indicatorSlug === 'curriculum_overlap_max')!;
    expect([row.severity, row.value]).toEqual(['CRITICAL', 100]);
  });
  it('market confusion bands use the provisional constants', () => {
    const at = (v: number) => evaluateKris(withOverlap(signal({ marketConfusionMax: v })), new Date('2026-10-03'))
      .find((b) => b.indicatorSlug === 'market_confusion_max')!.severity;
    expect(at(MARKET_CONFUSION_WARN - 0.1)).toBe('OK');
    expect(at(MARKET_CONFUSION_WARN)).toBe('WARN');
    expect(at(MARKET_CONFUSION_CRITICAL)).toBe('CRITICAL');
  });
  it('CRITICAL overlap → differentiate; plus merge only for a merge candidate', () => {
    const kinds = (merge: boolean) => deriveRuleMeasures(
      [{ indicatorSlug: 'curriculum_overlap_max', severity: 'CRITICAL', value: 75, flags: merge ? ['merge-candidate'] : [] }],
      thresholds,
    ).map((m) => m.measure.kind);
    expect(kinds(false)).toEqual(['CURRICULUM_DIFFERENTIATE']);
    expect(kinds(true)).toEqual(expect.arrayContaining(['CURRICULUM_DIFFERENTIATE', 'PROGRAM_MERGE']));
  });
  it('flag-gated rule keys stay unique; values render as whole numbers', () => {
    const m = deriveRuleMeasures(
      [{ indicatorSlug: 'curriculum_overlap_max', severity: 'CRITICAL', value: 74.6, flags: ['merge-candidate'] }],
      thresholds,
    );
    expect(m.map((x) => x.ruleKey).sort()).toEqual(['curriculum_overlap_max:CRITICAL', 'curriculum_overlap_max:CRITICAL:merge-candidate']);
    expect(m.find((x) => x.measure.kind === 'CURRICULUM_DIFFERENTIATE')!.measure.rationaleEn).toContain('75/100 (critical at 70)');
  });
  it('WARN overlap fires no rule', () => {
    expect(deriveRuleMeasures([{ indicatorSlug: 'curriculum_overlap_max', severity: 'WARN', value: 55 }], thresholds)).toEqual([]);
  });
  it('CRITICAL market confusion → differentiate (marketing wording)', () => {
    const m = deriveRuleMeasures([{ indicatorSlug: 'market_confusion_max', severity: 'CRITICAL', value: 85 }], thresholds);
    expect(m.map((x) => x.measure.kind)).toEqual(['CURRICULUM_DIFFERENTIATE']);
    expect(m[0]!.measure.horizon).toBe('SHORT_TERM');
  });
  it('breach flags and measure evidence come from the signal', () => {
    const s = signal({
      curriculumOverlapMax: 80, curriculumSiblingId: 'q', curriculumRunId: 'r1', curriculumPairId: 'pr1', mergeCandidate: true,
      marketConfusionMax: 90, marketSiblingId: 'm', marketRunId: 'r2', marketPairId: 'pr2',
    });
    expect(overlapBreachFlags('curriculum_overlap_max', s)).toEqual(['merge-candidate']);
    expect(overlapBreachFlags('market_confusion_max', s)).toEqual([]);
    expect(overlapBreachFlags('curriculum_overlap_max', null)).toEqual([]);
    expect(overlapMeasureEvidence('curriculum_overlap_max', s)).toEqual({ siblingProgramId: 'q', overlapRunId: 'r1', overlapPairId: 'pr1' });
    expect(overlapMeasureEvidence('market_confusion_max', s)).toEqual({ siblingProgramId: 'm', overlapRunId: 'r2', overlapPairId: 'pr2' });
    expect(overlapMeasureEvidence('application_seat_ratio', s)).toBeNull();
    expect(overlapMeasureEvidence(null, s)).toBeNull();
    expect(overlapMeasureEvidence('curriculum_overlap_max', null)).toBeNull();
  });
});
