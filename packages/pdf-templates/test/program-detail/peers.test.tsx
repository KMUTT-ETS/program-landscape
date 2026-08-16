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

  it('renders a table, not a heatmap, with one row per peer entry — nothing capped', () => {
    const data = parse({
      peers: {
        ...PEERS_BASE,
        tiers: [
          {
            tier: 'World tier',
            entries: [
              { rank: 1, institution: 'Massachusetts Institute of Technology', country: 'United States', qsWorld: 1, programme: 'BSc Civil Engineering' },
              { rank: 2, institution: 'Delft University of Technology', country: 'Netherlands', qsWorld: 50, programme: 'BSc Civil Engineering' },
              { rank: 3, institution: 'University of California, Berkeley', country: 'United States', qsWorld: 12, programme: 'BSc Civil Engineering' },
              { rank: 4, institution: 'Imperial College London', country: 'United Kingdom', qsWorld: 2, programme: 'BEng Civil Engineering' },
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
    expect(html).toContain('<table');
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('class="matrix-cell"');
    // World tier had 4 curated entries — the old Matrix rescue capped this
    // to 3 and dropped Imperial College London. All 4 must be present now.
    expect(html).toContain('Massachusetts Institute of Technology');
    expect(html).toContain('Delft University of Technology');
    expect(html).toContain('University of California, Berkeley');
    expect(html).toContain('Imperial College London');
    expect(html).toContain('Chulalongkorn University');
    expect(html).toContain('World tier');
    expect(html).toContain('Thailand');
    // Empty "Asia tier" contributes no row.
    expect(html).not.toContain('>Asia tier<');
    // 5 curated entries total across the two non-empty tiers, plus 1 header row.
    expect((html.match(/<tr>/g) ?? []).length).toBe(6);
  });

  it('states "lower is better" in the lede rather than inverting the shared intensity idiom', () => {
    const data = parse({
      peers: {
        ...PEERS_BASE,
        tiers: [
          {
            tier: 'World tier',
            entries: [{ rank: 1, institution: 'ETH Zurich', country: 'Switzerland', qsWorld: 7, programme: 'BSc Civil Engineering' }],
          },
        ],
      },
    });
    const html = renderToStaticMarkup(renderPeersSection(data) as React.ReactElement);
    const lede = /class="chart-lede"[^>]*>([^<]*)</.exec(html)?.[1] ?? '';
    expect(lede).toContain('น้อย');
  });

  it('renders a null rank or QS World rank as an em dash, not a dropped row', () => {
    const data = parse({
      peers: {
        ...PEERS_BASE,
        tiers: [
          {
            tier: 'World tier',
            entries: [
              { rank: null, institution: 'Unranked University', country: 'Testland', qsWorld: null, programme: 'BSc Civil Engineering' },
            ],
          },
        ],
      },
    });
    const html = renderToStaticMarkup(renderPeersSection(data) as React.ReactElement);
    expect(html).toContain('Unranked University');
    expect(html).toContain('—');
  });

  it('returns null — not a placeholder table — when peers was never computed', () => {
    const data = parse({ peers: null });
    expect(renderPeersSection(data)).toBeNull();
  });

  it('renders the explained empty block when no tier has any curated peers', () => {
    const data = parse({
      peers: { ...PEERS_BASE, tiers: [{ tier: 'World tier', entries: [] }] },
    });
    const html = renderToStaticMarkup(renderPeersSection(data) as React.ReactElement);
    expect(html).toContain('class="section-title"');
    expect(html).not.toContain('<table');
    expect(html).toContain('No peer tiers curated');
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

  it('renders from the real captured fixture (KKU-SEQ-0065) without throwing, and drops nothing', () => {
    const data = ProgramDetailDataSchema.parse(FIXTURE);
    expect(data.peers).not.toBeNull();
    const totalCuratedEntries = (data.peers?.tiers ?? []).reduce(
      (sum, t) => sum + t.entries.length,
      0,
    );
    expect(totalCuratedEntries).toBeGreaterThan(0);
    expect(() => renderToStaticMarkup(renderPeersSection(data) as React.ReactElement)).not.toThrow();
    const html = renderToStaticMarkup(renderPeersSection(data) as React.ReactElement);
    expect(html).toContain('<table');
    // Every curated peer entry is a table row — nothing capped per tier —
    // plus 1 header row.
    expect((html.match(/<tr>/g) ?? []).length).toBe(totalCuratedEntries + 1);
  });
});
