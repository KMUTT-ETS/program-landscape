import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ScoreGrid } from '../src/viz/score-grid';

describe('ScoreGrid', () => {
  it('score mode: bands cells and renders a dash with "No data" for null', () => {
    const html = renderToStaticMarkup(
      createElement(ScoreGrid, {
        columns: ['A', 'B'],
        mode: 'score',
        rows: [{ id: 'r1', label: 'คณะ', cells: [30, null] }],
      }),
    );
    expect(html).toContain('bg-danger-subtle');
    expect(html).toContain('title="No data"');
    expect(html).toContain('—');
  });

  it('count mode: blank cell reads "not mapped", counts are shaded', () => {
    const html = renderToStaticMarkup(
      createElement(ScoreGrid, {
        columns: ['S1', 'S2'],
        mode: 'count',
        rows: [{ id: 'r1', label: 'คณะ', cells: [12, null] }],
      }),
    );
    expect(html).toContain('title="Not mapped"');
    expect(html).toContain('>12<');
    expect(html).toContain('oklch(var(--color-data-positive)');
  });

  it('wraps a row with detail in a <details> element', () => {
    const html = renderToStaticMarkup(
      createElement(ScoreGrid, {
        columns: ['A'],
        mode: 'score',
        rows: [{ id: 'r1', label: 'คณะ', cells: [70], detail: createElement('p', null, 'radar here') }],
      }),
    );
    expect(html).toContain('<details');
    expect(html).toContain('radar here');
  });
});
