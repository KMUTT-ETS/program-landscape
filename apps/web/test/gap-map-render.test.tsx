import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProvenanceProvider, TooltipProvider } from '@kku/ui';
import type { ApiMeta } from '@kku/shared';
import { GapMapSections } from '../app/gap-analysis/sections';
import { gapHref, resolveGapParams, type GapMapT, type GapRowT } from '../app/gap-analysis/types';

// The whole page below the PageHeader is a pure function of GapPageData, and
// every control is a link or a plain GET form, so the render can be asserted
// here with no DOM and no Next router. The assertions are about what a reader
// SEES — the wording of a verdict, whether a missing measurement can be
// mistaken for a shortfall — not about class names.

const meta: ApiMeta = {
  freshnessDate: '2026-09-15T00:00:00Z',
  sources: [{ id: 'jobthai', name: 'JobThai' }],
  methodologyVersion: 'gap-map.v1',
  caveats: ['national adverts'],
};

const row = (o: Partial<GapRowT>): GapRowT => ({
  slug: 'x',
  nameTh: 'ฟิลด์',
  nameEn: 'Field',
  reviewStatus: 'APPROVED',
  postings: 500,
  demandShare: 0.05,
  supplyShare: 0.05,
  ratio: 1,
  verdict: 'served',
  gradsPerYear: 100,
  pipeline: 400,
  pipelineArrow: 'flat',
  programmeCount: 1,
  programmesWithSupply: 1,
  signalCount: 0,
  kkuTotal: null,
  provinces: [{ province: 'กรุงเทพมหานคร', share: 0.6 }],
  occupations: [
    {
      occupationId: 'o1',
      code: 'jobthai:x',
      category: 'Cat',
      subcategory: 'Occ A',
      postings: 300,
      linkedProgramIds: ['p1'],
    },
  ],
  programmes: [
    {
      programId: 'p1',
      code: 'KKU-SEQ-0001',
      nameTh: 'โปรแกรม',
      nameEn: 'Programme',
      level: 'BACHELOR',
      facultyId: 'f1',
      facultyNameEn: 'Engineering',
      gradsPerYear: 100,
      supplySource: 'alumni',
      pipeline: 400,
      healthScore: 71,
      scored: true,
      reviewStatus: 'APPROVED',
    },
  ],
  facultyIds: ['f1'],
  globalSignal: { skills: [], scope: null },
  trendSignals: [],
  ...o,
});

const map: GapMapT = {
  methodologyVersion: 'gap-map.v1',
  computedAt: '2026-09-15T00:00:00Z',
  scope: { level: 'university', id: null, label: null },
  thresholds: { under: 0.5, over: 2 },
  rows: [
    row({
      slug: 'logistics',
      nameEn: 'Logistics',
      nameTh: 'โลจิสติกส์',
      verdict: 'white-space',
      ratio: null,
      supplyShare: 0,
      programmes: [],
      programmeCount: 0,
      programmesWithSupply: 0,
      gradsPerYear: null,
      pipeline: null,
      pipelineArrow: null,
      facultyIds: [],
      signalCount: 1,
      trendSignals: [
        {
          id: 't1',
          title: 'EEC logistics hub',
          signalType: 'POLICY',
          impactScore: 0.8,
          detectedDate: '2026-08-01',
          matchedBy: 'initiative',
        },
      ],
    }),
    row({
      slug: 'electrical-engineering',
      nameEn: 'Electrical engineering',
      nameTh: 'วิศวกรรมไฟฟ้า',
      verdict: 'served',
      programmeCount: 3,
      programmesWithSupply: 2,
      programmes: [
        {
          programId: 'p1',
          code: 'KKU-SEQ-0001',
          nameTh: 'โปรแกรม',
          nameEn: 'Programme',
          level: 'BACHELOR',
          facultyId: 'f1',
          facultyNameEn: 'Engineering',
          gradsPerYear: 100,
          supplySource: 'alumni',
          pipeline: 400,
          healthScore: 71,
          scored: true,
          reviewStatus: 'APPROVED',
        },
        {
          programId: 'p2',
          code: 'KKU-SEQ-0002',
          nameTh: 'โปรแกรมสอง',
          nameEn: 'Fallback programme',
          level: 'BACHELOR',
          facultyId: 'f1',
          facultyNameEn: 'Engineering',
          gradsPerYear: 40,
          supplySource: 'enrolment-proxy',
          pipeline: 150,
          healthScore: 60,
          scored: true,
          reviewStatus: 'APPROVED',
        },
      ],
      globalSignal: {
        skills: [{ skillId: 's1', nameEn: 'PLC programming', nameTh: 'พีแอลซี', growthPct: 41, scope: 'THAILAND', contexts: 28 }],
        scope: 'THAILAND',
      },
    }),
    row({ slug: 'geology', nameEn: 'Geology', nameTh: 'ธรณีวิทยา', verdict: 'too-few-postings', postings: 14, ratio: 2.9 }),
    row({
      slug: 'unreviewed',
      nameEn: 'Unreviewed field',
      nameTh: 'ยังไม่ตรวจ',
      reviewStatus: 'PROPOSED',
      verdict: 'under-served',
      ratio: 0.3,
    }),
    row({
      slug: 'veterinary-science',
      nameEn: 'Veterinary science',
      nameTh: 'สัตวแพทยศาสตร์',
      verdict: 'supply-unknown',
      ratio: null,
      gradsPerYear: null,
      supplyShare: 0,
      programmeCount: 2,
      programmesWithSupply: 0,
      programmes: [
        {
          programId: 'p9',
          code: 'KKU-SEQ-0099',
          nameTh: 'สัตวแพทย์',
          nameEn: 'Veterinary medicine',
          level: 'BACHELOR',
          facultyId: 'f2',
          facultyNameEn: 'Veterinary Medicine',
          gradsPerYear: null,
          supplySource: null,
          pipeline: 120,
          healthScore: null,
          scored: true,
          reviewStatus: 'APPROVED',
        },
      ],
      facultyIds: ['f2'],
    }),
  ],
  verdictCounts: {
    'white-space': 1,
    'under-served': 1,
    served: 1,
    'over-served': 0,
    'supply-unknown': 1,
    'too-few-postings': 1,
  },
  facultyStrip: [
    {
      facultyId: 'f1',
      nameTh: 'วิศวกรรมศาสตร์',
      nameEn: 'Engineering',
      counts: {
        'white-space': 0,
        'under-served': 1,
        served: 2,
        'over-served': 0,
        'supply-unknown': 0,
        'too-few-postings': 0,
      },
    },
  ],
  reconciliation: {
    eligiblePostings: 33_307,
    fieldPostings: 20_000,
    fieldMentions: 24_500,
    multiFieldPostings: 3_100,
    anyFieldPostings: 2_566,
    otherKinds: 3_337,
    otherMentions: 2_900,
    postgraduatePostings: 41,
    demandShareSum: 1,
    supplyShareSum: 1.12,
    multiFieldProgrammes: 9,
    fieldGraduatesTotal: 12_000,
    scoredProgrammes: 99,
    scoredWithSupply: 83,
    supplyFromProxy: 14,
  },
  taxonomy: { approved: 3, proposed: 2 },
  freshness: { postingsAsOf: '2026-09-13T00:00:00Z', taxonomyAsOf: '2026-09-15T00:00:00Z' },
};

const render = (params = resolveGapParams({})) =>
  renderToStaticMarkup(
    <TooltipProvider>
      <ProvenanceProvider>
        <GapMapSections data={{ params, map, meta }} />
      </ProvenanceProvider>
    </TooltipProvider>,
  );
const textOf = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('GapMapSections', () => {
  const html = render();
  const text = textOf(html);

  it('shows verdict chips with counts and the faculty strip', () => {
    expect(text).toMatch(/All\s*·\s*5/);
    expect(text).toMatch(/White space\s*·\s*1/);
    expect(text).toMatch(/Supply unknown\s*·\s*1/);
    expect(text).toMatch(/Too few postings\s*·\s*1/);
    expect(text).toContain('Engineering');
  });

  it('renders every row with both names, shares, ratio and verdict; a white space has no ratio', () => {
    expect(text).toContain('โลจิสติกส์');
    expect(text).toContain('Logistics');
    expect(text).toContain('5.0 %');
    expect(html).toContain('data-verdict="white-space"');
    expect(text).toMatch(/Logistics[^]*?—/);
  });

  it('states too few postings instead of a verdict, and marks proposed rows unreviewed', () => {
    expect(text).toContain('too few postings (14)');
    expect(text).toContain('unreviewed');
  });

  it('says supply not recorded for a field whose programmes carry no graduate figure', () => {
    expect(html).toContain('data-verdict="supply-unknown"');
    expect(text).toContain('supply not recorded');
    // It is a missing measurement, not a shortfall: it must never be
    // dressed in the danger tone a white space carries.
    const cell = /<td[^>]*>\s*supply not recorded\s*<\/td>/.exec(html)?.[0] ?? '';
    expect(cell).not.toContain('danger');
    expect(cell).not.toContain('warning');
  });

  it('filters rows by the verdict in the URL', () => {
    const t = textOf(render(resolveGapParams({ verdict: 'white-space' })));
    expect(t).toContain('Logistics');
    expect(t).not.toContain('Geology');
  });

  it('expands the row named in the URL with occupations, programmes and what is coming', () => {
    const t = textOf(render(resolveGapParams({ field: 'electrical-engineering' })));
    expect(t).toContain('Occ A');
    expect(t).toContain('KKU-SEQ-0001');
    expect(t).toContain('PLC programming');
    expect(t).toContain('41 %');
    // A figure averaged over 28 contexts must state that count beside it —
    // a bare "41 %" would read the same as a single-context observation.
    expect(t).toContain('28 contexts');
    expect(t).toContain('LinkedIn data via MHESI');
  });

  it('says where each programme-level graduate figure came from', () => {
    // An alumni-cohort mean and an enrolment-metric fallback are not the
    // same measurement; rendering both as a bare "N graduates / yr" made
    // them indistinguishable to a reader.
    const t = textOf(render(resolveGapParams({ field: 'electrical-engineering' })));
    expect(t).toContain('100 graduates / yr (alumni cohorts)');
    expect(t).toContain('40 graduates / yr (enrolment fallback)');
  });

  it('states what the reconciliation supply total rests on', () => {
    expect(text).toMatch(/rests on 83 of 99 scored programmes/i);
    expect(text).toContain('69 counted from alumni entry cohorts');
    expect(text).toContain('14 from the enrolment-metric fallback');
    expect(text).toContain('16 with no graduate figure at all');
  });

  it('describes the supply rule as a per-cohort mean, never as a fixed divisor', () => {
    expect(text).not.toMatch(/last five registrar cohorts/i);
    expect(text).toMatch(/not by a fixed five/i);
    expect(text).toMatch(/still in progress is never read as a measured zero/i);
  });

  it('says how much of a field is actually measured when only some programmes have graduates', () => {
    const t = textOf(render(resolveGapParams({ field: 'electrical-engineering' })));
    expect(t).toMatch(/graduate figures for 2 of 3 scored programmes/i);
    const whole = textOf(render(resolveGapParams({ field: 'geology' })));
    expect(whole).not.toMatch(/graduate figures for/i);
  });

  it('states empty panels instead of hiding them', () => {
    const t = textOf(render(resolveGapParams({ field: 'logistics' })));
    expect(t).toMatch(/No KKU programme/i);
    expect(t).toMatch(/No rising skill/i);
    expect(t).toContain('EEC logistics hub');
  });

  it('shows the reconciliation line and provenance on the table', () => {
    expect(text).toContain('2,566');
    expect(text).toContain('12,000');
    expect(text).toMatch(/9 programmes? .*two fields|two fields.*9/);
    expect(html).toContain('aria-label="Show provenance for Gap map"');
  });

  it('states the review backlog as a state of the taxonomy, not as a failure', () => {
    expect(text).toMatch(/3 of 5 fields/);
    expect(text).toMatch(/awaiting review/i);
    expect(text).not.toMatch(/error|invalid|broken/i);
  });
});

describe('gapHref', () => {
  it('round-trips the URL contract and omits defaults', () => {
    const p = resolveGapParams({
      scope: 'faculty',
      scopeId: 'f1',
      verdict: 'under-served',
      faculty: 'f1',
      under: '0.7',
      over: '3',
      field: 'x',
    });
    expect(gapHref(p)).toBe('/gap-analysis?scope=faculty&scopeId=f1&verdict=under-served&faculty=f1&under=0.7&over=3&field=x');
    expect(gapHref(resolveGapParams({}))).toBe('/gap-analysis');
    expect(resolveGapParams({ under: '3', over: '1' })).toMatchObject({ under: 0.5, over: 2 });
  });

  it('accepts supply-unknown as a verdict filter', () => {
    expect(resolveGapParams({ verdict: 'supply-unknown' }).verdict).toBe('supply-unknown');
    expect(resolveGapParams({ verdict: 'nonsense' }).verdict).toBe('all');
  });
});
