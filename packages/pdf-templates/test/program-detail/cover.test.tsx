import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { renderCoverPage } from '../../src/templates/program-detail/sections/cover';
import {
  ProgramDetailDataSchema,
  type ProgramDetailData,
} from '../../src/templates/program-detail/schema';
import FIXTURE from './fixture.json';

// The minimal set of fields with no `.default()` in schema.ts. Every other
// field is optional in the parse and comes back as its schema default
// (`[]`, `null`, `''`) — which is exactly the "no data yet" shape this
// suite needs for the null-rendering assertions below.
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

function statBlock(html: string, stat: 'health' | 'lifecycle' | 'completeness'): string {
  const match = new RegExp(`<div class="stat" data-stat="${stat}">.*?</div>`, 's').exec(html);
  if (!match) throw new Error(`no stat block found for "${stat}" in: ${html}`);
  return match[0];
}

describe('renderCoverPage', () => {
  it('renders the Thai name, English name, code and faculty', () => {
    const html = renderToStaticMarkup(renderCoverPage(parse()));
    expect(html).toContain(MINIMAL_BASE.nameTh);
    expect(html).toContain(MINIMAL_BASE.nameEn);
    expect(html).toContain(MINIMAL_BASE.programCode);
    expect(html).toContain(MINIMAL_BASE.facultyTh);
    expect(html).toContain(MINIMAL_BASE.facultyEn);
  });

  it('renders all three stats when the data is present', () => {
    const data = parse({
      healthOverallScore: 75,
      healthOverallCompletenessPct: 63,
      lifecycle: {
        verdict: 'GROWTH',
        trajectoryScore: 80,
        methodologyVersion: 'lifecycle.v1.4',
        generatedAt: '2026-01-01',
        narrative: '',
        drivers: [],
      },
    });
    const html = renderToStaticMarkup(renderCoverPage(data));

    expect(statBlock(html, 'health')).toContain('75');
    // lifecycle verdict, plus its trajectory score
    expect(statBlock(html, 'lifecycle')).toContain('GROWTH');
    expect(statBlock(html, 'lifecycle')).toContain('80');
    expect(statBlock(html, 'completeness')).toContain('63');
  });

  // The regression this test exists for: cover.tsx used to average
  // `healthDimensions` itself instead of reading the payload's own
  // composite. Set `healthOverallScore` to a value the dimension average
  // deliberately disagrees with (dimensions here average to 62; the
  // payload's own score is 77) and assert the cover shows the payload's
  // number. A template displays what it is given; it does not compute
  // its own version of a scoring methodology.
  it('displays the score on the payload, not a mean of healthDimensions', () => {
    const data = parse({
      healthOverallScore: 77,
      healthDimensions: [
        {
          dimension: 'Attractiveness',
          score: 50,
          dataCompleteness: 100,
          topDriverLabel: null,
          topDriverValue: null,
        },
        {
          dimension: 'Capability',
          score: 74,
          dataCompleteness: 100,
          topDriverLabel: null,
          topDriverValue: null,
        },
      ], // mean = 62 — deliberately not 77
    });
    const html = renderToStaticMarkup(renderCoverPage(data));
    const health = statBlock(html, 'health');
    expect(health).toContain('77');
    expect(health).not.toContain('62');
  });

  it('renders a null health score as an em dash, never "0" or the literal "null"', () => {
    // MINIMAL_BASE has no healthOverallScore/healthOverallCompletenessPct
    // and no lifecycle — all fall back to schema defaults (null), which
    // is the genuine "no data yet" case, not a fabricated zero.
    const html = renderToStaticMarkup(renderCoverPage(parse()));
    const health = statBlock(html, 'health');
    expect(health).toContain('—');
    expect(health).not.toMatch(/>0</);
    expect(health).not.toMatch(/null/);

    const lifecycle = statBlock(html, 'lifecycle');
    expect(lifecycle).toContain('—');
    expect(lifecycle).not.toMatch(/null/);

    const completeness = statBlock(html, 'completeness');
    expect(completeness).toContain('—');
    expect(completeness).not.toMatch(/>0%</);
  });

  it('marks null stat values as muted rather than styling them identically to a real figure', () => {
    const html = renderToStaticMarkup(renderCoverPage(parse()));
    expect(statBlock(html, 'health')).toMatch(/class="stat-value muted"/);
    expect(statBlock(html, 'lifecycle')).toMatch(/class="stat-value muted"/);
    expect(statBlock(html, 'completeness')).toMatch(/class="stat-value muted"/);
  });

  it('renders the generation date, methodology version(s) and data-as-of date', () => {
    const data = parse({
      lifecycle: {
        verdict: 'GROWTH',
        trajectoryScore: 80,
        methodologyVersion: 'lifecycle.v1.4',
        generatedAt: '2026-01-01',
        narrative: '',
        drivers: [],
      },
    });
    const html = renderToStaticMarkup(renderCoverPage(data));
    expect(html).toContain(MINIMAL_BASE.generatedAtLabel);
    expect(html).toContain(MINIMAL_BASE.dateLabel);
    expect(html).toContain(MINIMAL_BASE.methodologyVersion);
    expect(html).toContain('lifecycle.v1.4');
  });

  it('renders a short Thai standfirst describing what the report covers', () => {
    const html = renderToStaticMarkup(renderCoverPage(parse()));
    expect(html).toMatch(/class="cover-standfirst"/);
    // Content is Thai-primary per the language strategy — assert at least
    // one Thai character lands inside the standfirst, not just the class.
    const standfirst = /<p class="cover-standfirst"[^>]*>([^<]*)<\/p>/.exec(html)?.[1] ?? '';
    expect(standfirst.length).toBeGreaterThan(0);
    expect(/[฀-๿]/.test(standfirst)).toBe(true);
  });

  it('renders from the real captured fixture (KKU-SEQ-0065) without throwing', () => {
    const data = ProgramDetailDataSchema.parse(FIXTURE);
    expect(() => renderToStaticMarkup(renderCoverPage(data))).not.toThrow();

    const html = renderToStaticMarkup(renderCoverPage(data));
    expect(html).toContain(data.programCode);
    expect(html).toContain(data.nameTh);
    expect(html).toContain(data.nameEn);
    // Fixture has a real lifecycle verdict (SUNSET) and a mix of null/
    // non-null health dimensions (Financial is null) — the real-world
    // case the null-handling rule exists for.
    expect(statBlock(html, 'lifecycle')).toContain('SUNSET');
  });
});
