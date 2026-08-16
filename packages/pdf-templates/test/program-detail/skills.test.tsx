import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { renderSkillsSection } from '../../src/templates/program-detail/sections/skills';
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

const SKILLS_BASE = {
  matchScore: 42,
  demandSource: 'linkedin-via-mhesi',
  demandTier: 'high',
  careerFilterCount: 7,
  totalTaught: 6,
  ploCount: 6,
  major: [],
  minor: [],
  gaps: [],
};

describe('renderSkillsSection', () => {
  it('renders the section title and a Thai lede', () => {
    const data = parse({
      skills: {
        ...SKILLS_BASE,
        demanded: [
          { skill: 'Data engineering', peakDemand: 82, careerCount: 5, match: true },
          { skill: 'Machine learning', peakDemand: 64, careerCount: 4, match: null },
        ],
      },
    });
    const html = renderToStaticMarkup(renderSkillsSection(data) as React.ReactElement);
    expect(html).toContain('class="section-title"');
    expect(html).toContain('Skills coverage');
    const lede = /class="chart-lede"[^>]*>([^<]*)</.exec(html)?.[1] ?? '';
    expect(lede.length).toBeGreaterThan(0);
    expect(/[฀-๿]/.test(lede)).toBe(true);
  });

  it('renders one bar per demanded skill with a real peak-demand figure', () => {
    const data = parse({
      skills: {
        ...SKILLS_BASE,
        demanded: [
          { skill: 'Data engineering', peakDemand: 82, careerCount: 5, match: true },
          { skill: 'Machine learning', peakDemand: 64, careerCount: 4, match: false },
          { skill: 'Embedded systems', peakDemand: null, careerCount: 2, match: null },
        ],
      },
    });
    const html = renderToStaticMarkup(renderSkillsSection(data) as React.ReactElement);
    // Embedded systems has no measured peak demand — excluded from the bars,
    // not coerced to a zero-value bar.
    expect(html.match(/class="bar"/g) ?? []).toHaveLength(2);
    expect(html).toContain('Data engineering');
    expect(html).toContain('Machine learning');
  });

  it('names the top skill gaps in a footnote rather than dropping them silently', () => {
    const data = parse({
      skills: {
        ...SKILLS_BASE,
        demanded: [{ skill: 'Data engineering', peakDemand: 82, careerCount: 5, match: true }],
        gaps: [
          { skill: 'Cloud infrastructure', peakDemand: 71, careerCount: 6 },
          { skill: 'UX research', peakDemand: 55, careerCount: 3 },
        ],
      },
    });
    const html = renderToStaticMarkup(renderSkillsSection(data) as React.ReactElement);
    expect(html).toContain('Cloud infrastructure');
    expect(html).toContain('UX research');
  });

  it('returns null — not a placeholder chart — when skills was never computed', () => {
    const data = parse({ skills: null });
    expect(renderSkillsSection(data)).toBeNull();
  });

  // The exact case the real fixture (KKU-SEQ-0065) hits: `skills` is
  // present (matchScore, demandSource, demandTier etc. are all real) but
  // `demanded` is empty for this program — a labour-market-matching
  // outcome (see demandTier), not a missing-provenance bug. The section
  // must render its own explained empty block, naming the reason, not
  // return null and not draw a zero-valued chart.
  it('renders the explained empty block, naming the demand tier and source, when no skills are demand-matched', () => {
    const data = parse({
      skills: { ...SKILLS_BASE, demandTier: 'none', demandSource: 'linkedin-via-mhesi', demanded: [] },
    });
    const html = renderToStaticMarkup(renderSkillsSection(data) as React.ReactElement);
    expect(html).toContain('class="section-title"');
    expect(html).not.toContain('class="bar"');
    expect(html).toContain('class="chart-empty"');
    expect(html).toContain('none');
    expect(html).toContain('linkedin-via-mhesi');
  });

  // Council-facing attribution rule: this is LinkedIn data subscribed by
  // MHESI, hosted (not owned) by KMITL — never label it "KMITL data" on a
  // Council-facing surface.
  it('never labels the demand source as KMITL data', () => {
    const data = parse({
      skills: { ...SKILLS_BASE, demandSource: 'linkedin-via-mhesi', demanded: [] },
    });
    const html = renderToStaticMarkup(renderSkillsSection(data) as React.ReactElement);
    expect(html.toLowerCase()).not.toContain('kmitl');
  });

  it('carries real provenance — the demand source and the report date', () => {
    const data = parse({
      dateLabel: '12 Aug 2026',
      skills: {
        ...SKILLS_BASE,
        demandSource: 'linkedin-via-mhesi',
        demanded: [{ skill: 'Data engineering', peakDemand: 82, careerCount: 5, match: true }],
      },
    });
    const html = renderToStaticMarkup(renderSkillsSection(data) as React.ReactElement);
    expect(html).toContain('linkedin-via-mhesi');
    expect(html).toContain('12 Aug 2026');
  });

  it('renders from the real captured fixture (KKU-SEQ-0065) without throwing, and explains the empty demanded-skills state', () => {
    const data = ProgramDetailDataSchema.parse(FIXTURE);
    expect(data.skills).not.toBeNull();
    expect(data.skills?.demanded).toHaveLength(0);
    expect(() => renderToStaticMarkup(renderSkillsSection(data) as React.ReactElement)).not.toThrow();
    const html = renderToStaticMarkup(renderSkillsSection(data) as React.ReactElement);
    expect(html).toContain('class="chart-empty"');
  });
});
