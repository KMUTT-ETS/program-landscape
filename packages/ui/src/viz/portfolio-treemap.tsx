'use client';

import * as React from 'react';
import { useChartPalette } from './chart-theme';

// Faculty → programme treemap. Inline SVG (Recharts' Treemap renders nothing
// during server rendering) with a pure squarified layout, so the geometry is
// testable on its own. Area = the value the caller supplies (active students
// on the Executive Landscape); fill = a categorical tone; `hatched` marks a
// programme with no score so a missing score never reads as a colour.

export type TreemapTone = 'positive' | 'warning' | 'negative' | 'neutral';

export interface TreemapLeaf {
  id: string;
  label: string;
  sublabel?: string;
  value: number;
  tone: TreemapTone;
  href?: string;
  hatched?: boolean;
}

export interface TreemapGroup {
  id: string;
  label: string;
  sublabel?: string;
  value: number;
  children: TreemapLeaf[];
}

export interface TreemapRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Squarified treemap layout. Returns one rect per value, in input order. */
export function squarify(values: readonly number[], rect: TreemapRect): TreemapRect[] {
  const out: TreemapRect[] = values.map(() => ({ x: rect.x, y: rect.y, w: 0, h: 0 }));
  const total = values.reduce((s, v) => s + Math.max(0, v), 0);
  if (total <= 0 || rect.w <= 0 || rect.h <= 0) return out;
  const scale = (rect.w * rect.h) / total;
  const items = values
    .map((v, i) => ({ i, area: Math.max(0, v) * scale }))
    .filter((d) => d.area > 0)
    .sort((a, b) => b.area - a.area);
  let free: TreemapRect = { ...rect };

  const worst = (row: typeof items, side: number): number => {
    const s = row.reduce((a, d) => a + d.area, 0);
    const max = Math.max(...row.map((d) => d.area));
    const min = Math.min(...row.map((d) => d.area));
    return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min));
  };

  const place = (row: typeof items) => {
    const s = row.reduce((a, d) => a + d.area, 0);
    if (free.w >= free.h) {
      const colW = s / free.h;
      let y = free.y;
      for (const d of row) {
        const h = d.area / colW;
        out[d.i] = { x: free.x, y, w: colW, h };
        y += h;
      }
      free = { x: free.x + colW, y: free.y, w: Math.max(0, free.w - colW), h: free.h };
    } else {
      const rowH = s / free.w;
      let x = free.x;
      for (const d of row) {
        const w = d.area / rowH;
        out[d.i] = { x, y: free.y, w, h: rowH };
        x += w;
      }
      free = { x: free.x, y: free.y + rowH, w: free.w, h: Math.max(0, free.h - rowH) };
    }
  };

  let row: typeof items = [];
  for (const d of items) {
    const side = Math.min(free.w, free.h);
    if (row.length === 0 || worst([...row, d], side) <= worst(row, side)) {
      row.push(d);
    } else {
      place(row);
      row = [d];
    }
  }
  if (row.length) place(row);
  return out;
}

const VIEW_W = 1000;
const HEADER = 18;
const PAD = 2;

function truncate(text: string, px: number): string {
  const max = Math.max(0, Math.floor(px / 7));
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

export interface PortfolioTreemapProps {
  nodes: TreemapGroup[];
  height?: number;
  emptyLabel?: string;
  /** Unit for tooltips, e.g. "active students". */
  unit?: string;
}

export function PortfolioTreemap({ nodes, height = 420, emptyLabel = 'No data to show.', unit = 'students' }: PortfolioTreemapProps) {
  const palette = useChartPalette();
  const [focus, setFocus] = React.useState<string | null>(null);
  const hatchId = React.useId();
  if (nodes.length === 0) {
    return <p className="text-sm text-text-tertiary">{emptyLabel}</p>;
  }
  const shown = focus ? nodes.filter((n) => n.id === focus) : nodes;
  const groupRects = squarify(shown.map((n) => n.value), { x: 0, y: 0, w: VIEW_W, h: height });
  const fill = (t: TreemapTone) => palette[t];

  return (
    <div className="flex flex-col gap-2">
      {focus && (
        <button type="button" className="self-start text-xs text-accent-default hover:underline" onClick={() => setFocus(null)}>
          ← All faculties
        </button>
      )}
      <svg viewBox={`0 0 ${VIEW_W} ${height}`} width="100%" role="img" aria-label="Portfolio treemap: faculties and their programmes, sized by students">
        <defs>
          <pattern id={hatchId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke={palette.axis} strokeOpacity={0.45} strokeWidth="2" />
          </pattern>
        </defs>
        {shown.map((g, gi) => {
          const r = groupRects[gi]!;
          if (r.w <= 0 || r.h <= 0) return null;
          const inner: TreemapRect = { x: r.x + PAD, y: r.y + HEADER, w: Math.max(0, r.w - 2 * PAD), h: Math.max(0, r.h - HEADER - PAD) };
          const leafRects = squarify(g.children.map((c) => c.value), inner);
          return (
            <g key={g.id}>
              <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="none" stroke={palette.grid} />
              <g
                role="button"
                tabIndex={0}
                aria-label={`${g.label}: ${g.value.toLocaleString('en-US')} ${unit}. Zoom in.`}
                onClick={() => setFocus(focus ? null : g.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') setFocus(focus ? null : g.id);
                }}
                style={{ cursor: 'pointer' }}
              >
                <rect x={r.x} y={r.y} width={r.w} height={HEADER} fill="transparent" />
                {r.w > 40 && (
                  <text x={r.x + 4} y={r.y + 13} fontSize={11} fontWeight={600} fill={palette.text}>
                    {truncate(`${g.label} · ${g.value.toLocaleString('en-US')}`, r.w - 8)}
                  </text>
                )}
              </g>
              {g.children.map((c, ci) => {
                const lr = leafRects[ci]!;
                if (lr.w <= 0 || lr.h <= 0) return null;
                const body = (
                  <g data-hatched={c.hatched ? 'true' : undefined}>
                    <title>{`${c.label}${c.sublabel ? ` (${c.sublabel})` : ''}: ${c.value.toLocaleString('en-US')} ${unit}`}</title>
                    <rect x={lr.x} y={lr.y} width={lr.w} height={lr.h} fill={fill(c.tone)} fillOpacity={0.8} stroke={palette.grid} strokeWidth={1} />
                    {c.hatched && <rect x={lr.x} y={lr.y} width={lr.w} height={lr.h} fill={`url(#${hatchId})`} />}
                    {lr.w > 60 && lr.h > 20 && (
                      <text x={lr.x + 4} y={lr.y + 14} fontSize={10} fill={palette.text}>
                        {truncate(c.label, lr.w - 8)}
                      </text>
                    )}
                  </g>
                );
                return c.href ? (
                  <a key={c.id} href={c.href} aria-label={`${c.label}: ${c.value.toLocaleString('en-US')} ${unit}`}>
                    {body}
                  </a>
                ) : (
                  <React.Fragment key={c.id}>{body}</React.Fragment>
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
