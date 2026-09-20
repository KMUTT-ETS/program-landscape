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
  methodologyVersion: 'gap-map.v2',
  caveats: ['national adverts'],
};

const row = (o: Partial<GapRowT>): GapRowT => ({
  slug: 'x',
  nameTh: 'ฟิลด์',
  nameEn: 'Field',
  reviewStatus: 'APPROVED',
  postings: 500,
  demandShare: 0.05,
  // Defaults keep the fixture entirely private-sector, so the new
  // government-positions block (rendered only when publicPostings > 0)
  // stays out of every pre-existing assertion in this file; the basis
  // control's own coverage lives in gap-analysis-basis.test.tsx.
  privateDemandShare: 0.05,
  publicDemandShare: 0,
  privatePostings: 500,
  publicPostings: 0,
  supplyShare: 0.05,
  ratio: 1,
  verdict: 'served',
  gradsPerYear: 100,
  pipeline: 400,
  pipelineArrow: 'flat',
  programmeCount: 1,
  programmesWithSupply: 1,
  postgraduateProgrammes: 0,
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
      // One programme of this field, and two from outside it — the case the
      // page used to print raw cuids for, because it resolved names only
      // against the field's own programmes. The ids here are real cuid
      // shapes so the regression assertion has something to catch.
      linkedProgrammes: [
        { programId: 'p1', code: 'KKU-SEQ-0001', nameTh: 'โปรแกรม', nameEn: 'Programme', inField: true },
        {
          programId: 'cmon1wwxs000dzh902umgd22e',
          code: 'KKU-SEQ-0044',
          nameTh: 'วิศวกรรมเครื่องกล',
          nameEn: 'Mechanical Engineering',
          inField: false,
        },
        {
          programId: 'cmon1wx1y000lzh90i65vo4pt',
          code: 'KKU-SEQ-0045',
          nameTh: 'วิศวกรรมไฟฟ้า',
          nameEn: 'Electrical Engineering',
          inField: false,
        },
      ],
      linkedInField: 1,
      linkedOutsideField: 5,
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
      supplyCohorts: 5,
      supplyYear: null,
      durationYears: 4,
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
  methodologyVersion: 'gap-map.v2',
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
          supplyCohorts: 6,
          supplyYear: null,
          durationYears: 4,
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
          supplyCohorts: null,
          supplyYear: 2017,
          durationYears: 4,
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
          supplyCohorts: null,
          supplyYear: null,
          durationYears: 6,
          pipeline: 120,
          healthScore: null,
          scored: true,
          reviewStatus: 'APPROVED',
        },
      ],
      facultyIds: ['f2'],
    }),
    // A white space that is only a white space at bachelor level: KKU runs
    // a Master's in it. The collapsed row must not read like `logistics`,
    // where KKU teaches nothing at all.
    row({
      slug: 'psychology',
      nameEn: 'Psychology',
      nameTh: 'จิตวิทยา',
      verdict: 'white-space',
      ratio: null,
      supplyShare: 0,
      programmeCount: 0,
      programmesWithSupply: 0,
      postgraduateProgrammes: 1,
      gradsPerYear: null,
      pipeline: null,
      pipelineArrow: null,
      facultyIds: [],
      programmes: [
        {
          programId: 'p7',
          code: 'KKU-SEQ-0253',
          nameTh: 'จิตวิทยามหาบัณฑิต',
          nameEn: 'Master of Psychology',
          level: 'MASTER',
          facultyId: 'f3',
          facultyNameEn: 'Humanities and Social Sciences',
          gradsPerYear: 1,
          supplySource: 'alumni',
          supplyCohorts: 1,
          supplyYear: null,
          durationYears: 2,
          pipeline: 12,
          healthScore: 64,
          scored: false,
          reviewStatus: 'APPROVED',
        },
      ],
    }),
  ],
  verdictCounts: {
    'white-space': 2,
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
  taxonomy: { approved: 4, proposed: 2 },
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
    expect(text).toMatch(/All\s*·\s*6/);
    expect(text).toMatch(/White space\s*·\s*2/);
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

  it('names every linked programme and never prints an id', () => {
    // `program_jobthai_links` links an occupation to any programme whose
    // stated field of study matches, so most linked programmes are NOT in
    // the field being read. The page used to resolve names against the
    // field's own list only, and printed the raw cuid for the rest:
    // "งานช่างซ่อมบำรุง — 355 adverts ← cmon1wwxs000dzh902umgd22e, …".
    const t = textOf(render(resolveGapParams({ field: 'electrical-engineering' })));
    expect(t).toContain('Occ A');
    expect(t).toContain('Mechanical Engineering');
    expect(t).toContain('Electrical Engineering');
    // An occupation that also recruits outside the field says so in words,
    // and says how many more there are rather than truncating in silence.
    expect(t).toMatch(/Also recruits from[^]*?and 3 more[^]*?assigned to other fields/);
    expect(t).toMatch(/Recruits from[^]*?in this field/);
  });

  it('renders no cuid-shaped token anywhere a reader can see', () => {
    // Asserted against the SHAPE, not against the two ids in the fixture:
    // any future `?? id` fallback re-breaking this has to fail here.
    const CUID = /\bc[a-z0-9]{24}\b/;
    for (const params of [
      resolveGapParams({}),
      resolveGapParams({ field: 'electrical-engineering' }),
      resolveGapParams({ field: 'logistics' }),
      resolveGapParams({ field: 'psychology' }),
    ]) {
      expect(textOf(render(params))).not.toMatch(CUID);
    }
  });

  it('says what each share is a percentage of, in the header and in a sentence', () => {
    // The two shares carry the whole verdict; a bare "Demand share" left a
    // general reader with no way to tell what it was a share OF.
    expect(text).toContain('% of adverts');
    expect(text).toContain('% of graduates');
    expect(text).toContain('KKU ÷ demand');
    expect(html).toContain('title="Demand share: of all the job adverts that name any field of study');
    expect(html).toContain('title="KKU share: of all the graduates KKU produces each year');
    // The plain-English line is always visible, not folded into the
    // collapsed note the reader already could not follow.
    expect(text).toMatch(/Each row compares two percentages/);
    expect(text).toMatch(/below 1 means KKU produces proportionally fewer graduates/);
    expect(text).toMatch(/above 1 means proportionally more/);
  });

  it('lists every faculty without a sideways scroller', () => {
    const controls = /Faculty:[^]*?<\/details>/.exec(html)?.[0] ?? '';
    expect(controls).not.toBe('');
    expect(controls).not.toMatch(/overflow-x/);
    expect(controls).toContain('Engineering');
    expect(controls).toContain('All faculties');
    expect(textOf(controls)).toMatch(/choose from 1 with fields of study/);
  });

  it('names the selected faculty in the filter summary and offers a way back to all', () => {
    const t = textOf(render(resolveGapParams({ faculty: 'f1' })));
    expect(t).toMatch(/Faculty: Engineering/);
    expect(t).toContain('All faculties');
  });

  it('says where each programme-level graduate figure came from, and what it rests on', () => {
    // An alumni-cohort mean and an enrolment-metric fallback are not the
    // same measurement; rendering both as a bare "N graduates / yr" made
    // them indistinguishable to a reader. Nor are a mean over six cohorts
    // and one over one, nor a fallback read last year and one read in 2017.
    const t = textOf(render(resolveGapParams({ field: 'electrical-engineering' })));
    expect(t).toContain('100 graduates / yr (mean of 6 alumni cohorts)');
    expect(t).toContain('40 graduates / yr (enrolment fallback, AY 2017)');
  });

  it('names the year an enrolment-proxy figure was read from wherever one is shown', () => {
    // The reach-back has no floor — AY 2006 at the far end on dev — so a
    // figure with no year is indistinguishable from one taken last year.
    const t = textOf(render(resolveGapParams({ field: 'electrical-engineering' })));
    expect(t).toMatch(/enrolment fallback, AY 2017/);
    expect(t).not.toMatch(/enrolment fallback\)/);
  });

  it('distinguishes a white space that holds a postgraduate programme from one that holds nothing', () => {
    // Both rows show "Programmes: —". Read at a glance, `psychology` must
    // not say the same thing as `human-resource-management` does: KKU runs
    // a Master's in it, and only the bachelor level is scored.
    const t = textOf(render(resolveGapParams({ verdict: 'white-space' })));
    expect(t).toContain('Psychology');
    expect(t).toContain('1 postgraduate');
    expect(t).toContain('White space at bachelor level');
    // The field where KKU teaches nothing keeps the plain verdict.
    expect(t).toMatch(/Logistics[^]*?White space/);
    const logisticsRow = /<tr data-verdict="white-space"[^]*?โลจิสติกส์[^]*?<\/tr>/.exec(
      render(resolveGapParams({ verdict: 'white-space' })),
    )?.[0];
    expect(logisticsRow).toBeDefined();
    expect(logisticsRow).not.toContain('postgraduate');
  });

  it('states the bachelor-only scope where it is always visible, not only inside an expanded row', () => {
    // The collapsed table is what most readers act on; a scope caveat that
    // only appears once a row is opened is not a caveat they will see.
    expect(text).toMatch(/verdict on this page is about bachelor programmes only/i);
    expect(text).toMatch(/may still run a Master(&#x27;|&#39;|’|')s or a PhD/i);
  });

  it('explains the pipeline arrow as each programme’s own length of study, never a nominal four', () => {
    expect(text).not.toMatch(/pipeline ÷ 4/);
    expect(text).toMatch(/divided by its OWN length of study/);
    expect(text).toMatch(/nominal one for its level/i);
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
    expect(text).toMatch(/4 of 6 fields/);
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
