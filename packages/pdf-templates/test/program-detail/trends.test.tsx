import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { renderTrendsSection } from '../../src/templates/program-detail/sections/trends';
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

const SIGNAL = {
  title: 'MHESI launches THAILAND² national skills initiative',
  type: 'Policy / regulation',
  targeted: 'Sector-wide',
  impactScorePct: 82,
  impactBucket: 'High',
  recommendation: 'Take action',
  detected: '2026-08-06',
  rationale: 'Regulatory change at this impact level rarely stays sector-wide.',
  summary: 'MHESI has partnered with five ministries to launch a national upskilling programme.',
};

describe('renderTrendsSection', () => {
  it('renders the section title and a Thai lede', () => {
    const data = parse({ trends: [SIGNAL] });
    const html = renderToStaticMarkup(renderTrendsSection(data) as React.ReactElement);
    expect(html).toContain('class="section-title"');
    expect(html).toContain('Trend exposure');
    const lede = /class="chart-lede"[^>]*>([^<]*)</.exec(html)?.[1] ?? '';
    expect(lede.length).toBeGreaterThan(0);
    expect(/[฀-๿]/.test(lede)).toBe(true);
  });

  it('renders one table row per signal with the real title, type and detection date', () => {
    const data = parse({
      trends: [
        SIGNAL,
        { ...SIGNAL, title: 'OECD future-of-skills framework', type: 'Research', impactScorePct: 65, impactBucket: 'Moderate', recommendation: 'Monitor', detected: '2026-08-01' },
      ],
    });
    const html = renderToStaticMarkup(renderTrendsSection(data) as React.ReactElement);
    expect(html).toContain('<table');
    expect(html).toContain('MHESI launches THAILAND² national skills initiative');
    expect(html).toContain('OECD future-of-skills framework');
    expect(html).toContain('2026-08-06');
    expect(html).toContain('2026-08-01');
    expect((html.match(/<tr>/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('renders a formatted impact percentage, never a raw float', () => {
    const data = parse({ trends: [{ ...SIGNAL, impactScorePct: 81.6666666 }] });
    const html = renderToStaticMarkup(renderTrendsSection(data) as React.ReactElement);
    expect(html).not.toMatch(/81\.6666666/);
    expect(html).toContain('82%');
  });

  it('never drops the rationale — the "why this matters" content', () => {
    const data = parse({ trends: [SIGNAL] });
    const html = renderToStaticMarkup(renderTrendsSection(data) as React.ReactElement);
    expect(html).toContain('Regulatory change at this impact level rarely stays sector-wide.');
  });

  // No wrapping nullable object exists for `trends` at the schema level —
  // it is a bare array defaulting to []. Zero signals is a legitimate real
  // state (the monitor pipeline can genuinely find nothing new this cycle),
  // not necessarily "never computed" — so this always renders the section,
  // with an explained empty note rather than returning null.
  it('renders the explained empty block, not null, when no signals were detected', () => {
    const data = parse({ trends: [] });
    const rendered = renderTrendsSection(data);
    expect(rendered).not.toBeNull();
    const html = renderToStaticMarkup(rendered as React.ReactElement);
    expect(html).toContain('class="section-title"');
    expect(html).not.toContain('<table');
  });

  it('carries real provenance and the report date', () => {
    const data = parse({ dateLabel: '12 Aug 2026', trends: [SIGNAL] });
    const html = renderToStaticMarkup(renderTrendsSection(data) as React.ReactElement);
    expect(html).toContain('12 Aug 2026');
  });

  it('renders from the real captured fixture (KKU-SEQ-0065) without throwing', () => {
    const data = ProgramDetailDataSchema.parse(FIXTURE);
    expect(data.trends.length).toBeGreaterThan(0);
    expect(() => renderToStaticMarkup(renderTrendsSection(data) as React.ReactElement)).not.toThrow();
    const html = renderToStaticMarkup(renderTrendsSection(data) as React.ReactElement);
    expect(html).toContain('<table');
  });
});
