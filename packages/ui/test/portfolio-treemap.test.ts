// packages/ui/test/portfolio-treemap.test.ts
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PortfolioTreemap, squarify } from '../src/viz/portfolio-treemap';

describe('squarify', () => {
  const rect = { x: 0, y: 0, w: 100, h: 50 };
  it('gives every value an area proportional to it and stays inside the rect', () => {
    const out = squarify([60, 30, 10], rect);
    const area = out.map((r) => r.w * r.h);
    expect(area[0]! / area[1]!).toBeCloseTo(2, 5);
    expect(area.reduce((a, b) => a + b, 0)).toBeCloseTo(5000, 5);
    for (const r of out) {
      expect(r.x).toBeGreaterThanOrEqual(-1e-6);
      expect(r.y).toBeGreaterThanOrEqual(-1e-6);
      expect(r.x + r.w).toBeLessThanOrEqual(100 + 1e-6);
      expect(r.y + r.h).toBeLessThanOrEqual(50 + 1e-6);
    }
  });
  it('keeps input order and gives zero values zero area', () => {
    const out = squarify([0, 5], rect);
    expect(out[0]!.w * out[0]!.h).toBe(0);
    expect(out[1]!.w * out[1]!.h).toBeCloseTo(5000, 5);
  });
  it('treats non-finite values as zero', () => {
    const out = squarify([NaN, 5], rect);
    expect(out[0]!.w * out[0]!.h).toBe(0);
    expect(out[1]!.w * out[1]!.h).toBeCloseTo(5000, 5);
    for (const r of out) for (const n of [r.x, r.y, r.w, r.h]) expect(Number.isNaN(n)).toBe(false);
  });
  it('returns empty rects for an empty or zero total', () => {
    expect(squarify([], rect)).toEqual([]);
    expect(squarify([0, 0], rect).every((r) => r.w === 0)).toBe(true);
  });
});

describe('PortfolioTreemap', () => {
  const nodes = [
    {
      id: 'f1', label: 'คณะแพทยศาสตร์', sublabel: 'Medicine', value: 300,
      children: [
        { id: 'p1', label: 'แพทยศาสตรบัณฑิต', sublabel: 'KKU-SEQ-0001', value: 200, tone: 'positive' as const, href: '/programs/p1' },
        { id: 'p2', label: 'กายภาพบำบัด', sublabel: 'KKU-SEQ-0002', value: 100, tone: 'neutral' as const, href: '/programs/p2', hatched: true },
      ],
    },
  ];
  it('renders faculty and programme labels with links to the Deep-Dive', () => {
    const html = renderToStaticMarkup(createElement(PortfolioTreemap, { nodes, height: 400 }));
    expect(html).toContain('คณะแพทยศาสตร์');
    expect(html).toContain('href="/programs/p1"');
    expect(html).toContain('data-hatched="true"');
  });
  it('does not hide links and buttons behind role="img"', () => {
    const html = renderToStaticMarkup(createElement(PortfolioTreemap, { nodes, height: 400 }));
    expect(html).not.toContain('role="img"');
    expect(html).toContain('role="group"');
    expect(html).toContain('href="/programs/p1"');
    expect(html).toContain('role="button"');
    expect(html).not.toMatch(/url\(#[^)]*:/);
  });
  it('renders the empty state with no nodes', () => {
    const html = renderToStaticMarkup(createElement(PortfolioTreemap, { nodes: [], height: 400, emptyLabel: 'Nothing to show.' }));
    expect(html).toContain('Nothing to show.');
  });
});
