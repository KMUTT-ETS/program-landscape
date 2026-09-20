import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProvenanceProvider, TooltipProvider } from '@kku/ui';
import type { ApiMeta } from '@kku/shared';
import { GapMapSections } from '../app/gap-analysis/sections';
import { resolveGapParams, gapHref, type GapMapT, type GapRowT } from '../app/gap-analysis/types';

// The demand-basis control (Task 13): a three-way, URL-shareable filter that
// picks which market forms the demand denominator, plus the per-row private
// and public shares shown once a row is expanded, plus the government
// evidence block those shares imply exists somewhere to look at.
//
// This package's vitest environment is `node` (see apps/web/vitest.config.ts)
// — no jsdom, no @testing-library/react — so there is no real DOM `container`
// to read `.textContent` off. `textOf` strips tags from the
// `renderToStaticMarkup` output the same way gap-map-render.test.tsx already
// does for the same class of assertion; it is the DOM-less equivalent of
// `container.textContent` this environment can actually produce.

const meta: ApiMeta = {
  freshnessDate: '2026-09-20T00:00:00Z',
  sources: [{ id: 'jobthai', name: 'JobThai' }, { id: 'job-108', name: 'Job-108' }],
  methodologyVersion: 'gap-map.v1',
  caveats: ['national adverts'],
};

const baseRow: GapRowT = {
  slug: 'electrical-engineering',
  nameTh: 'วิศวกรรมไฟฟ้า',
  nameEn: 'Electrical engineering',
  reviewStatus: 'APPROVED',
  postings: 545,
  demandShare: 0.12,
  privateDemandShare: 0.1,
  publicDemandShare: 0.2,
  privatePostings: 500,
  publicPostings: 45,
  supplyShare: 0.08,
  ratio: 0.67,
  verdict: 'under-served',
  gradsPerYear: 80,
  pipeline: 320,
  pipelineArrow: 'flat',
  programmeCount: 1,
  programmesWithSupply: 1,
  postgraduateProgrammes: 0,
  signalCount: 0,
  kkuTotal: null,
  provinces: [],
  occupations: [
    {
      occupationId: 'o1',
      code: 'jobthai:x',
      category: 'Cat',
      subcategory: 'Occ A',
      postings: 300,
      // A real cuid shape among the linked programmes — the regression this
      // suite exists to keep caught, carried over from gap-map-render's
      // fixture rather than invented fresh.
      linkedProgrammes: [
        { programId: 'p1', code: 'KKU-SEQ-0001', nameTh: 'โปรแกรม', nameEn: 'Programme', inField: true },
        {
          programId: 'cmon1wwxs000dzh902umgd22e',
          code: 'KKU-SEQ-0044',
          nameTh: 'วิศวกรรมเครื่องกล',
          nameEn: 'Mechanical Engineering',
          inField: false,
        },
      ],
      linkedInField: 1,
      linkedOutsideField: 1,
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
      gradsPerYear: 80,
      supplySource: 'alumni',
      supplyCohorts: 5,
      supplyYear: null,
      durationYears: 4,
      pipeline: 320,
      healthScore: 70,
      scored: true,
      reviewStatus: 'APPROVED',
    },
  ],
  facultyIds: ['f1'],
  globalSignal: { skills: [], scope: null },
  trendSignals: [],
};

/** A field with no government evidence at all — the negative case for the
 *  government block. */
const noPublicRow: GapRowT = {
  ...baseRow,
  slug: 'geology',
  nameTh: 'ธรณีวิทยา',
  nameEn: 'Geology',
  publicDemandShare: 0,
  publicPostings: 0,
  occupations: [],
  programmes: [],
  facultyIds: [],
};

function buildMap(rows: GapRowT[]): GapMapT {
  return {
    methodologyVersion: 'gap-map.v1',
    computedAt: '2026-09-20T00:00:00Z',
    scope: { level: 'university', id: null, label: null },
    thresholds: { under: 0.5, over: 2 },
    rows,
    verdictCounts: {
      'white-space': 0,
      'under-served': 1,
      served: 0,
      'over-served': 0,
      'supply-unknown': 0,
      'too-few-postings': 0,
    },
    facultyStrip: [],
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
      supplyShareSum: 1,
      multiFieldProgrammes: 9,
      fieldGraduatesTotal: 12_000,
      scoredProgrammes: 99,
      scoredWithSupply: 83,
      supplyFromProxy: 14,
    },
    taxonomy: { approved: 2, proposed: 0 },
    freshness: { postingsAsOf: '2026-09-18T00:00:00Z', taxonomyAsOf: '2026-09-15T00:00:00Z' },
  };
}

function render(params = resolveGapParams({}), rows = [baseRow, noPublicRow]): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <ProvenanceProvider>
        <GapMapSections data={{ params, map: buildMap(rows), meta }} />
      </ProvenanceProvider>
    </TooltipProvider>,
  );
}

const textOf = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const CUID = /\bc[a-z0-9]{24}\b/;

describe('demand basis control', () => {
  it('offers all three bases and marks the one from the URL as active', () => {
    const html = render(resolveGapParams({ basis: 'private' }));
    const text = textOf(html);
    expect(text).toContain('Demand counted from');
    expect(text).toContain('Both markets');
    expect(text).toContain('Private only');
    expect(text).toContain('Government only');
    // The active chip carries aria-pressed="true"; find the "Private only"
    // chip specifically rather than asserting the attribute exists anywhere.
    const chip = /<a[^>]*>\s*Private only\s*<\/a>/.exec(html)?.[0] ?? '';
    expect(chip).toContain('aria-pressed="true"');
  });

  it('round-trips through the URL and omits the default basis', () => {
    const withBasis = resolveGapParams({ basis: 'public' });
    expect(withBasis.basis).toBe('public');
    expect(gapHref(withBasis)).toContain('basis=public');

    const defaultBasis = resolveGapParams({});
    expect(defaultBasis.basis).toBe('all');
    expect(gapHref(defaultBasis)).not.toContain('basis=');
  });

  it('falls back to the default basis on an unrecognised value, rather than 500ing the page', () => {
    expect(resolveGapParams({ basis: 'government' }).basis).toBe('all');
  });

  it('states what the two share columns are a percentage of, always visible under the table', () => {
    const text = textOf(render());
    // React escapes an apostrophe in rendered text to `&#x27;`, so these
    // assertions stop short of the apostrophes in "field's" / "KKU's"
    // rather than embed one literally — matching the whole sentence around
    // them still proves the same wording is there.
    expect(text).toContain('Demand share is each field');
    expect(text).toContain('s share of all adverts naming a field of study, on the selected basis.');
    expect(text).toContain('KKU share is that field');
    expect(text).toContain('s share of KKU');
    expect(text).toContain('s bachelor graduates per year.');
  });
});

describe('both demand shares in the expanded row', () => {
  const opened = resolveGapParams({ field: 'electrical-engineering' });

  it('renders both shares, each with its own percentage', () => {
    const text = textOf(render(opened));
    expect(text).toContain('10.0 %'); // privateDemandShare
    expect(text).toContain('20.0 %'); // publicDemandShare
  });

  it('says what each share is a percentage of', () => {
    const text = textOf(render(opened));
    // No leading "%" here: the figure right above already carries its own
    // "%" — a live check against the dev server caught this rendering as
    // "11.0 % % of all private-sector adverts…" when the sentence below the
    // number also opened with one.
    expect(text).toMatch(/of all private-sector adverts naming a field of study/);
    expect(text).toMatch(/of all government postings naming a field of study, in the counting window/);
    expect(text).not.toMatch(/%\s*%/);
  });

  it('shows each share’s own posting count, not folded into the percentage', () => {
    const text = textOf(render(opened));
    expect(text).toContain('500');
    expect(text).toContain('postings counted');
    expect(text).toContain('45');
  });

  it('emphasises the share matching the active basis and keeps the other present', () => {
    const privateOnly = textOf(render(resolveGapParams({ field: 'electrical-engineering', basis: 'private' })));
    // Both figures are still on the page under a single-market basis — "de-
    // emphasised", per the spec, never hidden.
    expect(privateOnly).toContain('10.0 %');
    expect(privateOnly).toContain('20.0 %');
    const html = render(resolveGapParams({ field: 'electrical-engineering', basis: 'private' }));
    // The public share's cell carries the de-emphasis styling; the private
    // share's does not.
    expect(html).toMatch(/opacity-70[^]*?20\.0 %/);
  });

  it('renders no cuid-shaped token anywhere a reader can see', () => {
    for (const params of [resolveGapParams({}), opened, resolveGapParams({ basis: 'public' })]) {
      expect(textOf(render(params))).not.toMatch(CUID);
    }
  });
});

describe('government evidence block', () => {
  it('renders government positions with a count when publicPostings > 0', () => {
    const text = textOf(render(resolveGapParams({ field: 'electrical-engineering' })));
    expect(text).toContain('Government positions');
    expect(text).toMatch(/45 government postings name this field/);
    expect(text).toContain('job-108.com');
  });

  it('is honest that per-position detail is not available, rather than inventing rows', () => {
    const text = textOf(render(resolveGapParams({ field: 'electrical-engineering' })));
    expect(text).toMatch(/agency, position title, seats and closing date.*is not yet carried into this view/);
  });

  it('collapses with a not-counted note when the active basis is private', () => {
    const html = render(resolveGapParams({ field: 'electrical-engineering', basis: 'private' }));
    expect(html).toContain('<details>');
    const text = textOf(html);
    expect(text).toMatch(/Not counted in the current basis \(private sector only\)/);
  });

  it('does not render when publicPostings is 0', () => {
    const text = textOf(render(resolveGapParams({ field: 'geology' })));
    expect(text).not.toContain('Government positions');
  });

  it('carries the job-108 text-chip mark, not an image', () => {
    const html = render(resolveGapParams({ field: 'electrical-engineering' }));
    expect(html).toContain('Job-108');
    // No brand asset exists for job-108 — see data-source-mark.tsx — so its
    // mark must never render as an <img>.
    const govSection = /Government positions[^]*?<\/section>/.exec(html)?.[0] ?? '';
    expect(govSection).not.toContain('<img');
  });
});
