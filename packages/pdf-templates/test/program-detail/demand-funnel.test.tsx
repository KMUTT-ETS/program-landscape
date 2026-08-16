import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { renderDemandFunnelSection } from '../../src/templates/program-detail/sections/demand-funnel';
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

const DEMAND_FUNNEL_BASE = {
  anchorEntryYearBE: 2564,
  anchorEntryYearCE: 2021,
  cohortStatus: 'lifecycle complete',
  programDurationYears: 4,
  methodologyVersion: 'demand-funnel.v2',
  alumniBreakdown: [],
  cohortTrend: [],
};

describe('renderDemandFunnelSection', () => {
  it('renders the section title, a Thai lede and a funnel band per stage', () => {
    const data = parse({
      demandFunnel: {
        ...DEMAND_FUNNEL_BASE,
        stages: [
          { stage: 'Applied', value: 120 },
          { stage: 'Admitted', value: 100 },
          { stage: 'Enrolled', value: 90 },
          { stage: 'Persisted', value: 85 },
          { stage: 'Graduated', value: 80 },
        ],
        conversions: [],
      },
    });
    const html = renderToStaticMarkup(renderDemandFunnelSection(data) as React.ReactElement);
    expect(html).toContain('class="section-title"');
    expect(html).toContain('Demand funnel');
    const lede = /class="chart-lede"[^>]*>([^<]*)</.exec(html)?.[1] ?? '';
    expect(lede.length).toBeGreaterThan(0);
    expect(/[฀-๿]/.test(lede)).toBe(true);
    expect(html.match(/class="funnel-band"/g) ?? []).toHaveLength(5);
  });

  it('returns null — not a placeholder chart — when the demand funnel was never computed for this program', () => {
    const data = parse({ demandFunnel: null });
    expect(renderDemandFunnelSection(data)).toBeNull();
  });

  // The real fixture's demandFunnel object is present (methodologyVersion,
  // programDurationYears etc. are all real) but `stages` is empty — an
  // in-progress cohort with no completed funnel yet. This is exactly the
  // "data is partially present" case: the section must still render its
  // header and provenance, with the chart's own explained empty block,
  // not return null and not draw a zero-valued funnel.
  it('renders the explained empty block — naming the reason, not a zero-valued funnel — when stages is empty but demandFunnel is present', () => {
    const data = ProgramDetailDataSchema.parse(FIXTURE);
    expect(data.demandFunnel).not.toBeNull();
    expect(data.demandFunnel?.stages).toHaveLength(0);

    const html = renderToStaticMarkup(renderDemandFunnelSection(data) as React.ReactElement);
    expect(html).toContain('class="section-title"');
    expect(html).not.toContain('class="funnel-band"');
    expect(html).toContain('class="chart-empty"');
    expect(html).toMatch(/kku-registry|alumni/i);
  });

  it('carries real provenance — the demand-funnel methodology version and the report date', () => {
    const data = parse({
      dateLabel: '12 Aug 2026',
      demandFunnel: {
        ...DEMAND_FUNNEL_BASE,
        methodologyVersion: 'demand-funnel.v2',
        stages: [{ stage: 'Applied', value: 10 }, { stage: 'Admitted', value: 8 }, { stage: 'Enrolled', value: 7 }],
        conversions: [],
      },
    });
    const html = renderToStaticMarkup(renderDemandFunnelSection(data) as React.ReactElement);
    expect(html).toContain('demand-funnel.v2');
    expect(html).toContain('12 Aug 2026');
  });
});
