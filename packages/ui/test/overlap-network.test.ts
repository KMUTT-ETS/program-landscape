import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OverlapNetwork, edgeStyle } from '../src/viz/overlap-network';

const nodes = [
  { id: 'p1', label: 'ฟิสิกส์', sublabel: 'SC' },
  { id: 'p2', label: 'ฟิสิกส์ประยุกต์', sublabel: 'SC' },
  { id: 'p3', label: 'นิติศาสตร์', sublabel: 'LA' },
  { id: 'p4', label: 'เภสัชศาสตร์', sublabel: 'PHA' },
  { id: 'p5', label: 'เภสัชศาสตร์', sublabel: 'PHA · Intl' },
];
const edges = [
  { a: 'p1', b: 'p2', weight: 74, pairId: 'x12', details: [{ label: 'Structure', value: '60' }] },
  { a: 'p4', b: 'p5', weight: 92, pairId: 'x45', languageVariant: true },
  { a: 'p1', b: 'p3', weight: 12, pairId: 'x13' },
];

describe('edgeStyle', () => {
  it('steps width and opacity together by band', () => {
    expect(edgeStyle(30)).toEqual(edgeStyle(49));
    expect(edgeStyle(49).width).toBeLessThan(edgeStyle(50).width);
    expect(edgeStyle(69).opacity).toBeLessThan(edgeStyle(70).opacity);
    expect(edgeStyle(70)).toEqual(edgeStyle(100));
  });
});

describe('OverlapNetwork', () => {
  it('renders the empty state when no edge clears the threshold', () => {
    const html = renderToStaticMarkup(createElement(OverlapNetwork, { nodes, edges, threshold: 95 }));
    expect(html).toContain('No pair reaches overlap index 95 or more here.');
    expect(html).not.toContain('<svg viewBox');
  });

  it('draws only nodes with a qualifying edge, with focusable nodes and edges', () => {
    const html = renderToStaticMarkup(createElement(OverlapNetwork, { nodes, edges }));
    expect(html).toContain('ฟิสิกส์ประยุกต์');
    expect(html).not.toContain('นิติศาสตร์');
    // 4 nodes + 2 edges are buttons.
    expect(html.match(/role="button"/g)).toHaveLength(6);
    expect(html.match(/tabindex="0"/g)).toHaveLength(6);
    expect(html).toContain('Thai / international versions');
    expect(html).toContain('stroke-dasharray="6 4"');
    expect(html).toContain('Programmes with no pair at <span class="tabular-nums">30</span> or more are not drawn.');
  });

  it('marks the selected node as pressed and labels it for clearing', () => {
    const html = renderToStaticMarkup(createElement(OverlapNetwork, { nodes, edges, selectedNodeId: 'p1' }));
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('Press Enter to clear the filter');
  });

  it('uses tokens, never literal colours, for the halo', () => {
    const html = renderToStaticMarkup(createElement(OverlapNetwork, { nodes, edges }));
    expect(html).toContain('oklch(var(--color-surface-1))');
    expect(html).not.toMatch(/#[0-9a-f]{6}/i);
  });
});
