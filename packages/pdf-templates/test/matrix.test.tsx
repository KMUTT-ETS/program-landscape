import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Matrix } from '../src/charts/matrix';
import type { MatrixRow } from '../src/charts/matrix';

const PROV = { source: 'peer-programs-scraper', runDate: '12 Aug 2026', method: 'benchmarking.v1' };

// Short by design: a matrix column is a narrow slot (see ROTATE_COLUMN_THRESHOLD
// below), so real callers pass abbreviated skill labels here, not full phrases —
// the same discipline BarsStacked's legend labels already require.
const COLUMNS = ['Python', 'SQL', 'AI/ML', 'Cloud', 'UX'];

// Domain max across the whole matrix is 90 (Mahidol's ML — deliberately NOT
// the first row) so the proportionality test below exercises the shared,
// matrix-wide domain rather than a coincidentally row-local one. Each row
// also carries at least one null cell so the empty-vs-zero distinction is
// exercised alongside the normal render path, not only in its own fixture.
const ROWS: readonly MatrixRow[] = [
  { label: 'Chulalongkorn University', cells: [80, 60, 40, null, 20] },
  { label: 'Mahidol University', cells: [50, 0, null, 90, 10] },
  { label: 'Thammasat University', cells: [30, 30, 30, 30, 30] },
];

function matrixCellFills(html: string): string[] {
  return [...html.matchAll(/<rect class="matrix-cell"[^>]*fill="(#[0-9A-F]{6})"/g)].map((m) => m[1] ?? '');
}

function redChannel(hex: string): number {
  return parseInt(hex.slice(1, 3), 16);
}

describe('Matrix', () => {
  it('draws one cell mark per row×column pair, null or otherwise', () => {
    const html = renderToStaticMarkup(<Matrix columns={COLUMNS} rows={ROWS} provenance={PROV} title="Peer coverage" />);
    const normal = html.match(/class="matrix-cell"/g) ?? [];
    const nulls = html.match(/class="matrix-cell-null"/g) ?? [];
    expect(normal).toHaveLength(13); // 15 cells total, 2 null (row 0 & row 1)
    expect(nulls).toHaveLength(2);
  });

  it('labels every row and every column', () => {
    const html = renderToStaticMarkup(<Matrix columns={COLUMNS} rows={ROWS} provenance={PROV} title="Peer coverage" />);
    for (const row of ROWS) expect(html).toContain(row.label);
    for (const column of COLUMNS) expect(html).toContain(column);
  });

  // "Larger mark" for a grid heatmap is a more saturated fill, not a bigger
  // shape — checked precisely via the red channel, which strictly decreases
  // toward the full series colour (indigo, red channel well below white's)
  // as the cell's share of the shared [0, matrix-wide max] domain grows.
  it('renders a more saturated fill for a larger cell value', () => {
    const html = renderToStaticMarkup(<Matrix columns={COLUMNS} rows={ROWS} provenance={PROV} title="Peer coverage" />);
    const fills = matrixCellFills(html);
    expect(fills).toHaveLength(13);
    // Row 0's non-null cells render in document order: 80, 60, 40, 20.
    const [r80, r60, r40, r20] = fills.slice(0, 4).map(redChannel);
    if (r80 === undefined || r60 === undefined || r40 === undefined || r20 === undefined) {
      throw new Error('fixture bug: missing fill');
    }
    expect(r80).toBeLessThan(r60);
    expect(r60).toBeLessThan(r40);
    expect(r40).toBeLessThan(r20);
  });

  it('renders the empty state rather than a grid with nothing on it', () => {
    const noRows = renderToStaticMarkup(
      <Matrix columns={COLUMNS} rows={[]} provenance={PROV} title="Peer coverage" emptyNote="No peer coverage rows" />,
    );
    expect(noRows).toContain('No peer coverage rows');
    expect(noRows).not.toContain('matrix-cell');

    const noColumns = renderToStaticMarkup(
      <Matrix columns={[]} rows={ROWS} provenance={PROV} title="Peer coverage" emptyNote="No skill columns" />,
    );
    expect(noColumns).toContain('No skill columns');
    expect(noColumns).not.toContain('matrix-cell');
  });

  // An all-zero matrix must not divide by zero (domainMax = 0) and produce
  // NaN coordinates or an NaN-tinted fill.
  it('survives an all-zero matrix', () => {
    const html = renderToStaticMarkup(
      <Matrix columns={['A', 'B']} rows={[{ label: 'Row', cells: [0, 0] }]} provenance={PROV} title="Peer coverage" />,
    );
    expect(html).not.toContain('NaN');
  });

  it('matches the golden snapshot', () => {
    expect(
      renderToStaticMarkup(<Matrix columns={COLUMNS} rows={ROWS} provenance={PROV} title="Peer coverage" />),
    ).toMatchSnapshot();
  });

  // The single most important behaviour in this primitive: a null cell (we
  // do not know whether the peer teaches this skill) must never look like a
  // zero cell (we know they do not). Rendering both and diffing proves the
  // distinction actually shows up in markup, not just that the code has an if.
  it('renders a null cell visually distinct from a zero cell', () => {
    const withZero = renderToStaticMarkup(
      <Matrix columns={['A', 'B']} rows={[{ label: 'Row', cells: [0, 10] }]} provenance={PROV} title="Peer coverage" />,
    );
    const withNull = renderToStaticMarkup(
      <Matrix columns={['A', 'B']} rows={[{ label: 'Row', cells: [null, 10] }]} provenance={PROV} title="Peer coverage" />,
    );
    expect(withZero).not.toEqual(withNull);

    // The zero cell renders as a normal (solid-fill) cell...
    expect(withZero.match(/class="matrix-cell"/g) ?? []).toHaveLength(2);
    expect(withZero).not.toContain('class="matrix-cell-null"');

    // ...but the null cell gets the distinct hatched/dashed treatment, and
    // does NOT also render a plain cell in the same slot.
    expect(withNull.match(/class="matrix-cell"/g) ?? []).toHaveLength(1); // only the '10' cell
    expect(withNull.match(/class="matrix-cell-null"/g) ?? []).toHaveLength(1);
  });

  // Rotation is content-driven: 13 columns of short "Skill N" headers (each
  // wider than the default 10mm columnWidthMm once you include the digit)
  // must rotate, while the 5 short abbreviated headers in COLUMNS (which fit
  // upright at 10mm) must not — regardless of the fact that one fixture has
  // more than 12 columns and the other fewer than 12.
  it('rotates headers that do not fit upright, not headers past a column-count threshold', () => {
    const columns13 = Array.from({ length: 13 }, (_, i) => `Skill ${i + 1}`);
    const rows13 = [{ label: 'Peer A', cells: Array.from({ length: 13 }, (_, i) => i * 5) }];
    const wide = renderToStaticMarkup(<Matrix columns={columns13} rows={rows13} provenance={PROV} title="Peer coverage" />);
    expect(wide).toMatch(/class="matrix-column-header"[^>]*transform="rotate\(/);

    const narrow = renderToStaticMarkup(<Matrix columns={COLUMNS} rows={ROWS} provenance={PROV} title="Peer coverage" />);
    expect(narrow).not.toContain('rotate(');
  });

  // A short (or long) cells array would silently shift every subsequent
  // cell in that row into the wrong column — a confidently wrong chart,
  // not a cosmetic gap. Must fail loudly instead.
  it("throws when a row's cells length does not match the column count", () => {
    const badRows = [{ label: 'Peer A', cells: [1, 2, 3] }]; // COLUMNS has 5 entries
    expect(() =>
      renderToStaticMarkup(<Matrix columns={COLUMNS} rows={badRows} provenance={PROV} title="Peer coverage" />),
    ).toThrow(RangeError);
  });

  // The column axis is horizontal and bounded by widthMm, same posture as
  // BarsStacked's / Waterfall's column-axis guard — a column count that
  // doesn't fit must fail loudly rather than silently overflow the page.
  it('throws when the column count does not fit within widthMm', () => {
    const columns13 = Array.from({ length: 13 }, (_, i) => `Skill ${i + 1}`);
    const rows13 = [{ label: 'Peer A', cells: Array.from({ length: 13 }, (_, i) => i * 5) }];
    expect(() =>
      renderToStaticMarkup(
        <Matrix columns={columns13} rows={rows13} provenance={PROV} title="Peer coverage" columnWidthMm={20} />,
      ),
    ).toThrow(RangeError);
  });

  // A negative cell would clamp to fraction 0 on the single-hue ramp and
  // render visually identical to a true zero — silently erasing the
  // difference between "none" and "negative". Fail loudly instead.
  it('throws when a cell value is negative', () => {
    const badRows = [{ label: 'Peer A', cells: [10, -5, 20, null, 0] }];
    expect(() =>
      renderToStaticMarkup(<Matrix columns={COLUMNS} rows={badRows} provenance={PROV} title="Peer coverage" />),
    ).toThrow(RangeError);
  });

  // The rotation decision is content-driven (does the longest header fit
  // upright in its column?), not count-driven. Six columns of realistic full
  // skill names — short enough in count to have stayed upright under the old
  // ROTATE_COLUMN_THRESHOLD > 12 rule — must still rotate here because the
  // labels themselves (including a Thai phrase) are too wide for the default
  // columnWidthMm. Before the fix this fixture had NO working columnWidthMm:
  // narrow widths hit fitLabel's 85% floor, wide-enough widths blew the
  // neededWidth > widthMm guard.
  // Gotenberg renders a static PDF — the <title> tooltip a reader might rely
  // on in a browser never appears there. A Council reader must be able to
  // recover a number from the printed page by looking, not hovering.
  it('renders each cell value as visible text, not only inside a <title>', () => {
    const html = renderToStaticMarkup(<Matrix columns={COLUMNS} rows={ROWS} provenance={PROV} title="Peer coverage" />);
    // Every non-null cell value appears as its own visible text node, i.e.
    // as `>80<` in the markup — not merely somewhere inside a <title> tag
    // (which also contains the number, e.g. "Chulalongkorn University ×
    // Python: 80", but that text is never rendered/visible in the PDF).
    for (const row of ROWS) {
      for (const value of row.cells) {
        if (value === null) continue;
        expect(html).toContain(`>${value}<`);
      }
    }
    // Confirms the values are living outside the <title> elements: stripping
    // every <title>...</title> block must still leave every value visible.
    const withoutTitles = html.replace(/<title>.*?<\/title>/g, '');
    expect(withoutTitles).toContain('>80<');
    expect(withoutTitles).toContain('>40<');
  });

  // A reader who can see relative shading but has no scale to calibrate it
  // against cannot recover what a shade means — the exact failure this
  // legend exists to prevent.
  it('renders a colour-scale legend spanning the domain the ramp uses', () => {
    const html = renderToStaticMarkup(<Matrix columns={COLUMNS} rows={ROWS} provenance={PROV} title="Peer coverage" />);
    expect(html).toContain('matrix-legend');
    // The ramp's domain is [0, domain max] (90, from Mahidol's ML cell) —
    // the legend must show both ends with their swatches, not an arbitrary
    // or truncated range.
    expect(html).toContain('>0<');
    expect(html).toContain('>90<');
    // At least two swatch rects in the legend (min + max), distinct from the
    // per-cell matrix-cell rects.
    const legendMatch = /<g class="matrix-legend">([\s\S]*?)<\/g>/.exec(html);
    if (!legendMatch?.[1]) throw new Error('fixture bug: no matrix-legend group found');
    expect(legendMatch[1].match(/<rect/g) ?? []).toHaveLength(2);
  });

  // A cell value that genuinely cannot fit its slot (an unrealistically
  // narrow column) is omitted rather than overflowing or corrupting layout —
  // the <title> still carries it, so nothing is silently lost, only the
  // in-cell rendering is skipped when it would not read cleanly.
  it('omits the in-cell text (but keeps the title) when a value genuinely does not fit', () => {
    const html = renderToStaticMarkup(
      <Matrix columns={['A', 'B']} rows={[{ label: 'Row', cells: [123456789, 2] }]}
              provenance={PROV} title="Peer coverage" columnWidthMm={3} labelWidthMm={4} />,
    );
    expect(html).not.toContain('NaN');
    expect(html).toContain('<title>Row × A: 123456789</title>'); // still present, via <title>
    // Not rendered as visible cell text specifically — the legend's own max
    // label legitimately renders the same number as its own <text>, so the
    // assertion must be scoped to the per-cell "matrix-cell-value" class
    // rather than a blanket substring check across the whole document.
    expect(html).not.toMatch(/class="matrix-cell-value"[^>]*>123456789</);
    // The other cell's short value DOES fit and must still render in-cell.
    expect(html).toMatch(/class="matrix-cell-value"[^>]*>2</);
  });

  it('rotates headers for few columns with long realistic names, including Thai', () => {
    const realisticColumns = [
      'Machine learning',
      'Data engineering',
      'ทักษะการวิเคราะห์ข้อมูล',
      'Cloud infrastructure',
      'UX research',
      'Change management',
    ];
    const realisticRows: readonly MatrixRow[] = [
      { label: 'KKU-SEQ-0001', cells: [80, 60, 40, 20, 10, 90] },
      { label: 'KKU-SEQ-0002', cells: [30, null, 70, 50, 20, 10] },
    ];
    const html = renderToStaticMarkup(
      <Matrix columns={realisticColumns} rows={realisticRows} provenance={PROV} title="Skill coverage" />,
    );
    expect(html).toMatch(/class="matrix-column-header"[^>]*transform="rotate\(/);
    for (const column of realisticColumns) expect(html).toContain(column);
  });
});
