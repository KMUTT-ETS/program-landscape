import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { renderTcasSection } from '../../src/templates/program-detail/sections/tcas';
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

describe('renderTcasSection', () => {
  it('renders the section title and a Thai lede', () => {
    const data = parse({
      tcas: {
        peerMatchKey: 'subject:civil-engineering',
        history: [
          { yearBE: 2568, round: '3.2', quota: 12, applicants: 330, competition: 27.5, fillRate: 200, minScore: 40.79, maxScore: 50.46 },
        ],
        peers: [
          { match: 'subject', institution: 'Peer A', programme: 'Civil Eng', quota: 18, applicants: 1423, competition: 79.05, minScore: 56.73 },
          { match: 'subject', institution: 'Peer B', programme: 'Civil Eng', quota: 46, applicants: 1494, competition: 32.48, minScore: 40.8 },
        ],
      },
    });
    const html = renderToStaticMarkup(renderTcasSection(data) as React.ReactElement);
    expect(html).toContain('class="section-title"');
    expect(html).toContain('TCAS');
    const lede = /class="chart-lede"[^>]*>([^<]*)</.exec(html)?.[1] ?? '';
    expect(lede.length).toBeGreaterThan(0);
    expect(/[฀-๿]/.test(lede)).toBe(true);
  });

  it('renders one dot-range row for every history entry with a real minScore', () => {
    const data = parse({
      tcas: {
        peerMatchKey: '',
        history: [
          { yearBE: 2568, round: '3.2', quota: 12, applicants: 330, competition: 27.5, fillRate: 200, minScore: 40.79, maxScore: 50.46 },
          { yearBE: 2568, round: '3.1', quota: 12, applicants: 330, competition: 27.5, fillRate: 0, minScore: null, maxScore: null },
          { yearBE: 2567, round: '3', quota: 27, applicants: 182, competition: 6.74, fillRate: 0, minScore: null, maxScore: null },
        ],
        peers: [
          { match: 'subject', institution: 'Peer A', programme: 'Civil Eng', quota: 18, applicants: 1423, competition: 79.05, minScore: 56.73 },
        ],
      },
    });
    const html = renderToStaticMarkup(renderTcasSection(data) as React.ReactElement);
    // Only the one history row with a non-null minScore can be plotted.
    expect(html.match(/class="dotrange-value"/g) ?? []).toHaveLength(1);
  });

  // The critical behaviour this section exists to preserve: an admission
  // cutoff outside the peer band is a real data-quality signal (an
  // unusually lenient or strict cutoff vs comparable programmes elsewhere)
  // and must render at its true position, marked, never clamped into the
  // peer range.
  it('renders a KKU value outside the peer range unclamped and marked, never silently pulled inside it', () => {
    const data = parse({
      tcas: {
        peerMatchKey: '',
        history: [
          { yearBE: 2568, round: '3', quota: 12, applicants: 330, competition: 27.5, fillRate: 100, minScore: 20, maxScore: 30 },
        ],
        peers: [
          { match: 'subject', institution: 'Peer A', programme: 'Civil Eng', quota: 18, applicants: 1423, competition: 79.05, minScore: 55 },
          { match: 'subject', institution: 'Peer B', programme: 'Civil Eng', quota: 46, applicants: 1494, competition: 32.48, minScore: 60 },
        ],
      },
    });
    const html = renderToStaticMarkup(renderTcasSection(data) as React.ReactElement);
    expect(html.match(/class="dotrange-anomaly-note"/g) ?? []).toHaveLength(1);
    expect(html).toContain('outside peer range');
  });

  it('returns null — not a placeholder chart — when tcas was never computed', () => {
    const data = parse({ tcas: null });
    expect(renderTcasSection(data)).toBeNull();
  });

  it('renders the explained empty block, not a zero-valued range, when there is no peer data to compare against', () => {
    const data = parse({
      tcas: {
        peerMatchKey: '',
        history: [
          { yearBE: 2568, round: '3', quota: 12, applicants: 330, competition: 27.5, fillRate: 100, minScore: 41, maxScore: 50 },
        ],
        peers: [],
      },
    });
    const html = renderToStaticMarkup(renderTcasSection(data) as React.ReactElement);
    expect(html).toContain('class="section-title"');
    expect(html).not.toContain('class="dotrange-value"');
    expect(html).toContain('class="chart-empty"');
  });

  it('carries real provenance — the tcas methodology and the report date', () => {
    const data = parse({
      dateLabel: '12 Aug 2026',
      tcas: {
        peerMatchKey: '',
        history: [
          { yearBE: 2568, round: '3', quota: 12, applicants: 330, competition: 27.5, fillRate: 100, minScore: 41, maxScore: 50 },
        ],
        peers: [
          { match: 'subject', institution: 'Peer A', programme: 'Civil Eng', quota: 18, applicants: 1423, competition: 79.05, minScore: 55 },
        ],
      },
    });
    const html = renderToStaticMarkup(renderTcasSection(data) as React.ReactElement);
    expect(html).toContain('tcas-connector');
    expect(html).toContain('12 Aug 2026');
  });

  it('renders from the real captured fixture (KKU-SEQ-0065) without throwing', () => {
    const data = ProgramDetailDataSchema.parse(FIXTURE);
    expect(() => renderToStaticMarkup(renderTcasSection(data) as React.ReactElement)).not.toThrow();
  });
});
