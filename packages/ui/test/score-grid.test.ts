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

  it('shows a chevron only on rows with detail', () => {
    const html = renderToStaticMarkup(
      createElement(ScoreGrid, {
        columns: ['A'],
        mode: 'score',
        rows: [
          { id: 'r1', label: 'with', cells: [70], detail: createElement('p', null, 'x') },
          { id: 'r2', label: 'without', cells: [70] },
        ],
      }),
    );
    expect(html.split('▸').length - 1).toBe(1);
  });

  it('treats NaN and Infinity like null', () => {
    const html = renderToStaticMarkup(
      createElement(ScoreGrid, {
        columns: ['A', 'B'],
        mode: 'score',
        rows: [{ id: 'r1', label: 'r', cells: [Number.NaN, Number.POSITIVE_INFINITY] }],
      }),
    );
    expect(html).toContain('title="No data"');
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('Infinity');
  });

  it('count mode ignores non-finite values for the max and clamps negatives', () => {
    const html = renderToStaticMarkup(
      createElement(ScoreGrid, {
        columns: ['A', 'B', 'C'],
        mode: 'count',
        rows: [{ id: 'r1', label: 'r', cells: [10, Number.POSITIVE_INFINITY, -5] }],
      }),
    );
    expect(html).toContain('/ 0.72)');
    expect(html).toContain('/ 0.12)');
    expect(html).toContain('title="Not mapped"');
  });
});
