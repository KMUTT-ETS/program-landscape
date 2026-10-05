import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BubbleMatrix } from '../src/viz/bubble-matrix';

const bubbles = [{ id: 'a', label: 'ก', x: 20, y: 80, size: 10, color: 1 }];
const base = { bubbles, axisXLabel: 'X', axisYLabel: 'Y', width: 400, height: 300 };
const dashed = (html: string) => (html.match(/stroke-dasharray="3 3"/g) ?? []).length;

describe('BubbleMatrix guides', () => {
  it('keeps the 50/50 cross-hairs by default', () => {
    expect(dashed(renderToStaticMarkup(createElement(BubbleMatrix, base)))).toBe(2);
  });
  it('hides the cross-hairs when split is null', () => {
    expect(dashed(renderToStaticMarkup(createElement(BubbleMatrix, { ...base, split: null })))).toBe(0);
  });
  it('moves the cross-hairs to the given split', () => {
    // plot: M.left 60, W = 400 - 60 - 40 = 300 → x at 25% = 60 + 75 = 135
    const html = renderToStaticMarkup(createElement(BubbleMatrix, { ...base, split: { x: 25, y: 50 } }));
    expect(html).toContain('x1="135"');
  });
  it('draws the diagonal and the ticks when asked', () => {
    const html = renderToStaticMarkup(
      createElement(BubbleMatrix, {
        ...base,
        split: null,
        diagonal: true,
        xTicks: [{ at: 50, label: '1×' }],
        yTicks: [{ at: 0, label: '-50%' }],
      }),
    );
    expect(html).toContain('data-guide="diagonal"');
    expect(html).toContain('>1×<');
    expect(html).toContain('>-50%<');
  });
  it('uses the bubble tone over the diverging colour', () => {
    const html = renderToStaticMarkup(
      createElement(BubbleMatrix, { ...base, bubbles: [{ ...bubbles[0]!, color: 1, tone: 'warning' as const }] }),
    );
    expect(html).toContain('data-tone="warning"');
  });
});

describe('BubbleMatrix maxRadius', () => {
  const radii = (html: string) => [...html.matchAll(/<circle[^>]*? r="([\d.]+)"/g)].map((m) => Number(m[1]));
  it('defaults to a 32px largest bubble', () => {
    expect(Math.max(...radii(renderToStaticMarkup(createElement(BubbleMatrix, base))))).toBe(32);
  });
  it('caps the largest bubble at maxRadius', () => {
    expect(Math.max(...radii(renderToStaticMarkup(createElement(BubbleMatrix, { ...base, maxRadius: 16 }))))).toBe(16);
  });
});
