'use client';

import * as React from 'react';
import Link from 'next/link';
import { useChartPalette } from '@kku/ui';

interface FacultyTile {
  facultyId: string;
  code: string;
  nameEn: string;
  nameTh: string;
  programCount: number;
  enrollmentLatest: number;
  netContributionThb: number;
  contributionPerStudentThb: number | null;
}

interface Props {
  tiles: FacultyTile[];
  height?: number;
}

// Squarified treemap. Box area ∝ enrollment, fill intensity ∝ net
// contribution per student. Faculties without enrolment are
// concentrated in a small "no-enrolment" strip at the bottom (so they
// don't disappear from the view but don't take prime real estate).
//
// Drawn as inline SVG (no d3-hierarchy dep) — squarified algorithm
// from Bruls/Huijing/van Wijk 1999.

export function FacultyTreemap({ tiles, height = 360 }: Props) {
  const palette = useChartPalette();

  // Split: the ones with students drive the main treemap; zeros
  // fall to a strip below.
  const withStudents = tiles.filter((t) => t.enrollmentLatest > 0);
  const zeros = tiles.filter((t) => t.enrollmentLatest === 0);

  const W = 800;
  const Hmain = zeros.length > 0 ? height - 36 : height;

  // Sort descending so squarify packs largest first.
  const sortedItems = [...withStudents].sort((a, b) => b.enrollmentLatest - a.enrollmentLatest);
  const totalSize = sortedItems.reduce((s, t) => s + t.enrollmentLatest, 0);
  const items = sortedItems.map((t) => ({
    ...t,
    weight: totalSize > 0 ? (t.enrollmentLatest / totalSize) * (W * Hmain) : 0,
  }));

  const rects = squarify(items, { x: 0, y: 0, w: W, h: Hmain });

  // Color scale: higher contribution-per-student → richer green.
  // Faculties with non-positive per-student → muted neutral.
  const cps = items.map((t) => t.contributionPerStudentThb ?? 0).filter((v) => v > 0);
  const maxCps = cps.length > 0 ? Math.max(...cps) : 1;

  const colorFor = (t: FacultyTile) => {
    const v = t.contributionPerStudentThb ?? 0;
    if (v <= 0) return palette.neutral;
    const intensity = Math.min(1, Math.sqrt(v / maxCps));
    // Mix neutral → positive based on intensity
    return mix(palette.neutral, palette.positive, intensity);
  };

  return (
    <div className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="img" aria-label="Faculty composition treemap">
        {rects.map((r, i) => {
          const t = items[i];
          const showName = r.w > 80 && r.h > 36;
          const showStat = r.w > 100 && r.h > 60;
          return (
            <Link href={`/cockpit?scope=faculty&scopeId=${t.facultyId}`} key={t.facultyId}>
              <g className="cursor-pointer transition-opacity hover:opacity-90">
                <rect
                  x={r.x + 1}
                  y={r.y + 1}
                  width={Math.max(0, r.w - 2)}
                  height={Math.max(0, r.h - 2)}
                  fill={colorFor(t)}
                  fillOpacity={0.85}
                  stroke={palette.grid}
                  strokeWidth={0.6}
                />
                {showName && (
                  <text
                    x={r.x + 8}
                    y={r.y + 18}
                    className="text-[11px] font-semibold"
                    fill={palette.text}
                    style={{ pointerEvents: 'none' }}
                  >
                    <FacultyShortName code={t.code} fullName={t.nameEn} maxChars={Math.max(8, Math.floor(r.w / 7))} />
                  </text>
                )}
                {showStat && (
                  <>
                    <text x={r.x + 8} y={r.y + 36} className="text-[11px] font-tabular" fill={palette.text} opacity={0.75}>
                      {t.enrollmentLatest.toLocaleString('en-US')} students
                    </text>
                    <text x={r.x + 8} y={r.y + 50} className="text-[10px] font-tabular" fill={palette.text} opacity={0.55}>
                      {t.programCount} {t.programCount === 1 ? 'program' : 'programs'} ·{' '}
                      ฿{abbreviateMoney(t.netContributionThb)}
                    </text>
                  </>
                )}
              </g>
            </Link>
          );
        })}
      </svg>
      {zeros.length > 0 && (
        <div className="rounded border border-border-subtle bg-surface-2 px-3 py-2">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-text-tertiary">
            <span>Zero enrolment</span>
            <span className="opacity-60">·</span>
            <span className="font-tabular text-text-secondary">{zeros.length} {zeros.length === 1 ? 'faculty' : 'faculties'}</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-text-secondary">
            {zeros.map((z) => (
              <Link
                key={z.facultyId}
                href={`/cockpit?scope=faculty&scopeId=${z.facultyId}`}
                className="hover:text-accent-default"
              >
                {z.nameEn} <span className="font-tabular text-text-tertiary">({z.programCount})</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FacultyShortName({ code, fullName, maxChars }: { code: string; fullName: string; maxChars: number }) {
  const trimmed = fullName.replace(/^(Faculty of |College of )/, '');
  const display = trimmed.length > maxChars ? `${trimmed.slice(0, maxChars - 1)}…` : trimmed;
  return <>{display}</>;
}

function abbreviateMoney(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return v.toString();
}

interface Rect { x: number; y: number; w: number; h: number }
interface Item extends FacultyTile { weight: number }

// Squarified treemap (iterative). For each row, keep adding items
// while the worst aspect ratio improves; once it stops improving,
// commit the row and start a new one against the remaining slab.
function squarify(items: Item[], outer: Rect): Rect[] {
  const indexed = items.map((it, idx) => ({ ...it, _idx: idx }));
  const out: Rect[] = new Array(items.length);
  let container = { ...outer };
  let queue = [...indexed];
  let row: Array<Item & { _idx: number }> = [];

  while (queue.length > 0) {
    const head = queue[0];
    const sideShort = Math.min(container.w, container.h);
    if (row.length === 0 || worst(row, sideShort) >= worst([...row, head], sideShort)) {
      row.push(head);
      queue.shift();
    } else {
      container = layoutRow(row, container, out);
      row = [];
    }
  }
  if (row.length > 0) layoutRow(row, container, out);
  return out;
}

function worst(row: Array<Item & { _idx: number }>, side: number): number {
  if (row.length === 0) return Infinity;
  const total = row.reduce((s, it) => s + it.weight, 0);
  const max = Math.max(...row.map((it) => it.weight));
  const min = Math.min(...row.map((it) => it.weight));
  const s2 = side * side;
  const t2 = total * total;
  return Math.max((s2 * max) / t2, t2 / (s2 * min));
}

function layoutRow(
  row: Array<Item & { _idx: number }>,
  container: Rect,
  out: Rect[],
): Rect {
  const total = row.reduce((s, it) => s + it.weight, 0);
  const horizontal = container.w >= container.h;
  if (horizontal) {
    const rowW = total / container.h;
    let y = container.y;
    for (const it of row) {
      const rectH = it.weight / rowW;
      out[it._idx] = { x: container.x, y, w: rowW, h: rectH };
      y += rectH;
    }
    return { x: container.x + rowW, y: container.y, w: container.w - rowW, h: container.h };
  } else {
    const rowH = total / container.w;
    let x = container.x;
    for (const it of row) {
      const rectW = it.weight / rowH;
      out[it._idx] = { x, y: container.y, w: rectW, h: rowH };
      x += rectW;
    }
    return { x: container.x, y: container.y + rowH, w: container.w, h: container.h - rowH };
  }
}

function mix(a: string, b: string, t: number): string {
  // a, b are oklch(...) strings. Mixing OKLCH at runtime is hairy —
  // instead, emit a CSS color-mix() so the browser handles it.
  return `color-mix(in oklch, ${a} ${Math.round((1 - t) * 100)}%, ${b} ${Math.round(t * 100)}%)`;
}
