import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { renderDecisionsSection } from '../../src/templates/program-detail/sections/decisions';
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

const DECISION = {
  decisionType: 'MERGE',
  status: 'APPROVED',
  decidedBy: 'University Council',
  createdAt: '2026-05-12',
  effectiveDate: '2026-08-01',
  rationale: 'Consolidate with the adjacent structural engineering track to reduce duplication.',
};

describe('renderDecisionsSection', () => {
  it('renders the section title and a Thai lede', () => {
    const data = parse({ decisions: [DECISION] });
    const html = renderToStaticMarkup(renderDecisionsSection(data) as React.ReactElement);
    expect(html).toContain('class="section-title"');
    expect(html).toContain('Council decisions');
    const lede = /class="chart-lede"[^>]*>([^<]*)</.exec(html)?.[1] ?? '';
    expect(lede.length).toBeGreaterThan(0);
    expect(/[฀-๿]/.test(lede)).toBe(true);
  });

  it('renders a table, not a Timeline, with one row per decision', () => {
    const data = parse({
      decisions: [
        DECISION,
        { ...DECISION, decisionType: 'LAUNCH', status: 'PROPOSED', createdAt: '2026-06-01', effectiveDate: null },
      ],
    });
    const html = renderToStaticMarkup(renderDecisionsSection(data) as React.ReactElement);
    expect(html).toContain('<table');
    expect(html).not.toContain('<svg');
    expect(html).toContain('MERGE');
    expect(html).toContain('LAUNCH');
    expect(html).toContain('University Council');
    expect((html.match(/<tr>/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  // The reason Timeline was rejected for this section: `effectiveDate` is
  // frequently null (a decision not yet in effect is a real "not decided
  // when" fact — see schema.ts's field comment), which Timeline cannot
  // plot. A table represents that row honestly with an em dash instead of
  // silently dropping it.
  it('renders a null effective date as an em dash rather than dropping the row', () => {
    const data = parse({ decisions: [{ ...DECISION, effectiveDate: null }] });
    const html = renderToStaticMarkup(renderDecisionsSection(data) as React.ReactElement);
    expect(html).toContain('MERGE');
    expect(html).toContain('—');
  });

  it('never drops the rationale', () => {
    const data = parse({ decisions: [DECISION] });
    const html = renderToStaticMarkup(renderDecisionsSection(data) as React.ReactElement);
    expect(html).toContain('Consolidate with the adjacent structural engineering track to reduce duplication.');
  });

  // No wrapping nullable object exists for `decisions` at the schema level
  // — same bare-array posture as `trends`. Zero decisions is a legitimate
  // real state (Council hasn't ruled on this program), not a provenance
  // failure, so this always renders with an explained empty note.
  it('renders the explained empty block, not null, when no decisions are on file', () => {
    const data = parse({ decisions: [] });
    const rendered = renderDecisionsSection(data);
    expect(rendered).not.toBeNull();
    const html = renderToStaticMarkup(rendered as React.ReactElement);
    expect(html).toContain('class="section-title"');
    expect(html).not.toContain('<table');
  });

  it('carries real provenance and the report date', () => {
    const data = parse({ dateLabel: '12 Aug 2026', decisions: [DECISION] });
    const html = renderToStaticMarkup(renderDecisionsSection(data) as React.ReactElement);
    expect(html).toContain('12 Aug 2026');
  });

  // The real fixture (KKU-SEQ-0065) has zero decisions on file — the
  // explained-empty path, not a throw.
  it('renders from the real captured fixture (KKU-SEQ-0065) without throwing', () => {
    const data = ProgramDetailDataSchema.parse(FIXTURE);
    expect(data.decisions).toHaveLength(0);
    expect(() => renderToStaticMarkup(renderDecisionsSection(data) as React.ReactElement)).not.toThrow();
    const html = renderToStaticMarkup(renderDecisionsSection(data) as React.ReactElement);
    expect(html).toContain('class="section-title"');
  });
});
