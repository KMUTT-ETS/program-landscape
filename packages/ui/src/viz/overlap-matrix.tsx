'use client';

import * as React from 'react';
import { cn } from '../lib/cn';
import { useChartPalette } from './chart-theme';

// Overlap matrix: a programme × programme matrix for program-overlap.v1.
// The caller passes programmes ALREADY in display order (the API's
// clustered `order`), so overlapping groups sit as dark blocks on the
// diagonal. One stored pair = one cell; the mirror cell is drawn
// automatically so the matrix reads symmetrically.
//
// Encoding: a single sequential hue (chart series 0) whose opacity steps
// by band — low 30–49 / moderate 50–69 / high ≥ 70 — so the legend maps
// one-to-one onto what the eye sees. Cells under `threshold` (and null
// values) are not drawn at all: absence is quieter than a pale cell.
//
// Inline SVG, theme-aware via useChartPalette, no charting library.
// Pointer handling is done once on the <svg> (coordinates → row/col)
// rather than per cell, so a 300 × 300 matrix stays responsive.

export interface OverlapMatrixProgramme {
  id: string;
  label: string;
  sublabel?: string;
  groupColorIndex?: number;
}

export interface OverlapMatrixCell {
  a: string;
  b: string;
  value: number | null;
  title: string;
}

export interface OverlapMatrixProps {
  /** Already in display order (clustered). */
  programmes: OverlapMatrixProgramme[];
  /** One per stored pair; the symmetric cell is drawn automatically. */
  cells: OverlapMatrixCell[];
  /** Outlined blocks; a group whose members are not contiguous is skipped. */
  groups?: Array<{ members: string[] }>;
  /** Cells below this value are not drawn. */
  threshold?: number;
  selected?: { a: string; b: string } | null;
  onSelect?: (a: string, b: string) => void;
  /** Default: fit to 720px, minimum 5. */
  cellSize?: number;
  /** Accessible name for the matrix. */
  ariaLabel?: string;
  className?: string;
}

// ── Pure helpers (exported for tests) ─────────────────────────────────

export const OVERLAP_BANDS = [
  { key: 'low', label: 'Low', range: '30–49', min: 30, max: 49, opacity: 0.32 },
  { key: 'moderate', label: 'Moderate', range: '50–69', min: 50, max: 69, opacity: 0.6 },
  { key: 'high', label: 'High', range: '≥ 70', min: 70, max: 100, opacity: 0.95 },
] as const;

/** Opacity below the lowest band (only visible when threshold < 30). */
export const OVERLAP_SUB_BAND_OPACITY = 0.14;

/**
 * Fill opacity for a 0–100 overlap value, stepped by band so the legend
 * is readable: < 30 → 0.14, 30–49 → 0.32, 50–69 → 0.6, ≥ 70 → 0.95.
 */
export function bandOpacity(value: number): number {
  let out: number = OVERLAP_SUB_BAND_OPACITY;
  for (const band of OVERLAP_BANDS) {
    if (value >= band.min) out = band.opacity;
  }
  return out;
}

/**
 * The [start, end] index span (inclusive) that `members` occupy in
 * `order`, or null when any member is absent, the group is empty, or the
 * members are not contiguous in display order.
 */
export function contiguousSpan(
  order: readonly string[],
  members: readonly string[],
): { start: number; end: number } | null {
  const unique = Array.from(new Set(members));
  if (unique.length === 0) return null;
  const index = new Map<string, number>();
  order.forEach((id, i) => index.set(id, i));
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  for (const id of unique) {
    const i = index.get(id);
    if (i === undefined) return null;
    if (i < start) start = i;
    if (i > end) end = i;
  }
  return end - start + 1 === unique.length ? { start, end } : null;
}

// ── Layout constants ──────────────────────────────────────────────────

const FIT_WIDTH = 720;
const MIN_CELL = 5;
const MAX_CELL = 28;
const STRIP = 6;
const STRIP_GAP = 2;
const LABEL_MIN_CELL = 10;
const LABEL_COL = 188;

interface CellPos {
  r: number;
  c: number;
}

export function OverlapMatrix({
  programmes,
  cells,
  groups,
  threshold = 0,
  selected = null,
  onSelect,
  cellSize,
  ariaLabel = 'Programme overlap matrix',
  className,
}: OverlapMatrixProps) {
  const palette = useChartPalette();
  const n = programmes.length;
  const instructionsId = React.useId();

  const [hover, setHover] = React.useState<CellPos | null>(null);
  const [cursor, setCursor] = React.useState<CellPos>({ r: 0, c: 1 });
  const [focused, setFocused] = React.useState(false);

  // Size: fit to 720px wide, clamped. Labels only when they can be read.
  const size = React.useMemo(() => {
    if (cellSize !== undefined) return Math.max(MIN_CELL, Math.floor(cellSize));
    if (n === 0) return MAX_CELL;
    const withLabels = Math.floor((FIT_WIDTH - LABEL_COL - STRIP - STRIP_GAP) / n);
    if (withLabels >= LABEL_MIN_CELL) return Math.min(MAX_CELL, withLabels);
    return Math.max(MIN_CELL, Math.floor((FIT_WIDTH - STRIP - STRIP_GAP) / n));
  }, [cellSize, n]);
  const showLabels = size >= LABEL_MIN_CELL;
  const labelCol = showLabels ? LABEL_COL : 0;
  const x0 = labelCol + STRIP + STRIP_GAP;
  const y0 = STRIP + STRIP_GAP;
  const span = n * size;
  const totalWidth = x0 + span + 1;
  const totalHeight = y0 + span + 1;
  const inset = size >= 8 ? 0.5 : 0;

  const order = React.useMemo(() => programmes.map((p) => p.id), [programmes]);
  const indexOf = React.useMemo(() => {
    const m = new Map<string, number>();
    order.forEach((id, i) => m.set(id, i));
    return m;
  }, [order]);

  // Symmetric lookup: "r|c" → cell, both directions.
  const lookup = React.useMemo(() => {
    const m = new Map<string, OverlapMatrixCell>();
    for (const cell of cells) {
      const r = indexOf.get(cell.a);
      const c = indexOf.get(cell.b);
      if (r === undefined || c === undefined || r === c) continue;
      m.set(`${r}|${c}`, cell);
      m.set(`${c}|${r}`, cell);
    }
    return m;
  }, [cells, indexOf]);

  const isDrawn = React.useCallback(
    (cell: OverlapMatrixCell | undefined): cell is OverlapMatrixCell & { value: number } =>
      cell !== undefined && cell.value !== null && cell.value >= threshold,
    [threshold],
  );

  const spans = React.useMemo(
    () =>
      (groups ?? [])
        .map((g) => contiguousSpan(order, g.members))
        .filter((s): s is { start: number; end: number } => s !== null && s.end > s.start),
    [groups, order],
  );

  // The cell layer is the expensive part — memoised apart from hover,
  // cursor and selection so pointer movement never re-renders it.
  const cellLayer = React.useMemo(() => {
    const fill = palette.series[0] ?? palette.positive;
    const out: React.ReactNode[] = [];
    for (let r = 0; r < n; r++) {
      out.push(
        <rect
          key={`d${r}`}
          x={x0 + r * size + inset}
          y={y0 + r * size + inset}
          width={size - inset * 2}
          height={size - inset * 2}
          fill={palette.grid}
        />,
      );
    }
    for (const [key, cell] of lookup) {
      if (!isDrawn(cell)) continue;
      const [rs, cs] = key.split('|');
      const r = Number(rs);
      const c = Number(cs);
      out.push(
        <rect
          key={key}
          x={x0 + c * size + inset}
          y={y0 + r * size + inset}
          width={size - inset * 2}
          height={size - inset * 2}
          fill={fill}
          fillOpacity={bandOpacity(cell.value)}
        >
          <title>{cell.title}</title>
        </rect>,
      );
    }
    return out;
  }, [lookup, isDrawn, n, size, inset, x0, y0, palette]);

  if (n < 2) {
    return (
      <div
        className={cn(
          'flex h-[160px] items-center justify-center rounded-md border border-dashed border-subtle text-sm text-text-tertiary',
          className,
        )}
      >
        No programmes to compare at this level.
      </div>
    );
  }

  const posFromEvent = (e: React.MouseEvent<SVGSVGElement>): CellPos | null => {
    const box = e.currentTarget.getBoundingClientRect();
    const c = Math.floor((e.clientX - box.left - x0) / size);
    const r = Math.floor((e.clientY - box.top - y0) / size);
    if (r < 0 || c < 0 || r >= n || c >= n) return null;
    return { r, c };
  };

  const activate = (pos: CellPos) => {
    if (!onSelect || pos.r === pos.c) return;
    const cell = lookup.get(`${pos.r}|${pos.c}`);
    if (!isDrawn(cell)) return;
    onSelect(cell.a, cell.b);
  };

  const onKeyDown = (e: React.KeyboardEvent<SVGSVGElement>) => {
    const step: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const d = step[e.key];
    if (d) {
      e.preventDefault();
      setCursor((p) => ({
        r: Math.min(n - 1, Math.max(0, p.r + d[0])),
        c: Math.min(n - 1, Math.max(0, p.c + d[1])),
      }));
      return;
    }
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      setCursor((p) => ({ r: p.r, c: e.key === 'Home' ? 0 : n - 1 }));
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      activate(cursor);
    }
  };

  const cursorCell = lookup.get(`${cursor.r}|${cursor.c}`);
  const cursorA = programmes[cursor.r];
  const cursorB = programmes[cursor.c];
  const cursorText =
    cursor.r === cursor.c
      ? `${cursorA?.label ?? ''}: same programme`
      : isDrawn(cursorCell)
        ? cursorCell.title
        : `${cursorA?.label ?? ''} × ${cursorB?.label ?? ''}: below threshold or not stored`;

  const selR = selected ? indexOf.get(selected.a) : undefined;
  const selC = selected ? indexOf.get(selected.b) : undefined;
  const selectedCells: CellPos[] =
    selR !== undefined && selC !== undefined && selR !== selC
      ? [
          { r: selR, c: selC },
          { r: selC, c: selR },
        ]
      : [];

  const hoverCell = hover ? lookup.get(`${hover.r}|${hover.c}`) : undefined;
  const hoverClickable = hover !== null && hover.r !== hover.c && isDrawn(hoverCell) && !!onSelect;

  return (
    <div className={cn('flex flex-col gap-[12px]', className)}>
      <div className="overflow-x-auto">
        <svg
          width={totalWidth}
          height={totalHeight}
          role="application"
          aria-label={ariaLabel}
          aria-describedby={instructionsId}
          tabIndex={0}
          className="block outline-none"
          style={{ cursor: hoverClickable ? 'pointer' : 'default' }}
          onMouseMove={(e) => {
            const pos = posFromEvent(e);
            setHover((prev) =>
              prev?.r === pos?.r && prev?.c === pos?.c ? prev : pos,
            );
          }}
          onMouseLeave={() => setHover(null)}
          onClick={(e) => {
            const pos = posFromEvent(e);
            if (!pos) return;
            setCursor(pos);
            activate(pos);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        >
          {/* Faculty strips — left and top */}
          {programmes.map((p, i) => {
            const color = palette.series[(p.groupColorIndex ?? 0) % 12] ?? palette.neutral;
            return (
              <g key={`s${p.id}`}>
                <rect x={labelCol} y={y0 + i * size} width={STRIP} height={size} fill={color} />
                <rect x={x0 + i * size} y={0} width={size} height={STRIP} fill={color} />
              </g>
            );
          })}

          {/* Row labels */}
          {showLabels
            ? programmes.map((p, i) => {
                const active = hover?.r === i || hover?.c === i;
                return (
                  <text
                    key={`l${p.id}`}
                    x={labelCol - 8}
                    y={y0 + i * size + size / 2}
                    dominantBaseline="central"
                    textAnchor="end"
                    fontSize={Math.min(12, size - 1)}
                    fill={active ? palette.text : palette.axis}
                    fontWeight={active ? 600 : 400}
                  >
                    <title>{p.sublabel ? `${p.label} — ${p.sublabel}` : p.label}</title>
                    {truncate(p.label, 30)}
                  </text>
                );
              })
            : null}

          {/* Frame */}
          <rect
            x={x0 - 0.5}
            y={y0 - 0.5}
            width={span + 1}
            height={span + 1}
            fill="none"
            stroke={palette.grid}
            strokeWidth={1}
          />

          {cellLayer}

          {/* Crosshair on hover */}
          {hover ? (
            <g pointerEvents="none">
              <rect x={x0} y={y0 + hover.r * size} width={span} height={size} fill={palette.text} fillOpacity={0.05} />
              <rect x={x0 + hover.c * size} y={y0} width={size} height={span} fill={palette.text} fillOpacity={0.05} />
              {hover.r !== hover.c && isDrawn(hoverCell) ? (
                <rect
                  x={x0 + hover.c * size + 0.5}
                  y={y0 + hover.r * size + 0.5}
                  width={size - 1}
                  height={size - 1}
                  fill="none"
                  stroke={palette.text}
                  strokeOpacity={0.6}
                  strokeWidth={1}
                />
              ) : null}
            </g>
          ) : null}

          {/* Group outlines */}
          <g pointerEvents="none">
            {spans.map((s) => (
              <rect
                key={`g${s.start}-${s.end}`}
                x={x0 + s.start * size}
                y={y0 + s.start * size}
                width={(s.end - s.start + 1) * size}
                height={(s.end - s.start + 1) * size}
                fill="none"
                stroke={palette.text}
                strokeWidth={1.5}
                rx={1}
              />
            ))}
          </g>

          {/* Selection */}
          <g pointerEvents="none">
            {selectedCells.map((p) => (
              <rect
                key={`sel${p.r}-${p.c}`}
                x={x0 + p.c * size - 0.5}
                y={y0 + p.r * size - 0.5}
                width={size + 1}
                height={size + 1}
                fill="none"
                stroke={palette.text}
                strokeWidth={2.5}
              />
            ))}
          </g>

          {/* Keyboard cursor */}
          {focused ? (
            <rect
              pointerEvents="none"
              x={x0 + cursor.c * size - 1.5}
              y={y0 + cursor.r * size - 1.5}
              width={size + 3}
              height={size + 3}
              fill="none"
              stroke={palette.text}
              strokeWidth={1.5}
              strokeDasharray="3 2"
            />
          ) : null}
        </svg>
      </div>

      <p id={instructionsId} className="sr-only">
        Use the arrow keys to move between cells and Enter or Space to open a pair.
      </p>
      <p className="sr-only" aria-live="polite">
        {focused ? cursorText : ''}
      </p>

      <OverlapLegend threshold={threshold} />
    </div>
  );
}

function OverlapLegend({ threshold }: { threshold: number }) {
  const palette = useChartPalette();
  const fill = palette.series[0] ?? palette.positive;
  return (
    <div className="flex flex-wrap items-center gap-x-[20px] gap-y-[6px] text-xs text-text-tertiary">
      <span className="font-medium text-text-secondary">Overlap index</span>
      {OVERLAP_BANDS.map((b) => {
        const hidden = b.max < threshold;
        return (
          <span key={b.key} className={cn('inline-flex items-center gap-[6px]', hidden && 'opacity-40')}>
            <svg width={12} height={12} aria-hidden="true">
              <rect width={12} height={12} rx={2} fill={fill} fillOpacity={b.opacity} />
            </svg>
            <span>
              {b.label} <span className="tabular-nums">{b.range}</span>
            </span>
          </span>
        );
      })}
      <span className="inline-flex items-center gap-[6px]">
        <svg width={12} height={12} aria-hidden="true">
          <rect width={12} height={12} rx={2} fill={palette.grid} />
        </svg>
        <span>Same programme</span>
      </span>
      <span className="inline-flex items-center gap-[6px]">
        <svg width={14} height={12} aria-hidden="true">
          <rect x={1} y={1} width={12} height={10} rx={1} fill="none" stroke={palette.text} strokeWidth={1.5} />
        </svg>
        <span>Overlap group</span>
      </span>
      <span className="inline-flex items-center gap-[6px]">
        <svg width={10} height={12} aria-hidden="true">
          <rect width={6} height={12} fill={palette.series[6] ?? palette.neutral} />
        </svg>
        <span>Faculty</span>
      </span>
      {threshold > 0 ? (
        <span>
          Pairs below <span className="tabular-nums">{threshold}</span> are not drawn.
        </span>
      ) : null}
    </div>
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
