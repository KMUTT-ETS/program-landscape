import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { renderPeersSection } from '../../src/templates/program-detail/sections/peers';
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

const PEERS_BASE = {
  subjectSignature: 'engineering-civil',
  rankingYear: 2025,
  aiReview: null,
  curatedPeers: [],
};

describe('renderPeersSection', () => {
  it('renders the section title and a Thai lede', () => {
    const data = parse({
      peers: {
        ...PEERS_BASE,
        tiers: [
          {
            tier: 'World tier',
            entries: [
              { rank: 1, institution: 'Massachusetts Institute of Technology', country: 'United States', qsWorld: 1, programme: 'BSc Civil Engineering' },
            ],
          },
        ],
      },
    });
    const html = renderToStaticMarkup(renderPeersSection(data) as React.ReactElement);
    expect(html).toContain('class="section-title"');
    expect(html).toContain('Peer institutions');
    const lede = /class="chart-lede"[^>]*>([^<]*)</.exec(html)?.[1] ?? '';
    expect(lede.length).toBeGreaterThan(0);
    expect(/[฀-๿]/.test(lede)).toBe(true);
  });

  it('renders one row per non-empty tier and one column per curated institution', () => {
    const data = parse({
      peers: {
        ...PEERS_BASE,
        tiers: [
          {
            tier: 'World tier',
            entries: [
              { rank: 1, institution: 'Massachusetts Institute of Technology', country: 'United States', qsWorld: 1, programme: 'BSc Civil Engineering' },
              { rank: 2, institution: 'Delft University of Technology', country: 'Netherlands', qsWorld: 50, programme: 'BSc Civil Engineering' },
            ],
          },
          {
            tier: 'Thailand',
            entries: [
              { rank: 1, institution: 'Chulalongkorn University', country: 'Thailand', qsWorld: 208, programme: 'BEng Civil Engineering' },
            ],
          },
          { tier: 'Asia tier', entries: [] },
        ],
      },
    });
    const html = renderToStaticMarkup(renderPeersSection(data) as React.ReactElement);
    // 2 non-empty tiers -> 2 rows; empty "Asia tier" is not shown as a row.
    expect(html).toContain('World tier');
    expect(html).toContain('Thailand');
    expect(html).not.toContain('>Asia tier<');
    expect(html).toContain('Massachusetts Institute of Technology');
    expect(html).toContain('Chulalongkorn University');
    // World tier contributes 2 measured cells (MIT, Delft), Thailand
    // contributes 1 (Chulalongkorn) — 3 total, not 2, since MIT and Delft
    // are both real, distinct columns in the same row.
    expect(html.match(/class="matrix-cell"/g) ?? []).toHaveLength(3);
  });

  // Long institution names are exactly the case Matrix's column-header
  // rotation exists for — this must actually trigger, not just fit by luck.
  it('rotates long institution-name column headers', () => {
    const data = parse({
      peers: {
        ...PEERS_BASE,
        tiers: [
          {
            tier: 'Asia tier',
            entries: [
              {
                rank: 1,
                institution: "King Mongkut's Institute of Technology Ladkrabang",
                country: 'Thailand',
                qsWorld: 401,
                programme: 'BEng Civil Engineering',
              },
            ],
          },
        ],
      },
    });
    const html = renderToStaticMarkup(renderPeersSection(data) as React.ReactElement);
    expect(html).toContain('rotate(-45');
  });

  it('returns null — not a placeholder chart — when peers was never computed', () => {
    const data = parse({ peers: null });
    expect(renderPeersSection(data)).toBeNull();
  });

  it('renders the explained empty block when no tier has any curated peers', () => {
    const data = parse({
      peers: { ...PEERS_BASE, tiers: [{ tier: 'World tier', entries: [] }] },
    });
    const html = renderToStaticMarkup(renderPeersSection(data) as React.ReactElement);
    expect(html).toContain('class="section-title"');
    expect(html).not.toContain('class="matrix-cell"');
    expect(html).toContain('class="chart-empty"');
  });

  it('carries real provenance — the subject signature, ranking year and report date', () => {
    const data = parse({
      dateLabel: '12 Aug 2026',
      peers: {
        ...PEERS_BASE,
        subjectSignature: 'engineering-civil',
        rankingYear: 2025,
        tiers: [
          {
            tier: 'World tier',
            entries: [{ rank: 1, institution: 'ETH Zurich', country: 'Switzerland', qsWorld: 7, programme: 'BSc Civil Engineering' }],
          },
        ],
      },
    });
    const html = renderToStaticMarkup(renderPeersSection(data) as React.ReactElement);
    expect(html).toContain('engineering-civil');
    expect(html).toContain('2025');
    expect(html).toContain('12 Aug 2026');
  });

  it('renders from the real captured fixture (KKU-SEQ-0065) without throwing', () => {
    const data = ProgramDetailDataSchema.parse(FIXTURE);
    expect(data.peers).not.toBeNull();
    expect(() => renderToStaticMarkup(renderPeersSection(data) as React.ReactElement)).not.toThrow();
    const html = renderToStaticMarkup(renderPeersSection(data) as React.ReactElement);
    expect(html).toContain('class="matrix-cell"');
  });
});
