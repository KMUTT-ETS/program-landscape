import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { renderAppendix } from '../../src/templates/program-detail/appendix';
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

// Extracts the `counter-reset: appendix-item N` values in document order —
// this is the only observable trace of an appendix entry's originating
// section index in static-markup output; the "B.N" text itself is CSS
// generated content (`::before`) and never appears in the rendered HTML.
function resetValues(html: string): number[] {
  return [...html.matchAll(/counter-reset:appendix-item (-?\d+)/g)].map((m) => Number(m[1]));
}

const AI_READINESS_BASE = {
  overallScore: 35,
  verdict: 'Low AI readiness',
  summary: '',
  methodologyVersion: 'program-ai-readiness.v2',
  subScores: [],
};

const DEMAND_FUNNEL_BASE = {
  anchorEntryYearBE: 2564,
  anchorEntryYearCE: 2021,
  cohortStatus: 'Completed',
  programDurationYears: 4,
  methodologyVersion: 'demand-funnel.v1',
  conversions: [],
  alumniBreakdown: [],
  cohortTrend: [],
};

describe('renderAppendix', () => {
  it('renders the appendix heading', () => {
    const data = parse({});
    const html = renderToStaticMarkup(renderAppendix(data));
    expect(html).toContain('Appendix B');
  });

  it('renders an explained empty note when no chart-led section has any data', () => {
    const data = parse({});
    const html = renderToStaticMarkup(renderAppendix(data));
    expect(html).not.toContain('class="appendix-entry"');
    expect(html).toContain('class="muted"');
  });

  it('contributes one entry for a chart-led section with data, seeded to its section index minus one', () => {
    // health-score is the FIRST numbered section — sectionIndex 1, so the
    // seeded counter-reset value must be 0 (its own `counter-increment`
    // then brings the displayed "B.N" to 1).
    const data = parse({
      healthDimensions: [
        { dimension: 'Attractiveness', score: 90, dataCompleteness: 50, topDriverLabel: null, topDriverValue: null },
      ],
    });
    const html = renderToStaticMarkup(renderAppendix(data));
    expect(html).toContain('class="appendix-entry"');
    expect(resetValues(html)).toEqual([0]);
  });

  it('skips a chart-led section that rendered but produced no rows to tabulate', () => {
    // aiReadiness is present (the section itself renders, taking up
    // numbered slot 2 behind health-score) but every sub-score array is
    // empty — there is nothing to move to the appendix, so it must not
    // appear here even though its body section exists.
    const data = parse({
      healthDimensions: [
        { dimension: 'Attractiveness', score: 90, dataCompleteness: 50, topDriverLabel: null, topDriverValue: null },
      ],
      aiReadiness: { ...AI_READINESS_BASE, subScoreValues: [], skillBreakdown: [], gaps: [], recommendations: [] },
    });
    const html = renderToStaticMarkup(renderAppendix(data));
    // Only the health-score entry — nothing for aiReadiness.
    expect(resetValues(html)).toEqual([0]);
  });

  it('numbers a sparse set of entries against their true originating section — prose and no-data sections consume a slot but contribute nothing', () => {
    const data = parse({
      // §1 — chart-led, has data → contributes.
      healthDimensions: [
        { dimension: 'Attractiveness', score: 90, dataCompleteness: 50, topDriverLabel: null, topDriverValue: null },
      ],
      // §2 — prose, never contributes.
      lifecycle: {
        verdict: 'STABLE',
        trajectoryScore: 55,
        methodologyVersion: 'lifecycle.v1',
        generatedAt: '2026-01-01',
        narrative: '',
        drivers: [],
      },
      // §3 — prose, never contributes.
      strategicNarrative: {
        contentMarkdown: 'Test narrative.',
        methodVersion: 'strategic-narrative.v1',
        confidencePct: 80,
        generatedAt: '2026-01-01',
      },
      // §4 — chart-led, no rows → occupies a slot, contributes nothing.
      aiReadiness: { ...AI_READINESS_BASE, subScoreValues: [], skillBreakdown: [], gaps: [], recommendations: [] },
      // §5 — chart-led, has data → contributes.
      demandFunnel: { ...DEMAND_FUNNEL_BASE, stages: [{ stage: 'Admitted', value: 120 }] },
    });
    const html = renderToStaticMarkup(renderAppendix(data));
    // sectionIndex 1 -> reset 0; sectionIndex 5 -> reset 4. §2, §3, §4
    // contribute nothing, so the sequence is sparse, not [0, 1].
    expect(resetValues(html)).toEqual([0, 4]);
  });

  it('shows a value plotted in a chart identically in the appendix, in full precision — never the chart axis abbreviation', () => {
    const data = parse({
      outcomes: {
        surveyYear: 2025,
        methodologyVersion: 'graduate-outcomes.v1',
        freshnessDate: '2026-01-01',
        sampleSize: 40,
        summary: [],
        employmentRatePct: 90,
        averageSalary: null,
        jobRelevanceScorePct: null,
        furtherStudyRatePct: null,
        salaryTrajectory: [{ year: 2568, salary: 2354250 }],
        topEmployers: [],
      },
    });
    const html = renderToStaticMarkup(renderAppendix(data));
    // Full precision, thousands-separated — not `formatCompactNumber`'s
    // chart-axis abbreviation ("2.35M").
    expect(html).toContain('2,354,250');
    expect(html).not.toContain('2.35M');
  });

  it('renders a null figure as an em dash, never a fabricated zero', () => {
    const data = parse({
      faculty: {
        rosterScope: 'primary appointment',
        visibility: 'full detail',
        kpis: [],
        seniorRankCount: null,
        totalRankedCount: null,
        seniorRankSharePct: null,
        rankDistribution: [{ rank: 'Lecturer', count: null, share: null }],
        roster: [],
      },
    });
    const html = renderToStaticMarkup(renderAppendix(data));
    expect(html).toContain('Lecturer');
    expect(html).toContain('—');
    expect(html).not.toMatch(/<td className="numeric">0<\/td>/);
  });

  it('renders from the real captured fixture (KKU-SEQ-0065) without throwing, with sparse numbering matching each section’s true index', () => {
    const data = ProgramDetailDataSchema.parse(FIXTURE);
    expect(() => renderToStaticMarkup(renderAppendix(data))).not.toThrow();
    const html = renderToStaticMarkup(renderAppendix(data));

    // Document order of rendered (non-null) numbered sections in this real
    // fixture: health-score(1) lifecycle(2) strategic-narrative(3)
    // ai-readiness(4) demand-funnel(5, empty stages) recruitment(6)
    // tcas(7) [cohort-distribution is null, no slot] demographic-outlook(8)
    // outcomes(9) skills(10, empty demanded) courses(11) faculty(12)
    // [financials is null, no slot] peers(13) trends(14) decisions(15).
    // Chart-led sections WITH rows: health-score(1), ai-readiness(4),
    // recruitment(6), tcas(7), demographic-outlook(8), outcomes(9),
    // faculty(12) — seeded to sectionIndex - 1.
    expect(resetValues(html)).toEqual([0, 3, 5, 6, 7, 8, 11]);
  });
});
