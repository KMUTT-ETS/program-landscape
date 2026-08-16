import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { renderAiReadinessSection } from '../../src/templates/program-detail/sections/ai-readiness';
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

const AI_READINESS_BASE = {
  overallScore: 35,
  verdict: 'Low AI readiness',
  summary: 'Strategic awareness of AI exists, but implementation is limited.',
  methodologyVersion: 'program-ai-readiness.v2',
};

describe('renderAiReadinessSection', () => {
  it('renders the section title and a Thai lede', () => {
    const data = parse({
      aiReadiness: {
        ...AI_READINESS_BASE,
        subScores: [{ metric: 'Curriculum integration', value: '40', notes: '' }],
        subScoreValues: [{ label: 'Curriculum integration', score: 40 }],
      },
    });
    const html = renderToStaticMarkup(renderAiReadinessSection(data) as React.ReactElement);
    expect(html).toContain('class="section-title"');
    expect(html).toContain('AI readiness');
    const lede = /class="chart-lede"[^>]*>([^<]*)</.exec(html)?.[1] ?? '';
    expect(lede.length).toBeGreaterThan(0);
    expect(/[฀-๿]/.test(lede)).toBe(true);
  });

  it('renders a bar for every scored sub-score', () => {
    const data = parse({
      aiReadiness: {
        ...AI_READINESS_BASE,
        subScores: [],
        subScoreValues: [
          { label: 'Curriculum integration', score: 0 },
          { label: 'Skill resilience', score: 83 },
        ],
      },
    });
    const html = renderToStaticMarkup(renderAiReadinessSection(data) as React.ReactElement);
    expect(html.match(/class="bar"/g) ?? []).toHaveLength(2);
  });

  // BarRow.value is a plain `number` (not nullable) — the primitive has no
  // way to draw a null sub-score. A null row must be excluded from the
  // chart, never coerced to 0 (a real zero and "not measured yet" are
  // different facts), and the exclusion must stay visible in the body
  // text rather than silently vanishing.
  it('excludes a null sub-score from the bars and names it in a footnote instead of dropping it silently', () => {
    const data = parse({
      aiReadiness: {
        ...AI_READINESS_BASE,
        subScores: [
          { metric: 'Curriculum integration', value: '40', notes: '' },
          { metric: 'Pedagogical readiness', value: 'no data', notes: 'data not yet collected' },
        ],
        subScoreValues: [
          { label: 'Curriculum integration', score: 40 },
          { label: 'Pedagogical readiness', score: null },
        ],
      },
    });
    const html = renderToStaticMarkup(renderAiReadinessSection(data) as React.ReactElement);
    expect(html.match(/class="bar"/g) ?? []).toHaveLength(1);
    expect(html).toContain('Pedagogical readiness');
    expect(html).toContain('data not yet collected');
  });

  it('returns null — not a placeholder chart — when aiReadiness itself was never computed', () => {
    const data = parse({ aiReadiness: null });
    expect(renderAiReadinessSection(data)).toBeNull();
  });

  it('renders the explained empty block, not a zero-valued chart, when every sub-score is null', () => {
    const data = parse({
      aiReadiness: {
        ...AI_READINESS_BASE,
        subScores: [{ metric: 'Curriculum integration', value: 'no data', notes: 'data not yet collected' }],
        subScoreValues: [{ label: 'Curriculum integration', score: null }],
      },
    });
    const html = renderToStaticMarkup(renderAiReadinessSection(data) as React.ReactElement);
    expect(html).not.toContain('class="bar"');
    expect(html).toContain('class="chart-empty"');
    expect(html).toMatch(/no.*sub-score/i);
  });

  it('carries real provenance — the AI-readiness methodology version and the report date', () => {
    const data = parse({
      dateLabel: '12 Aug 2026',
      aiReadiness: {
        ...AI_READINESS_BASE,
        methodologyVersion: 'program-ai-readiness.v2',
        subScores: [],
        subScoreValues: [{ label: 'Curriculum integration', score: 40 }],
      },
    });
    const html = renderToStaticMarkup(renderAiReadinessSection(data) as React.ReactElement);
    expect(html).toContain('program-ai-readiness.v2');
    expect(html).toContain('12 Aug 2026');
  });

  it('renders from the real captured fixture (KKU-SEQ-0065) without throwing, excluding Pedagogical readiness (no data)', () => {
    const data = ProgramDetailDataSchema.parse(FIXTURE);
    expect(() => renderToStaticMarkup(renderAiReadinessSection(data) as React.ReactElement)).not.toThrow();
    const html = renderToStaticMarkup(renderAiReadinessSection(data) as React.ReactElement);
    expect(html.match(/class="bar"/g) ?? []).toHaveLength(3);
    expect(html).toContain('Curriculum integration');
    expect(html).toContain('Skill resilience');
    expect(html).toContain('AI research presence');
    expect(html).toContain('Pedagogical readiness');
  });
});
