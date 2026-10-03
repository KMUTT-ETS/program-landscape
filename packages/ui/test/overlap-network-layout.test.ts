import { describe, expect, it } from 'vitest';
import {
  glyphCount,
  layoutOverlapNetwork,
  rectsOverlap,
  truncateGlyphs,
  type NetworkEdgeInput,
  type NetworkNodeInput,
} from '../src/viz/overlap-network-layout';

const node = (id: string, label = `Programme ${id}`): NetworkNodeInput => ({ id, label, sublabel: 'SC' });
const edge = (a: string, b: string, weight: number): NetworkEdgeInput => ({ a, b, weight, pairId: `${a}-${b}` });

// Three components: a 5-node cluster, a pair, a triangle; plus isolated nodes
// and sub-threshold edges.
const nodes: NetworkNodeInput[] = [
  ...['a', 'b', 'c', 'd', 'e'].map((id) => node(id, `วิทยาศาสตรบัณฑิต (${id}) สาขาวิชาที่ยาวมาก`)),
  node('p'),
  node('q'),
  node('x'),
  node('y'),
  node('z'),
  node('lonely'),
];
const edges: NetworkEdgeInput[] = [
  edge('a', 'b', 72),
  edge('b', 'c', 55),
  edge('c', 'd', 41),
  edge('d', 'e', 35),
  edge('a', 'c', 33),
  edge('p', 'q', 88),
  edge('x', 'y', 50),
  edge('y', 'z', 31),
  edge('x', 'z', 30),
  edge('lonely', 'a', 12),
];

describe('layoutOverlapNetwork', () => {
  it('returns an empty layout for empty input or when nothing clears the threshold', () => {
    expect(layoutOverlapNetwork([], [])).toEqual({ nodes: [], edges: [], components: [], width: 0, height: 0 });
    const l = layoutOverlapNetwork(nodes, [edge('a', 'b', 10)]);
    expect(l.nodes).toHaveLength(0);
    expect(l.width).toBe(0);
  });

  it('is deterministic', () => {
    const one = layoutOverlapNetwork(nodes, edges);
    const two = layoutOverlapNetwork(nodes, [...edges].reverse());
    expect(two).toEqual(one);
  });

  it('places every node with an edge at or above the threshold, and only those', () => {
    const l = layoutOverlapNetwork(nodes, edges);
    expect(l.nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'p', 'q', 'x', 'y', 'z']);
    for (const n of l.nodes) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
      expect(n.box.x).toBeGreaterThanOrEqual(-0.001);
      expect(n.box.y).toBeGreaterThanOrEqual(-0.001);
      expect(n.box.x + n.box.w).toBeLessThanOrEqual(l.width + 0.001);
      expect(n.box.y + n.box.h).toBeLessThanOrEqual(l.height + 0.001);
    }
    expect(l.edges).toHaveLength(9);
    expect(l.nodes.find((n) => n.id === 'a')?.degree).toBe(2);
  });

  it('respects a higher threshold', () => {
    const l = layoutOverlapNetwork(nodes, edges, { threshold: 50 });
    expect(l.nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'c', 'p', 'q', 'x', 'y']);
  });

  it('orders components by peak edge weight and keeps them apart', () => {
    const l = layoutOverlapNetwork(nodes, edges);
    expect(l.components.map((c) => c.peak)).toEqual([88, 72, 50]);
    expect(l.components[0]!.nodeIds).toEqual(['p', 'q']);
    for (let i = 0; i < l.components.length; i++) {
      for (let j = i + 1; j < l.components.length; j++) {
        expect(rectsOverlap(l.components[i]!, l.components[j]!)).toBe(false);
      }
    }
  });

  it('wraps components onto new rows when the row is full', () => {
    const l = layoutOverlapNetwork(nodes, edges, { width: 200 });
    const ys = new Set(l.components.map((c) => c.y));
    expect(ys.size).toBeGreaterThan(1);
  });

  it('never lets two label boxes overlap', () => {
    const l = layoutOverlapNetwork(nodes, edges);
    for (let i = 0; i < l.nodes.length; i++) {
      for (let j = i + 1; j < l.nodes.length; j++) {
        expect(rectsOverlap(l.nodes[i]!.box, l.nodes[j]!.box)).toBe(false);
      }
    }
  });

  it('keeps one edge per pair (the heaviest) and drops self-loops and unknown nodes', () => {
    const l = layoutOverlapNetwork(
      [node('a'), node('b')],
      [edge('a', 'b', 40), { ...edge('b', 'a', 60), pairId: 'dup' }, edge('a', 'a', 90), edge('a', 'ghost', 90)],
    );
    expect(l.edges).toHaveLength(1);
    expect(l.edges[0]!.pairId).toBe('dup');
  });

  it('edge endpoints sit on their nodes', () => {
    const l = layoutOverlapNetwork(nodes, edges);
    const at = new Map(l.nodes.map((n) => [n.id, n]));
    for (const e of l.edges) {
      expect(e.x1).toBe(at.get(e.a)!.x);
      expect(e.y2).toBe(at.get(e.b)!.y);
    }
  });
});

describe('glyph helpers', () => {
  it('does not count Thai combining marks', () => {
    expect(glyphCount('ฟิสิกส์')).toBe(4);
    expect(glyphCount('Physics')).toBe(7);
  });

  it('truncates by visible glyphs and adds an ellipsis', () => {
    expect(truncateGlyphs('Physics', 10)).toBe('Physics');
    expect(truncateGlyphs('Applied Physics', 6)).toBe('Appli…');
    expect(glyphCount(truncateGlyphs('วิทยาศาสตร์แบตเตอรี่และพลังงานใหม่', 10))).toBe(10);
  });
});
