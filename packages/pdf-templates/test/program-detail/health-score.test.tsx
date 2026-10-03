import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { renderHealthScoreSection } from '../../src/templates/program-detail/sections/health-score';
import {
  ProgramDetailDataSchema,
  type ProgramDetailData,
} from '../../src/templates/program-detail/schema';
import FIXTURE from './fixture.json';

// Same minimal-required-fields base as cover.test.tsx — every other field
// falls back to its schema default ([], null, ''), which is exactly the
// "no data yet" shape the null-section test below needs.
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

describe('renderHealthScoreSection', () => {
  it('renders the section title and a Thai lede', () => {
    const data = parse({
      healthMethodologyVersion: 'health-score.v3.8',
      healthDimensions: [
        { dimension: 'Attractiveness', score: 90, dataCompleteness: 50, topDriverLabel: null, topDriverValue: null },
        { dimension: 'Capability', score: 61, dataCompleteness: 75, topDriverLabel: null, topDriverValue: null },
        { dimension: 'Outcomes', score: 67, dataCompleteness: 83, topDriverLabel: null, topDriverValue: null },
      ],
    });
    const html = renderToStaticMarkup(renderHealthScoreSection(data) as React.ReactElement);
    expect(html).toContain('class="section-opener"');
    expect(html).toContain('class="section-title"');
    expect(html).toContain('Health score');
    // Thai lede — at least one Thai character present inside chart-lede.
    const lede = /class="chart-lede"[^>]*>([^<]*)</.exec(html)?.[1] ?? '';
    expect(lede.length).toBeGreaterThan(0);
    expect(/[฀-๿]/.test(lede)).toBe(true);
  });

  it('renders a Radar with a vertex for each scored dimension', () => {
    const data = parse({
      healthDimensions: [
        { dimension: 'Attractiveness', score: 90, dataCompleteness: 50, topDriverLabel: null, topDriverValue: null },
        { dimension: 'Capability', score: 61, dataCompleteness: 75, topDriverLabel: null, topDriverValue: null },
        { dimension: 'Outcomes', score: 67, dataCompleteness: 83, topDriverLabel: null, topDriverValue: null },
      ],
    });
    const html = renderToStaticMarkup(renderHealthScoreSection(data) as React.ReactElement);
    expect(html.match(/class="radar-vertex"/g) ?? []).toHaveLength(3);
  });

  // A dimension the methodology deliberately excluded from the average
  // (null score) must render as Radar's hollow "no data" marker, never a
  // vertex dipped to the centre (which would read as "scores zero here").
  it('renders a null dimension as a hollow no-data marker, not a vertex at zero', () => {
    const data = parse({
      healthDimensions: [
        { dimension: 'Attractiveness', score: 90, dataCompleteness: 50, topDriverLabel: null, topDriverValue: null },
        { dimension: 'Financial', score: null, dataCompleteness: 0, topDriverLabel: null, topDriverValue: null },
        { dimension: 'Capability', score: 61, dataCompleteness: 75, topDriverLabel: null, topDriverValue: null },
      ],
    });
    const html = renderToStaticMarkup(renderHealthScoreSection(data) as React.ReactElement);
    expect(html.match(/class="radar-vertex"/g) ?? []).toHaveLength(2);
    expect(html.match(/class="radar-null-marker"/g) ?? []).toHaveLength(1);
  });

  it('carries real provenance — the health methodology version and the report date, never a placeholder', () => {
    const data = parse({
      healthMethodologyVersion: 'health-score.v3.8',
      dateLabel: '12 Aug 2026',
      healthDimensions: [
        { dimension: 'Attractiveness', score: 90, dataCompleteness: 50, topDriverLabel: null, topDriverValue: null },
        { dimension: 'Capability', score: 61, dataCompleteness: 75, topDriverLabel: null, topDriverValue: null },
        { dimension: 'Outcomes', score: 67, dataCompleteness: 83, topDriverLabel: null, topDriverValue: null },
      ],
    });
    const html = renderToStaticMarkup(renderHealthScoreSection(data) as React.ReactElement);
    expect(html).toContain('health-score.v3.8');
    expect(html).toContain('12 Aug 2026');
  });

  // "Data is partially present" here would mean fewer than 3 axes with
  // real values — but that is exactly Radar's own <3-axes empty state, so
  // there's no separate case to construct; the real absence case for this
  // section is the array being empty outright (see the next test).
  it('returns null — not a placeholder chart — when there are no health dimensions at all', () => {
    const data = parse({ healthDimensions: [] });
    expect(renderHealthScoreSection(data)).toBeNull();
  });

  it('renders from the real captured fixture (KKU-SEQ-0065) without throwing, mixing a null Financial dimension with real scores', () => {
    const data = ProgramDetailDataSchema.parse(FIXTURE);
    expect(() => renderToStaticMarkup(renderHealthScoreSection(data) as React.ReactElement)).not.toThrow();
    const html = renderToStaticMarkup(renderHealthScoreSection(data) as React.ReactElement);
    expect(html).toContain('Attractiveness');
    expect(html).toContain('Financial');
    expect(html.match(/class="radar-null-marker"/g) ?? []).toHaveLength(1);
  });

  // Benchmarks: the radar plots one series, so without these a reader
  // cannot tell a 55 that leads its faculty from a 55 that trails it.
  it('renders the faculty and university comparison with its sample sizes', () => {
    const data = ProgramDetailDataSchema.parse({
      ...MINIMAL_BASE,
      healthDimensions: [
        { dimension: 'Attractiveness', score: 55, dataCompleteness: 100, topDriverLabel: null, topDriverValue: null, facultyMean: 61, universityMean: 58 },
        { dimension: 'Financial', score: 40, dataCompleteness: 80, topDriverLabel: null, topDriverValue: null, facultyMean: null, universityMean: 52 },
      ],
      healthBenchmark: {
        facultyNameTh: 'คณะทดสอบ',
        facultySampleSize: 12,
        universitySampleSize: 297,
        methodologyVersion: 'health-score.v3.8',
      },
    });
    const html = renderToStaticMarkup(renderHealthScoreSection(data)!);
    expect(html).toContain('Faculty mean');
    expect(html).toContain('University mean');
    expect(html).toContain('61');
    expect(html).toContain('297');
    // Sample size is stated, not just the mean.
    expect(html).toContain('12');
  });

  it('omits the comparison table entirely when no benchmark resolved', () => {
    const data = ProgramDetailDataSchema.parse({
      ...MINIMAL_BASE,
      healthDimensions: [
        { dimension: 'Attractiveness', score: 55, dataCompleteness: 100, topDriverLabel: null, topDriverValue: null },
      ],
    });
    const html = renderToStaticMarkup(renderHealthScoreSection(data)!);
    // Five rows of dashes would just restate the radar.
    expect(html).not.toContain('Faculty mean');
  });

  it('says why there is no faculty mean rather than printing a bare dash', () => {
    const data = ProgramDetailDataSchema.parse({
      ...MINIMAL_BASE,
      healthDimensions: [
        { dimension: 'Attractiveness', score: 55, dataCompleteness: 100, topDriverLabel: null, topDriverValue: null, facultyMean: null, universityMean: 58 },
      ],
      healthBenchmark: {
        facultyNameTh: null,
        facultySampleSize: null,
        universitySampleSize: 297,
        methodologyVersion: 'health-score.v3.8',
      },
    });
    const html = renderToStaticMarkup(renderHealthScoreSection(data)!);
    expect(html).toContain('No faculty mean');
  });
});

describe('renderHealthScoreSection — external-grant award', () => {
  const dims = (award: unknown) => [
    { dimension: 'Attractiveness', score: 70, dataCompleteness: 80, topDriverLabel: null, topDriverValue: null },
    { dimension: 'Financial', score: 67, dataCompleteness: 75, topDriverLabel: null, topDriverValue: null, award },
  ];

  it('renders the award line and the lower-bound caveat for Financial', () => {
    const data = parse({
      healthDimensions: dims({
        points: 6.2,
        baseScore: 61.4,
        line: 'External-grant award: +6.2 (฿1.04 M per teaching staff per year, FY 2567–2569) · base 61.4 → 67.6',
        caveat: 'Lower bound: x',
      }),
    });
    const html = renderToStaticMarkup(renderHealthScoreSection(data) as React.ReactElement);
    expect(html).toContain('External-grant award: +6.2');
    expect(html).toContain('Lower bound: x');
  });

  it('defaults the award to null so older payloads still parse and render nothing extra', () => {
    const data = parse({ healthDimensions: dims(undefined) });
    expect(data.healthDimensions[1].award).toBeNull();
    const html = renderToStaticMarkup(renderHealthScoreSection(data) as React.ReactElement);
    expect(html).not.toContain('External-grant award');
  });
});
