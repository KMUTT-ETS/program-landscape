import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { renderFinancialsSection } from '../../src/templates/program-detail/sections/financials';
import {
  ProgramDetailDataSchema,
  type ProgramDetailData,
} from '../../src/templates/program-detail/schema';
import FIXTURE from './fixture.json';

const MINIMAL_BASE = {
  programCode: 'KKU-SEQ-9999',
  nameTh: 'หลักสูตรทดสอบวิศวกรรมทดสอบ',
  nameEn: 'Test Program in Testing Engineering',
  level: 'Bachelor',
  status: 'ACTIVE',
  facultyTh: 'คณะทดสอบ',
  facultyEn: 'Faculty of Testing',
  dateLabel: '2026-01-01',
  generatedAtLabel: 'January 1, 2026 at 9:00 AM',
  methodologyVersion: 'health-score.v3.8',
};

function parse(overrides: Record<string, unknown> = {}): ProgramDetailData {
  return ProgramDetailDataSchema.parse({ ...MINIMAL_BASE, ...overrides });
}

const FINANCIALS_BASE = {
  methodologyVersion: 'cost-allocation.v1',
  headlineFiscalYear: 2025,
  partialCurrentYearNote: '',
  kpis: [],
  sensitivity: null,
  trend: [],
};

const REAL_WATERFALL = [
  { step: 'Tuition revenue', kind: 'positive', value: 11599000, isTotal: false },
  { step: 'Direct program cost', kind: 'negative', value: -12500000, isTotal: false },
  { step: 'Net contribution', kind: 'total', value: -901000, isTotal: true },
];

describe('renderFinancialsSection', () => {
  it('renders the section title and a Thai lede', () => {
    const data = parse({ financials: { ...FINANCIALS_BASE, waterfall: REAL_WATERFALL } });
    const html = renderToStaticMarkup(renderFinancialsSection(data) as React.ReactElement);
    expect(html).toContain('class="section-title"');
    expect(html).toContain('Financials');
    const lede = /class="chart-lede"[^>]*>([^<]*)</.exec(html)?.[1] ?? '';
    expect(lede.length).toBeGreaterThan(0);
    expect(/[฀-๿]/.test(lede)).toBe(true);
  });

  it('renders one bar per waterfall step, drawing the total bar from zero', () => {
    const data = parse({ financials: { ...FINANCIALS_BASE, waterfall: REAL_WATERFALL } });
    const html = renderToStaticMarkup(renderFinancialsSection(data) as React.ReactElement);
    expect(html.match(/class="waterfall-bar/g) ?? []).toHaveLength(3);
    expect(html).toContain('Tuition revenue');
    expect(html).toContain('Direct program cost');
    expect(html).toContain('Net contribution');
    expect(html).toContain('data-kind="total"');
  });

  // A bar the cost-allocation methodology never computed is EXCLUDED, not
  // coerced to a zero-delta bar — the same non-substitution rule as every
  // other section's null handling.
  it('excludes an unmeasured bar rather than drawing it at zero', () => {
    const data = parse({
      financials: {
        ...FINANCIALS_BASE,
        waterfall: [
          ...REAL_WATERFALL,
          { step: 'Government subsidy', kind: 'positive', value: null, isTotal: false },
        ],
      },
    });
    const html = renderToStaticMarkup(renderFinancialsSection(data) as React.ReactElement);
    expect(html.match(/class="waterfall-bar/g) ?? []).toHaveLength(3);
    expect(html).not.toContain('Government subsidy');
  });

  it('formats bar magnitudes, never a raw full-precision float', () => {
    const data = parse({
      financials: {
        ...FINANCIALS_BASE,
        waterfall: [
          { step: 'Tuition revenue', kind: 'positive', value: 901234.567, isTotal: false },
          { step: 'Net contribution', kind: 'total', value: -901234.567, isTotal: true },
        ],
      },
    });
    const html = renderToStaticMarkup(renderFinancialsSection(data) as React.ReactElement);
    expect(html).not.toMatch(/901234\.567/);
    expect(html).toContain('901K');
  });

  it('returns null — not a placeholder chart — when financials was never computed', () => {
    const data = parse({ financials: null });
    expect(renderFinancialsSection(data)).toBeNull();
  });

  it('renders the explained empty block, naming the method, when there is no waterfall', () => {
    const data = parse({
      financials: { ...FINANCIALS_BASE, methodologyVersion: 'cost-allocation.v1', waterfall: [] },
    });
    const html = renderToStaticMarkup(renderFinancialsSection(data) as React.ReactElement);
    expect(html).toContain('class="section-title"');
    expect(html).not.toContain('class="waterfall-bar');
    expect(html).toContain('class="chart-empty"');
    expect(html).toContain('cost-allocation.v1');
  });

  it('carries real provenance — the methodology version and the report date', () => {
    const data = parse({
      dateLabel: '12 Aug 2026',
      financials: { ...FINANCIALS_BASE, methodologyVersion: 'cost-allocation.v2', waterfall: REAL_WATERFALL },
    });
    const html = renderToStaticMarkup(renderFinancialsSection(data) as React.ReactElement);
    expect(html).toContain('cost-allocation.v2');
    expect(html).toContain('12 Aug 2026');
  });

  // Real, honest caveat text — must survive to the page, not be silently
  // dropped just because it isn't a chartable number.
  it('surfaces the partial-current-year caveat when present', () => {
    const data = parse({
      financials: {
        ...FINANCIALS_BASE,
        waterfall: REAL_WATERFALL,
        partialCurrentYearNote: 'FY 2026 tuition is partial — only 2 of 3 terms invoiced.',
      },
    });
    const html = renderToStaticMarkup(renderFinancialsSection(data) as React.ReactElement);
    expect(html).toContain('FY 2026 tuition is partial');
  });

  // The real fixture (KKU-SEQ-0065) has no financials computed yet — the
  // exact "return null, not a placeholder" case this section must get right.
  it('renders from the real captured fixture (KKU-SEQ-0065) without throwing', () => {
    const data = ProgramDetailDataSchema.parse(FIXTURE);
    expect(data.financials).toBeNull();
    expect(renderFinancialsSection(data)).toBeNull();
  });
});
