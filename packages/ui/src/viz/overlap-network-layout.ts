// Deterministic layout for the programme-overlap network (program-overlap.v1).
//
// Pure: no DOM, no Math.random, no Date. The same input always produces the
// same coordinates, so a shared link renders the same picture for every
// reader and the layout can be unit-tested.
//
// Steps
//   1. Keep edges with weight ≥ threshold (one per unordered pair, the
//      heaviest wins) and the nodes they touch. Isolated programmes are not
//      drawn — the network shows overlap, not the portfolio.
//   2. Split into connected components.
//   3. Lay each component out with Fruchterman–Reingold: a fixed number of
//      iterations, a seeded PRNG for the starting positions, heavier edges
//      pulling harder. Then scale it so the mean edge is `edgeLength`.
//   4. Give every node a box that holds its marker and its two-line label,
//      and push overlapping boxes apart until none overlap, so labels never
//      collide inside a component.
//   5. Pack components into rows (shelf packing), strongest component
//      first: ordered by peak edge weight, then size.

export interface NetworkNodeInput {
  id: string;
  /** Short name drawn under the marker. */
  label: string;
  /** Second line, e.g. the faculty code. */
  sublabel?: string;
  facultyCode?: string | null;
}

export interface NetworkEdgeInput {
  a: string;
  b: string;
  /** 0–100. */
  weight: number;
  pairId: string;
  band?: string;
  languageVariant?: boolean;
}

export interface NetworkLayoutOptions {
  /** Edges below this weight are dropped. Default 30. */
  threshold?: number;
  /** Row width for component packing. Default 960. */
  width?: number;
  /** PRNG seed. Default 1. */
  seed?: number;
  /** Target mean edge length inside a component. Default 130. */
  edgeLength?: number;
  /** Force iterations per component. Default 300. */
  iterations?: number;
  nodeRadius?: number;
  labelFontSize?: number;
  sublabelFontSize?: number;
  /** Labels longer than this many visible glyphs are truncated with "…". */
  maxLabelGlyphs?: number;
  /** Space between packed components. Default 40. */
  componentGap?: number;
  /** Minimum clear space between two node boxes. Default 10. */
  labelPadding?: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlacedNode {
  id: string;
  /** Possibly truncated; `fullLabel` is the original. */
  label: string;
  fullLabel: string;
  sublabel: string;
  facultyCode: string | null;
  x: number;
  y: number;
  /** Baselines of the two label lines. */
  labelY: number;
  sublabelY: number;
  /** Marker plus label, in layout coordinates. */
  box: Rect;
  /** Edges at or above the threshold. */
  degree: number;
  component: number;
}

export interface PlacedEdge extends NetworkEdgeInput {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface PlacedComponent extends Rect {
  index: number;
  nodeIds: string[];
  peak: number;
}

export interface NetworkLayout {
  nodes: PlacedNode[];
  edges: PlacedEdge[];
  components: PlacedComponent[];
  width: number;
  height: number;
}

const DEFAULTS = {
  threshold: 30,
  width: 960,
  seed: 1,
  edgeLength: 130,
  iterations: 300,
  nodeRadius: 6,
  labelFontSize: 12,
  sublabelFontSize: 10,
  maxLabelGlyphs: 22,
  componentGap: 40,
  labelPadding: 10,
} as const;

/** Thai combining marks take no horizontal space of their own. */
function isZeroWidth(code: number): boolean {
  return code === 0x0e31 || (code >= 0x0e34 && code <= 0x0e3a) || (code >= 0x0e47 && code <= 0x0e4e);
}

/** Visible glyphs in a string (Thai combining marks excluded). */
export function glyphCount(s: string): number {
  let n = 0;
  for (const ch of s) if (!isZeroWidth(ch.codePointAt(0) ?? 0)) n += 1;
  return n;
}

/** Truncate to `max` visible glyphs, keeping combining marks with their base. */
export function truncateGlyphs(s: string, max: number): string {
  if (glyphCount(s) <= max) return s;
  let out = '';
  let n = 0;
  for (const ch of s) {
    const zw = isZeroWidth(ch.codePointAt(0) ?? 0);
    if (!zw) {
      if (n === max - 1) break;
      n += 1;
    }
    out += ch;
  }
  return `${out.trimEnd()}…`;
}

/** A conservative text width estimate: 0.66em per visible glyph. */
export function estimateTextWidth(s: string, fontSize: number): number {
  return Math.ceil(glyphCount(s) * fontSize * 0.66);
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 — small, fast, seeded. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cmp = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);
const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

interface Pt {
  x: number;
  y: number;
}

/** Fruchterman–Reingold on one component; returns positions centred on 0. */
function forceLayout(
  ids: readonly string[],
  edges: ReadonlyArray<{ i: number; j: number; weight: number }>,
  iterations: number,
  edgeLength: number,
  rand: () => number,
): Pt[] {
  const n = ids.length;
  if (n === 1) return [{ x: 0, y: 0 }];
  if (n === 2) return [
    { x: -edgeLength / 2, y: 0 },
    { x: edgeLength / 2, y: 0 },
  ];
  const k = edgeLength;
  const radius = (k * Math.sqrt(n)) / 2;
  const pos: Pt[] = ids.map((_, i) => {
    const angle = (2 * Math.PI * i) / n;
    return {
      x: radius * Math.cos(angle) + (rand() - 0.5) * k * 0.2,
      y: radius * Math.sin(angle) + (rand() - 0.5) * k * 0.2,
    };
  });
  const t0 = k * Math.sqrt(n) * 0.5;
  for (let it = 0; it < iterations; it++) {
    const temp = t0 * (1 - it / iterations) + 0.5;
    const disp: Pt[] = pos.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = pos[i]!.x - pos[j]!.x;
        let dy = pos[i]!.y - pos[j]!.y;
        let d = Math.hypot(dx, dy);
        if (d < 0.01) {
          // Coincident points: separate along a deterministic direction.
          dx = 0.01 * (i - j);
          dy = 0.01;
          d = Math.hypot(dx, dy);
        }
        const f = (k * k) / d;
        disp[i]!.x += (dx / d) * f;
        disp[i]!.y += (dy / d) * f;
        disp[j]!.x -= (dx / d) * f;
        disp[j]!.y -= (dy / d) * f;
      }
    }
    for (const e of edges) {
      const dx = pos[e.i]!.x - pos[e.j]!.x;
      const dy = pos[e.i]!.y - pos[e.j]!.y;
      const d = Math.max(0.01, Math.hypot(dx, dy));
      // Heavier overlap pulls harder, so strong pairs sit closer.
      const f = ((d * d) / k) * (0.5 + e.weight / 100);
      disp[e.i]!.x -= (dx / d) * f;
      disp[e.i]!.y -= (dy / d) * f;
      disp[e.j]!.x += (dx / d) * f;
      disp[e.j]!.y += (dy / d) * f;
    }
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(disp[i]!.x, disp[i]!.y);
      if (d > 0) {
        const step = Math.min(d, temp);
        pos[i]!.x += (disp[i]!.x / d) * step;
        pos[i]!.y += (disp[i]!.y / d) * step;
      }
    }
  }
  // Centre and normalise the mean edge length.
  const cx = pos.reduce((s, p) => s + p.x, 0) / n;
  const cy = pos.reduce((s, p) => s + p.y, 0) / n;
  for (const p of pos) {
    p.x -= cx;
    p.y -= cy;
  }
  const mean = edges.length
    ? edges.reduce((s, e) => s + Math.hypot(pos[e.i]!.x - pos[e.j]!.x, pos[e.i]!.y - pos[e.j]!.y), 0) / edges.length
    : edgeLength;
  const scale = mean > 0 ? edgeLength / mean : 1;
  for (const p of pos) {
    p.x *= scale;
    p.y *= scale;
  }
  return pos;
}

function overlaps(a: Rect, b: Rect, pad: number): boolean {
  return a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
}

/** True when two rectangles intersect (touching edges do not count). */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return overlaps(a, b, 0);
}

export function layoutOverlapNetwork(
  nodesIn: readonly NetworkNodeInput[],
  edgesIn: readonly NetworkEdgeInput[],
  options: NetworkLayoutOptions = {},
): NetworkLayout {
  const o = { ...DEFAULTS, ...options };
  const known = new Map(nodesIn.map((n) => [n.id, n]));

  // 1. Edges at/above threshold, one per unordered pair (heaviest wins).
  const best = new Map<string, NetworkEdgeInput>();
  for (const e of edgesIn) {
    if (e.a === e.b || !known.has(e.a) || !known.has(e.b)) continue;
    if (!Number.isFinite(e.weight) || e.weight < o.threshold) continue;
    const key = pairKey(e.a, e.b);
    const prev = best.get(key);
    if (!prev || e.weight > prev.weight || (e.weight === prev.weight && cmp(e.pairId, prev.pairId) < 0)) {
      best.set(key, e);
    }
  }
  const edges = [...best.values()].sort((x, y) => cmp(pairKey(x.a, x.b), pairKey(y.a, y.b)));
  if (edges.length === 0) return { nodes: [], edges: [], components: [], width: 0, height: 0 };

  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.a, (degree.get(e.a) ?? 0) + 1);
    degree.set(e.b, (degree.get(e.b) ?? 0) + 1);
  }
  const ids = [...degree.keys()].sort(cmp);

  // 2. Connected components (union–find).
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (parent.get(c) !== r) {
      const next = parent.get(c)!;
      parent.set(c, r);
      c = next;
    }
    return r;
  };
  for (const e of edges) {
    const ra = find(e.a);
    const rb = find(e.b);
    if (ra !== rb) parent.set(cmp(ra, rb) < 0 ? rb : ra, cmp(ra, rb) < 0 ? ra : rb);
  }
  const groups = new Map<string, string[]>();
  for (const id of ids) {
    const r = find(id);
    const g = groups.get(r);
    if (g) g.push(id);
    else groups.set(r, [id]);
  }
  const comps = [...groups.values()].map((members) => {
    const set = new Set(members);
    const compEdges = edges.filter((e) => set.has(e.a));
    return { members, compEdges, peak: Math.max(...compEdges.map((e) => e.weight)) };
  });
  comps.sort(
    (x, y) => y.peak - x.peak || y.members.length - x.members.length || cmp(x.members[0]!, y.members[0]!),
  );

  const r = o.nodeRadius;
  const labelGap = 4;
  const lineGap = 2;
  const placedNodes: PlacedNode[] = [];
  const placedComps: PlacedComponent[] = [];
  let cursorX = 0;
  let cursorY = 0;
  let rowH = 0;
  let maxRight = 0;

  comps.forEach((comp, ci) => {
    const index = new Map(comp.members.map((id, i) => [id, i]));
    const rand = prng((o.seed ^ hashString(comp.members.join('|'))) >>> 0);
    const pos = forceLayout(
      comp.members,
      comp.compEdges.map((e) => ({ i: index.get(e.a)!, j: index.get(e.b)!, weight: e.weight })),
      o.iterations,
      o.edgeLength,
      rand,
    );

    // 3. Boxes: marker on top, label and sublabel centred underneath.
    const local = comp.members.map((id, i) => {
      const input = known.get(id)!;
      const label = truncateGlyphs(input.label, o.maxLabelGlyphs);
      const sublabel = input.sublabel ?? '';
      const textW = Math.max(
        estimateTextWidth(label, o.labelFontSize),
        sublabel ? estimateTextWidth(sublabel, o.sublabelFontSize) : 0,
      );
      const w = Math.max(textW, 2 * r);
      const h = 2 * r + labelGap + o.labelFontSize + (sublabel ? lineGap + o.sublabelFontSize : 0) + 2;
      return { id, input, label, sublabel, w, h, cx: pos[i]!.x, cy: pos[i]!.y };
    });
    const boxOf = (n: (typeof local)[number]): Rect => ({ x: n.cx - n.w / 2, y: n.cy - r, w: n.w, h: n.h });

    // 4. Push overlapping boxes apart along the axis of least overlap.
    const pad = o.labelPadding;
    for (let pass = 0; pass < 400; pass++) {
      let moved = false;
      for (let i = 0; i < local.length; i++) {
        for (let j = i + 1; j < local.length; j++) {
          const A = boxOf(local[i]!);
          const B = boxOf(local[j]!);
          if (!overlaps(A, B, pad)) continue;
          moved = true;
          const ox = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x) + pad;
          const oy = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y) + pad;
          const dirX = local[i]!.cx < local[j]!.cx || (local[i]!.cx === local[j]!.cx && i < j) ? -1 : 1;
          const dirY = local[i]!.cy < local[j]!.cy || (local[i]!.cy === local[j]!.cy && i < j) ? -1 : 1;
          if (ox <= oy) {
            local[i]!.cx += (dirX * ox) / 2 + dirX * 0.01;
            local[j]!.cx -= (dirX * ox) / 2 + dirX * 0.01;
          } else {
            local[i]!.cy += (dirY * oy) / 2 + dirY * 0.01;
            local[j]!.cy -= (dirY * oy) / 2 + dirY * 0.01;
          }
        }
      }
      if (!moved) break;
    }

    // Component bounds, then translate to its packed slot.
    const boxes = local.map(boxOf);
    const minX = Math.min(...boxes.map((b) => b.x));
    const minY = Math.min(...boxes.map((b) => b.y));
    const w = Math.max(...boxes.map((b) => b.x + b.w)) - minX;
    const h = Math.max(...boxes.map((b) => b.y + b.h)) - minY;

    // 5. Shelf packing.
    if (cursorX > 0 && cursorX + w > o.width) {
      cursorX = 0;
      cursorY += rowH + o.componentGap;
      rowH = 0;
    }
    const ox = cursorX - minX;
    const oy = cursorY - minY;
    for (const n of local) {
      const x = n.cx + ox;
      const y = n.cy + oy;
      const labelY = y + r + labelGap + o.labelFontSize * 0.85;
      placedNodes.push({
        id: n.id,
        label: n.label,
        fullLabel: n.input.label,
        sublabel: n.sublabel,
        facultyCode: n.input.facultyCode ?? null,
        x,
        y,
        labelY,
        sublabelY: labelY + lineGap + o.sublabelFontSize,
        box: { x: x - n.w / 2, y: y - r, w: n.w, h: n.h },
        degree: degree.get(n.id) ?? 0,
        component: ci,
      });
    }
    placedComps.push({ index: ci, nodeIds: [...comp.members], peak: comp.peak, x: cursorX, y: cursorY, w, h });
    cursorX += w + o.componentGap;
    rowH = Math.max(rowH, h);
    maxRight = Math.max(maxRight, cursorX - o.componentGap);
  });

  const at = new Map(placedNodes.map((n) => [n.id, n]));
  const placedEdges: PlacedEdge[] = edges.map((e) => ({
    ...e,
    x1: at.get(e.a)!.x,
    y1: at.get(e.a)!.y,
    x2: at.get(e.b)!.x,
    y2: at.get(e.b)!.y,
  }));

  return {
    nodes: placedNodes,
    edges: placedEdges,
    components: placedComps,
    width: Math.ceil(maxRight),
    height: Math.ceil(cursorY + rowH),
  };
}
