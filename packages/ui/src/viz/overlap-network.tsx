'use client';

import * as React from 'react';
import { cn } from '../lib/cn';
import { useChartPalette } from './chart-theme';
import {
  layoutOverlapNetwork,
  type NetworkEdgeInput,
  type NetworkNodeInput,
  type PlacedEdge,
  type PlacedNode,
} from './overlap-network-layout';

// Overlap network for program-overlap.v1: one node per programme that has
// at least one overlap at or above the threshold, one edge per such pair.
// Programmes with no qualifying overlap are not drawn — at a ~1 % hit rate a
// programme × programme matrix is almost all empty space; the network shows
// only what overlaps, grouped into its connected components.
//
// Encoding
//   edge   one sequential hue (chart series 0); stroke width AND opacity
//          step together by band — low 30–49 / moderate 50–69 / high ≥ 70.
//          Thai / international versions of one programme are dashed.
//   node   neutral marker. Not coloured by faculty: there are ~20 faculties
//          and a categorical palette stops being readable past ~8; the
//          faculty code is printed under the name instead.
//
// Interaction: hover or focus shows a tooltip; click or Enter selects. A
// selected node keeps its own edges at full strength and dims the rest.
// Every node and edge is a focusable button; hit targets are wider than the
// marks. The ranked pair list beside the chart is its table view.
//
// Inline SVG, deterministic layout (overlap-network-layout.ts), tokens only.

export interface OverlapNetworkNode extends NetworkNodeInput {
  /** Extra tooltip line, e.g. the English name. */
  description?: string;
}

export interface OverlapNetworkEdge extends NetworkEdgeInput {
  /** Tooltip rows, label → value, rendered as separate cells. */
  details?: Array<{ label: string; value: string }>;
  /** Last tooltip line, e.g. the suggested action. */
  note?: string;
}

export interface OverlapNetworkProps {
  nodes: OverlapNetworkNode[];
  edges: OverlapNetworkEdge[];
  /** Edges below this weight are not drawn. Default 30. */
  threshold?: number;
  /** What the edge weight measures, for the legend and tooltips. */
  weightLabel?: string;
  selectedNodeId?: string | null;
  selectedPairId?: string | null;
  /** Called with null when the selected node is clicked again. */
  onSelectNode?: (id: string | null) => void;
  onSelectEdge?: (pairId: string) => void;
  ariaLabel?: string;
  className?: string;
}

export const OVERLAP_NETWORK_BANDS = [
  { key: 'low', label: 'Low', range: '30–49', min: 30, max: 49, width: 1.5, opacity: 0.45 },
  { key: 'moderate', label: 'Moderate', range: '50–69', min: 50, max: 69, width: 3, opacity: 0.7 },
  { key: 'high', label: 'High', range: '≥ 70', min: 70, max: 100, width: 5, opacity: 0.95 },
] as const;

/** Stroke width and opacity for an edge weight, stepped by band. */
export function edgeStyle(weight: number): { width: number; opacity: number } {
  let out: { width: number; opacity: number } = { width: 1, opacity: 0.3 };
  for (const b of OVERLAP_NETWORK_BANDS) if (weight >= b.min) out = { width: b.width, opacity: b.opacity };
  return out;
}

const DASH = '6 4';
const LABEL_FONT = 12;
const SUBLABEL_FONT = 10;
const NODE_R = 6;
const MARGIN = 12;
// Theme-aware CSS-variable paints for the label halo and marker ring.
const SURFACE = 'oklch(var(--color-surface-1))';

type Hover = { kind: 'node'; id: string } | { kind: 'edge'; pairId: string } | null;

export function OverlapNetwork({
  nodes,
  edges,
  threshold = 30,
  weightLabel = 'Overlap index',
  selectedNodeId = null,
  selectedPairId = null,
  onSelectNode,
  onSelectEdge,
  ariaLabel = 'Programme overlap network',
  className,
}: OverlapNetworkProps) {
  const palette = useChartPalette();
  const [hover, setHover] = React.useState<Hover>(null);
  const [focused, setFocused] = React.useState<Hover>(null);
  const instructionsId = React.useId();

  const layout = React.useMemo(
    () =>
      layoutOverlapNetwork(nodes, edges, {
        threshold,
        nodeRadius: NODE_R,
        labelFontSize: LABEL_FONT,
        sublabelFontSize: SUBLABEL_FONT,
      }),
    [nodes, edges, threshold],
  );
  const nodeInput = React.useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const edgeInput = React.useMemo(() => new Map(edges.map((e) => [e.pairId, e])), [edges]);
  const placedById = React.useMemo(() => new Map(layout.nodes.map((n) => [n.id, n])), [layout.nodes]);

  if (layout.nodes.length === 0) {
    return (
      <div
        className={cn(
          'flex h-[160px] items-center justify-center rounded-md border border-dashed border-subtle px-[16px] text-center text-sm text-text-tertiary',
          className,
        )}
      >
        No pair reaches {weightLabel.toLowerCase()} {threshold} or more here.
      </div>
    );
  }

  const W = layout.width + MARGIN * 2;
  const H = layout.height + MARGIN * 2;
  const stroke = palette.series[0] ?? palette.positive;

  // Emphasis: the hovered node, else the selected node.
  const activeNode = hover?.kind === 'node' ? hover.id : focused?.kind === 'node' ? focused.id : selectedNodeId;
  const activeEdge = hover?.kind === 'edge' ? hover.pairId : focused?.kind === 'edge' ? focused.pairId : null;
  const neighbours = new Set<string>();
  if (activeNode && placedById.has(activeNode)) {
    neighbours.add(activeNode);
    for (const e of layout.edges) {
      if (e.a === activeNode) neighbours.add(e.b);
      if (e.b === activeNode) neighbours.add(e.a);
    }
  }
  const emphasising = neighbours.size > 0;
  const edgeLit = (e: PlacedEdge) =>
    !emphasising || e.a === activeNode || e.b === activeNode || e.pairId === activeEdge;
  const nodeLit = (n: PlacedNode) => !emphasising || neighbours.has(n.id);

  const nameOf = (id: string) => nodeInput.get(id)?.label ?? id;
  const edgeAria = (e: PlacedEdge) =>
    `${nameOf(e.a)} and ${nameOf(e.b)}: ${weightLabel.toLowerCase()} ${Math.round(e.weight)}${
      e.languageVariant ? ', Thai / international versions' : ''
    }. Press Enter to open the evidence.`;
  const nodeAria = (n: PlacedNode) =>
    `${n.fullLabel}${n.sublabel ? `, ${n.sublabel}` : ''}: ${n.degree} overlap${n.degree === 1 ? '' : 's'} at ${threshold} or more. Press Enter to ${
      selectedNodeId === n.id ? 'clear the filter' : 'filter the pair list'
    }.`;

  const selectNode = (id: string) => onSelectNode?.(selectedNodeId === id ? null : id);
  const keyActivate = (fn: () => void) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fn();
    }
  };

  const tip = hover ?? focused;
  const tooltip = tip ? renderTooltip(tip) : null;

  function renderTooltip(t: NonNullable<Hover>): { x: number; y: number; body: React.ReactNode } | null {
    if (t.kind === 'node') {
      const n = placedById.get(t.id);
      if (!n) return null;
      const input = nodeInput.get(t.id);
      return {
        x: n.x,
        y: n.y,
        body: (
          <>
            <p className="font-medium text-text-primary" lang="th">
              {n.fullLabel}
            </p>
            {input?.description ? <p className="text-text-tertiary">{input.description}</p> : null}
            <p className="mt-[4px] flex justify-between gap-[16px]">
              <span className="text-text-tertiary">Overlaps at {threshold} or more</span>
              <span className="tabular-nums text-text-primary">{n.degree}</span>
            </p>
          </>
        ),
      };
    }
    const e = layout.edges.find((x) => x.pairId === t.pairId);
    if (!e) return null;
    const input = edgeInput.get(t.pairId);
    return {
      x: (e.x1 + e.x2) / 2,
      y: (e.y1 + e.y2) / 2,
      body: (
        <>
          <p className="font-medium text-text-primary" lang="th">
            {nameOf(e.a)}
          </p>
          <p className="font-medium text-text-primary" lang="th">
            {nameOf(e.b)}
          </p>
          <dl className="mt-[6px] grid grid-cols-[1fr_auto] gap-x-[16px] gap-y-[2px]">
            <dt className="text-text-tertiary">{weightLabel}</dt>
            <dd className="text-right font-semibold tabular-nums text-text-primary">{Math.round(e.weight)}</dd>
            {(input?.details ?? []).map((d) => (
              <React.Fragment key={d.label}>
                <dt className="text-text-tertiary">{d.label}</dt>
                <dd className="text-right tabular-nums text-text-secondary">{d.value}</dd>
              </React.Fragment>
            ))}
          </dl>
          {e.languageVariant ? <p className="mt-[4px] text-text-tertiary">Thai / international versions</p> : null}
          {input?.note ? <p className="mt-[4px] text-text-secondary">{input.note}</p> : null}
        </>
      ),
    };
  }

  return (
    <div className={cn('flex flex-col gap-[12px]', className)}>
      <div className="relative overflow-x-auto">
        <div className="relative" style={{ width: W, maxWidth: '100%' }}>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            width={W}
            height={H}
            role="group"
            aria-label={ariaLabel}
            aria-describedby={instructionsId}
            className="block h-auto max-w-full"
            onMouseLeave={() => setHover(null)}
          >
            <g transform={`translate(${MARGIN} ${MARGIN})`}>
              {/* Edges — visible strokes */}
              <g pointerEvents="none">
                {layout.edges.map((e) => {
                  const s = edgeStyle(e.weight);
                  const lit = edgeLit(e);
                  const selected = e.pairId === selectedPairId;
                  return (
                    <g key={`e${e.pairId}`}>
                      {selected ? (
                        <line
                          x1={e.x1}
                          y1={e.y1}
                          x2={e.x2}
                          y2={e.y2}
                          stroke={palette.text}
                          strokeWidth={s.width + 4}
                          strokeOpacity={0.5}
                          strokeLinecap="round"
                        />
                      ) : null}
                      <line
                        x1={e.x1}
                        y1={e.y1}
                        x2={e.x2}
                        y2={e.y2}
                        stroke={stroke}
                        strokeWidth={e.pairId === activeEdge ? s.width + 1.5 : s.width}
                        strokeOpacity={lit ? s.opacity : s.opacity * 0.15}
                        strokeDasharray={e.languageVariant ? DASH : undefined}
                        strokeLinecap="round"
                      />
                    </g>
                  );
                })}
              </g>

              {/* Edge hit targets — wider than the strokes, focusable */}
              {layout.edges.map((e) => (
                <line
                  key={`h${e.pairId}`}
                  x1={e.x1}
                  y1={e.y1}
                  x2={e.x2}
                  y2={e.y2}
                  stroke={palette.text}
                  strokeOpacity={0}
                  strokeWidth={14}
                  role="button"
                  tabIndex={0}
                  aria-label={edgeAria(e)}
                  className="cursor-pointer outline-none"
                  onMouseEnter={() => setHover({ kind: 'edge', pairId: e.pairId })}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setFocused({ kind: 'edge', pairId: e.pairId })}
                  onBlur={() => setFocused(null)}
                  onClick={() => onSelectEdge?.(e.pairId)}
                  onKeyDown={keyActivate(() => onSelectEdge?.(e.pairId))}
                />
              ))}

              {/* Keyboard focus on an edge */}
              {focused?.kind === 'edge'
                ? layout.edges
                    .filter((e) => e.pairId === focused.pairId)
                    .map((e) => (
                      <line
                        key="focus-edge"
                        pointerEvents="none"
                        x1={e.x1}
                        y1={e.y1}
                        x2={e.x2}
                        y2={e.y2}
                        stroke={palette.text}
                        strokeWidth={1.5}
                        strokeDasharray="2 3"
                      />
                    ))
                : null}

              {/* Nodes */}
              {layout.nodes.map((n) => {
                const lit = nodeLit(n);
                const selected = n.id === selectedNodeId;
                const isFocused = focused?.kind === 'node' && focused.id === n.id;
                return (
                  <g
                    key={`n${n.id}`}
                    role="button"
                    tabIndex={0}
                    aria-label={nodeAria(n)}
                    aria-pressed={selected}
                    className="cursor-pointer outline-none"
                    opacity={lit ? 1 : 0.3}
                    onMouseEnter={() => setHover({ kind: 'node', id: n.id })}
                    onMouseLeave={() => setHover(null)}
                    onFocus={() => setFocused({ kind: 'node', id: n.id })}
                    onBlur={() => setFocused(null)}
                    onClick={() => selectNode(n.id)}
                    onKeyDown={keyActivate(() => selectNode(n.id))}
                  >
                    {/* Hit target: the whole node + label box */}
                    <rect x={n.box.x} y={n.box.y - 4} width={n.box.w} height={n.box.h + 4} fill={palette.text} fillOpacity={0} />
                    {selected || isFocused ? (
                      <circle
                        cx={n.x}
                        cy={n.y}
                        r={NODE_R + 4}
                        fill="none"
                        stroke={palette.text}
                        strokeWidth={1.5}
                        strokeDasharray={isFocused && !selected ? '2 2' : undefined}
                      />
                    ) : null}
                    <circle
                      cx={n.x}
                      cy={n.y}
                      r={NODE_R}
                      fill={palette.text}
                      strokeWidth={2}
                      style={{ stroke: SURFACE }}
                    />
                    <text
                      x={n.x}
                      y={n.labelY}
                      textAnchor="middle"
                      fontSize={LABEL_FONT}
                      fontWeight={selected ? 600 : 500}
                      fill={palette.text}
                      strokeWidth={3}
                      strokeLinejoin="round"
                      paintOrder="stroke"
                      style={{ stroke: SURFACE }}
                      lang="th"
                    >
                      {n.label}
                    </text>
                    {n.sublabel ? (
                      <text
                        x={n.x}
                        y={n.sublabelY}
                        textAnchor="middle"
                        fontSize={SUBLABEL_FONT}
                        fill={palette.axis}
                        strokeWidth={3}
                        strokeLinejoin="round"
                        paintOrder="stroke"
                        style={{ stroke: SURFACE }}
                      >
                        {n.sublabel}
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </g>
          </svg>

          {tooltip ? (
            <div
              role="tooltip"
              className="pointer-events-none absolute z-10 w-max max-w-[300px] -translate-x-1/2 rounded-md border border-subtle bg-surface-1 px-[10px] py-[8px] text-xs shadow-md"
              style={{
                left: `${((tooltip.x + MARGIN) / W) * 100}%`,
                top: `calc(${((tooltip.y + MARGIN) / H) * 100}% + 14px)`,
              }}
            >
              {tooltip.body}
            </div>
          ) : null}
        </div>
      </div>

      <p id={instructionsId} className="sr-only">
        Each programme is a button: Enter filters the pair list to it. Each line is a pair: Enter opens its evidence.
        The ranked pair list below holds the same data as a table.
      </p>

      <OverlapNetworkLegend threshold={threshold} weightLabel={weightLabel} />
    </div>
  );
}

function OverlapNetworkLegend({ threshold, weightLabel }: { threshold: number; weightLabel: string }) {
  const palette = useChartPalette();
  const stroke = palette.series[0] ?? palette.positive;
  return (
    <div className="flex flex-wrap items-center gap-x-[20px] gap-y-[6px] text-xs text-text-tertiary">
      <span className="font-medium text-text-secondary">{weightLabel}</span>
      {OVERLAP_NETWORK_BANDS.map((b) => (
        <span key={b.key} className={cn('inline-flex items-center gap-[6px]', b.max < threshold && 'opacity-40')}>
          <svg width={24} height={10} aria-hidden="true">
            <line x1={2} y1={5} x2={22} y2={5} stroke={stroke} strokeWidth={b.width} strokeOpacity={b.opacity} strokeLinecap="round" />
          </svg>
          <span>
            {b.label} <span className="tabular-nums">{b.range}</span>
          </span>
        </span>
      ))}
      <span className="inline-flex items-center gap-[6px]">
        <svg width={24} height={10} aria-hidden="true">
          <line x1={2} y1={5} x2={22} y2={5} stroke={stroke} strokeWidth={2} strokeOpacity={0.8} strokeDasharray="4 3" />
        </svg>
        <span>Thai / international versions</span>
      </span>
      <span className="inline-flex items-center gap-[6px]">
        <svg width={12} height={12} aria-hidden="true">
          <circle cx={6} cy={6} r={4} fill={palette.text} />
        </svg>
        <span>Programme · faculty code underneath</span>
      </span>
      <span>
        Programmes with no pair at <span className="tabular-nums">{threshold}</span> or more are not drawn.
      </span>
    </div>
  );
}
