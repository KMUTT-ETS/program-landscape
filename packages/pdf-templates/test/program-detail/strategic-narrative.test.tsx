import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { renderStrategicNarrativeSection } from '../../src/templates/program-detail/sections/strategic-narrative';
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

describe('renderStrategicNarrativeSection', () => {
  it('renders the section title and a Thai lede', () => {
    const data = parse({
      strategicNarrative: {
        contentMarkdown: '## Executive summary\nThe program is stable.',
        methodVersion: 'program-strategic-narrative.v1',
        confidencePct: 95,
        generatedAt: '2026-05-03',
      },
    });
    const html = renderToStaticMarkup(renderStrategicNarrativeSection(data) as React.ReactElement);
    expect(html).toContain('class="section-title"');
    expect(html).toContain('Strategic narrative');
    const lede = /class="chart-lede"[^>]*>([^<]*)</.exec(html)?.[1] ?? '';
    expect(lede.length).toBeGreaterThan(0);
    expect(/[฀-๿]/.test(lede)).toBe(true);
  });

  it('renders inside a two-column magazine layout, not a chart', () => {
    const data = parse({
      strategicNarrative: {
        contentMarkdown: '## Executive summary\nThe program is stable.',
        methodVersion: 'program-strategic-narrative.v1',
        confidencePct: 95,
        generatedAt: '2026-05-03',
      },
    });
    const html = renderToStaticMarkup(renderStrategicNarrativeSection(data) as React.ReactElement);
    expect(html).toContain('class="magazine-columns"');
    expect(html).not.toContain('<svg');
  });

  it('converts headings, bold text and lists from the markdown-ish payload', () => {
    const data = parse({
      strategicNarrative: {
        contentMarkdown:
          '## Critical risks\n- The curriculum is **OLD_SCHOOL**, correlating with a low outcomes score.\n\n1. Overhaul the curriculum within **12 months**.',
        methodVersion: 'program-strategic-narrative.v1',
        confidencePct: 95,
        generatedAt: '2026-05-03',
      },
    });
    const html = renderToStaticMarkup(renderStrategicNarrativeSection(data) as React.ReactElement);
    expect(html).toContain('<h2>Critical risks</h2>');
    expect(html).toContain('<ul><li>');
    expect(html).toContain('<strong>OLD_SCHOOL</strong>');
    expect(html).toContain('<ol><li>');
    expect(html).toContain('<strong>12 months</strong>');
  });

  // Regression: the real AI output puts a heading and its very next
  // paragraph on ADJACENT lines with no blank line between them (see the
  // real fixture below). A block-oriented parser that treats "block starts
  // with #" as "the whole block is the heading" would silently drop the
  // paragraph — this must not happen.
  it('does not drop the paragraph immediately following a heading with no blank line', () => {
    const data = parse({
      strategicNarrative: {
        contentMarkdown: '## Executive summary\nThe program faces a SUNSET verdict driven by curriculum obsolescence.',
        methodVersion: 'program-strategic-narrative.v1',
        confidencePct: 95,
        generatedAt: '2026-05-03',
      },
    });
    const html = renderToStaticMarkup(renderStrategicNarrativeSection(data) as React.ReactElement);
    expect(html).toContain('<h2>Executive summary</h2>');
    expect(html).toContain('<p>The program faces a SUNSET verdict driven by curriculum obsolescence.</p>');
  });

  // The payload is not reliably Thai despite the CLAUDE.md Thai-primary
  // convention — the real fixture carries English prose. This component must
  // render whatever language it is given verbatim, not assume or translate.
  it('renders English prose verbatim without attempting translation', () => {
    const data = parse({
      strategicNarrative: {
        contentMarkdown: 'The program faces a SUNSET verdict with a trajectory score of 34/100.',
        methodVersion: 'program-strategic-narrative.v1',
        confidencePct: 95,
        generatedAt: '2026-05-03',
      },
    });
    const html = renderToStaticMarkup(renderStrategicNarrativeSection(data) as React.ReactElement);
    expect(html).toContain('SUNSET verdict with a trajectory score of 34/100');
  });

  it('escapes raw HTML in the payload rather than injecting it', () => {
    const data = parse({
      strategicNarrative: {
        contentMarkdown: 'See <script>alert(1)</script> for details.',
        methodVersion: 'program-strategic-narrative.v1',
        confidencePct: 95,
        generatedAt: '2026-05-03',
      },
    });
    const html = renderToStaticMarkup(renderStrategicNarrativeSection(data) as React.ReactElement);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('returns null — not an empty page — when the narrative was never generated', () => {
    const data = parse({ strategicNarrative: null });
    expect(renderStrategicNarrativeSection(data)).toBeNull();
  });

  it('carries real provenance — the method version, confidence and generation date', () => {
    const data = parse({
      strategicNarrative: {
        contentMarkdown: 'Stable outlook.',
        methodVersion: 'program-strategic-narrative.v2',
        confidencePct: 87,
        generatedAt: '2026-06-01',
      },
    });
    const html = renderToStaticMarkup(renderStrategicNarrativeSection(data) as React.ReactElement);
    expect(html).toContain('program-strategic-narrative.v2');
    expect(html).toContain('87%');
    expect(html).toContain('2026-06-01');
  });

  it('renders a null confidence as an em dash, never "0%"', () => {
    const data = parse({
      strategicNarrative: {
        contentMarkdown: 'Stable outlook.',
        methodVersion: 'program-strategic-narrative.v1',
        confidencePct: null,
        generatedAt: '2026-06-01',
      },
    });
    const html = renderToStaticMarkup(renderStrategicNarrativeSection(data) as React.ReactElement);
    expect(html).not.toContain('0%');
    expect(html).toContain('—');
  });

  it('renders from the real captured fixture (KKU-SEQ-0065) without throwing', () => {
    const data = ProgramDetailDataSchema.parse(FIXTURE);
    expect(data.strategicNarrative).not.toBeNull();
    expect(() =>
      renderToStaticMarkup(renderStrategicNarrativeSection(data) as React.ReactElement),
    ).not.toThrow();
    const html = renderToStaticMarkup(renderStrategicNarrativeSection(data) as React.ReactElement);
    expect(html).toContain('Executive summary');
  });
});
