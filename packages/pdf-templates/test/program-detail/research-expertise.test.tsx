import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { renderResearchExpertiseSection } from '../../src/templates/program-detail/sections/research-expertise';
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

const REC = (over: Partial<Record<string, unknown>> = {}) => ({
  action: 'Introduce a graduate elective on recycled-aggregate concrete design',
  rationale: 'Builds directly on the roster’s strongest, rising theme.',
  horizonMonths: 12,
  themeRefs: ['Sustainable construction materials'],
  ...over,
});

const RESEARCH_EXPERTISE_BASE = {
  methodVersion: 'program-research-expertise.v3',
  generatedAt: '2026-08-17',
  analysedPaperCount: 150,
  totalDistinctPapers: 259,
  confidencePct: 89,
  themes: [
    {
      name: 'Sustainable construction materials',
      paperCount: 42,
      exampleTitles: [
        'Recycled aggregate concrete: a decade of KKU field trials',
        'Fly-ash blended cement for low-carbon infrastructure',
      ],
      yearSpan: '2016–2026',
      trend: 'rising' as const,
      evidenceNote: '42 papers, concentrated in the last 4 years.',
    },
  ],
  recommendations: {
    curriculum: [REC()],
    positioning: [REC({ action: 'Position KKU as the Northeast hub for low-carbon construction research.' })],
    research: [REC({ action: 'Pursue a joint grant on fly-ash blended cement with a Q1-publishing partner.' })],
  },
  caveats: [
    'Analysis covers publications of the curated program roster (AI-extracted, analyst-reviewed); roster gaps or errors propagate to these findings.',
  ],
};

describe('renderResearchExpertiseSection', () => {
  it('renders the section title and a Thai lede', () => {
    const data = parse({ researchExpertise: RESEARCH_EXPERTISE_BASE });
    const html = renderToStaticMarkup(renderResearchExpertiseSection(data) as React.ReactElement);
    expect(html).toContain('class="section-title"');
    expect(html).toContain('Research expertise');
    const lede = /class="chart-lede"[^>]*>([^<]*)</.exec(html)?.[1] ?? '';
    expect(lede.length).toBeGreaterThan(0);
    expect(/[฀-๿]/.test(lede)).toBe(true);
  });

  it('renders a table of themes and the three recommendation lanes', () => {
    const data = parse({ researchExpertise: RESEARCH_EXPERTISE_BASE });
    const html = renderToStaticMarkup(renderResearchExpertiseSection(data) as React.ReactElement);
    expect(html).toContain('<table');
    expect(html).not.toContain('<svg');
    expect(html).toContain('Sustainable construction materials');
    expect(html).toContain('Recycled aggregate concrete: a decade of KKU field trials');
    expect(html).toContain('Fly-ash blended cement for low-carbon infrastructure');
    expect(html).toContain('2016–2026');
    expect(html).toContain('Rising');
    // All three lanes present, each with its own recommendation text.
    expect(html).toContain('Curriculum');
    expect(html).toContain('Introduce a graduate elective on recycled-aggregate concrete design');
    expect(html).toContain('Positioning');
    expect(html).toContain('Position KKU as the Northeast hub for low-carbon construction research.');
    expect(html).toContain('Research strategy');
    expect(html).toContain('Pursue a joint grant on fly-ash blended cement with a Q1-publishing partner.');
  });

  it('states the counts-basis line — theme counts are within the analysed set, not the full roster', () => {
    const data = parse({ researchExpertise: RESEARCH_EXPERTISE_BASE });
    const html = renderToStaticMarkup(renderResearchExpertiseSection(data) as React.ReactElement);
    expect(html).toContain(
      'Theme counts refer to the 150 most significant papers analysed (of 259 total).',
    );
  });

  it('prints confidence and methodVersion in the provenance line, never a raw float', () => {
    const data = parse({ researchExpertise: { ...RESEARCH_EXPERTISE_BASE, confidencePct: 89.4 } });
    const html = renderToStaticMarkup(renderResearchExpertiseSection(data) as React.ReactElement);
    expect(html).toContain('program-research-expertise.v3');
    expect(html).toContain('89%');
    expect(html).not.toContain('89.4');
    expect(html).toContain('2026-08-17');
  });

  it('renders caveats verbatim', () => {
    const data = parse({ researchExpertise: RESEARCH_EXPERTISE_BASE });
    const html = renderToStaticMarkup(renderResearchExpertiseSection(data) as React.ReactElement);
    expect(html).toContain(
      'Analysis covers publications of the curated program roster (AI-extracted, analyst-reviewed); roster gaps or errors propagate to these findings.',
    );
  });

  // Unlike `peers.tsx` / `strategic-narrative.tsx`, this section does NOT
  // return null when its field is absent — see the header comment in
  // research-expertise.tsx. A missing brief is a real, often-permanent
  // state (no-roster / thin roster / not yet reached by the bulk run) that
  // a Council reader must be able to tell apart from a silently dropped
  // section.
  it('renders an explained empty state, not null, when no brief has been generated', () => {
    const data = parse({ researchExpertise: null });
    const rendered = renderResearchExpertiseSection(data);
    expect(rendered).not.toBeNull();
    const html = renderToStaticMarkup(rendered as React.ReactElement);
    expect(html).toContain('class="section-title"');
    expect(html).not.toContain('<table');
    expect(html).toContain('No research-expertise brief has been generated');
  });

  it('carries real provenance and the report date', () => {
    const data = parse({ dateLabel: '12 Aug 2026', researchExpertise: RESEARCH_EXPERTISE_BASE });
    const html = renderToStaticMarkup(renderResearchExpertiseSection(data) as React.ReactElement);
    expect(html).toContain('12 Aug 2026');
  });

  // Belt-and-braces, mirroring faculty.test.tsx's narrow redaction case:
  // this section's data source (ProgramResearchExpertise) carries no
  // faculty-member identity fields at all — themes, recommendations, and
  // caveats are all program-level, never per-person. Even if a name were
  // planted into the unrelated `faculty.roster` field on the same payload,
  // this section must never surface it, because it never reads
  // `data.faculty` in the first place.
  it('never renders a faculty roster name — this section reads only its own payload fields', () => {
    const data = parse({
      researchExpertise: RESEARCH_EXPERTISE_BASE,
      faculty: {
        rosterScope: 'program-specific roster',
        visibility: 'full detail',
        kpis: [],
        seniorRankCount: 1,
        totalRankedCount: 1,
        seniorRankSharePct: 100,
        rankDistribution: [],
        roster: [
          { rank: 'Professor', name: 'ผศ.ดร. สมชาย ทดสอบ', specialization: '', retires: '' },
        ],
      },
    });
    const html = renderToStaticMarkup(renderResearchExpertiseSection(data) as React.ReactElement);
    expect(html).not.toContain('สมชาย');
  });

  it('renders from the real captured fixture (KKU-SEQ-0065) without throwing', () => {
    const data = ProgramDetailDataSchema.parse(FIXTURE);
    expect(data.researchExpertise).not.toBeNull();
    expect(() =>
      renderToStaticMarkup(renderResearchExpertiseSection(data) as React.ReactElement),
    ).not.toThrow();
    const html = renderToStaticMarkup(renderResearchExpertiseSection(data) as React.ReactElement);
    expect(html).toContain('<table');
    expect(html).toContain('Theme counts refer to');
  });
});
