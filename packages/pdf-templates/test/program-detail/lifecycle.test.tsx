import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { renderLifecycleSection } from '../../src/templates/program-detail/sections/lifecycle';
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

const LIFECYCLE_BASE = {
  methodologyVersion: 'lifecycle.v1.4',
  generatedAt: '2026-08-16',
  narrative: '',
  drivers: [],
};

describe('renderLifecycleSection', () => {
  it('renders the section title and a Thai lede', () => {
    const data = parse({
      lifecycle: { ...LIFECYCLE_BASE, verdict: 'SUNSET', trajectoryScore: 34 },
    });
    const html = renderToStaticMarkup(renderLifecycleSection(data) as React.ReactElement);
    expect(html).toContain('class="section-title"');
    expect(html).toContain('Lifecycle verdict');
    const lede = /class="chart-lede"[^>]*>([^<]*)</.exec(html)?.[1] ?? '';
    expect(lede.length).toBeGreaterThan(0);
    expect(/[฀-๿]/.test(lede)).toBe(true);
  });

  it('renders the verdict as a pull-quote, not a chart or a table', () => {
    const data = parse({
      lifecycle: { ...LIFECYCLE_BASE, verdict: 'SUNSET', trajectoryScore: 34 },
    });
    const html = renderToStaticMarkup(renderLifecycleSection(data) as React.ReactElement);
    expect(html).toContain('class="pull-quote"');
    expect(html).toContain('SUNSET');
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('<table');
  });

  it('renders the trajectory score in the pull-quote attribution', () => {
    const data = parse({
      lifecycle: { ...LIFECYCLE_BASE, verdict: 'GROWTH', trajectoryScore: 78 },
    });
    const html = renderToStaticMarkup(renderLifecycleSection(data) as React.ReactElement);
    expect(html).toContain('class="attribution"');
    expect(html).toContain('78');
    expect(html).toContain('lifecycle.v1.4');
  });

  it('renders a null trajectory score as an em dash, never "0"', () => {
    const data = parse({
      lifecycle: { ...LIFECYCLE_BASE, verdict: 'UNKNOWN', trajectoryScore: null },
    });
    const html = renderToStaticMarkup(renderLifecycleSection(data) as React.ReactElement);
    const attribution = /class="attribution"[^>]*>([\s\S]*?)</.exec(html)?.[0] ?? '';
    expect(attribution).not.toContain('>0');
    expect(html).toContain('—');
  });

  it('renders each driver with its direction and a formatted contribution', () => {
    const data = parse({
      lifecycle: {
        ...LIFECYCLE_BASE,
        verdict: 'SUNSET',
        trajectoryScore: 34,
        drivers: [
          { direction: 'drag', label: 'Curriculum modernity', contribution: -10 },
          { direction: 'lifting', label: 'Overall health', contribution: 6.8 },
        ],
      },
    });
    const html = renderToStaticMarkup(renderLifecycleSection(data) as React.ReactElement);
    expect(html).toContain('Curriculum modernity');
    expect(html).toContain('-10');
    expect(html).toContain('Overall health');
    expect(html).toContain('+7');
    // Raw float never leaks even outside the pull-quote.
    expect(html).not.toMatch(/6\.8\d/);
  });

  it('renders the free-text narrative when present', () => {
    const data = parse({
      lifecycle: {
        ...LIFECYCLE_BASE,
        verdict: 'SUNSET',
        trajectoryScore: 34,
        narrative: 'Sunset risk — multiple signals declining.',
      },
    });
    const html = renderToStaticMarkup(renderLifecycleSection(data) as React.ReactElement);
    expect(html).toContain('Sunset risk — multiple signals declining.');
  });

  it('returns null — not an empty page — when the lifecycle verdict was never computed', () => {
    const data = parse({ lifecycle: null });
    expect(renderLifecycleSection(data)).toBeNull();
  });

  it('renders the explained empty note when there are no scored drivers', () => {
    const data = parse({
      lifecycle: { ...LIFECYCLE_BASE, verdict: 'STABLE', trajectoryScore: 55, drivers: [] },
    });
    const html = renderToStaticMarkup(renderLifecycleSection(data) as React.ReactElement);
    expect(html).toContain('No scored drivers');
  });

  it('renders from the real captured fixture (KKU-SEQ-0065) without throwing', () => {
    const data = ProgramDetailDataSchema.parse(FIXTURE);
    expect(data.lifecycle).not.toBeNull();
    expect(() => renderToStaticMarkup(renderLifecycleSection(data) as React.ReactElement)).not.toThrow();
    const html = renderToStaticMarkup(renderLifecycleSection(data) as React.ReactElement);
    expect(html).toContain('SUNSET');
  });
});
