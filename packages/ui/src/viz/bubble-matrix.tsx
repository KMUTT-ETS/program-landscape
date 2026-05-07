'use client';

import * as React from 'react';
import { cn } from '../lib/cn';
import { useChartPalette } from './chart-theme';

// BCG-style bubble matrix — X axis + Y axis, bubble size = a metric,
// bubble colour = +/- a metric (diverging scale).
//
// Rendered as inline SVG for:
//   - crisp export to PDF (the prompt-02c council pack expects SVG)
//   - colour-token driven (reads palette via useChartPalette so the
//     theme switch updates the fill on dark mode without remount)
//   - 300-bubble performance is fine; we cap at ~200 in the controller
//
// Accessibility: each bubble has a visible text label + aria-label with
// the metric read-back. Hover = tooltip overlay with Thai description.

export interface Bubble {
  id: string;
  label: string;
  x: number;            // 0-100
  y: number;            // 0-100
  size: number;         // arbitrary; normalised internally
  color: number;        // arbitrary; negative → negative-tone, positive → positive-tone
  dataCompletenessPct?: number;
}

export interface BubbleMatrixProps {
  bubbles: Bubble[];
  axisXLabel: string;
  axisYLabel: string;
  xMinLabel?: string;
  xMaxLabel?: string;
  yMinLabel?: string;
  yMaxLabel?: string;
  width?: number;
  height?: number;
  onBubbleClick?: (b: Bubble) => void;
  className?: string;
  // Optional named labels for the 4 quadrants. When supplied, renders a
  // small caption in each corner (e.g. STARS top-right, DOGS bottom-left)
  // — useful for BCG-style portfolio views where the quadrant name is
  // more meaningful than the axis values alone. Omit to hide.
  quadrantLabels?: {
    topRight?: { label: string; tone?: 'positive' | 'negative' | 'neutral' };
    topLeft?: { label: string; tone?: 'positive' | 'negative' | 'neutral' };
    bottomRight?: { label: string; tone?: 'positive' | 'negative' | 'neutral' };
    bottomLeft?: { label: string; tone?: 'positive' | 'negative' | 'neutral' };
  };
}

export function BubbleMatrix({
  bubbles,
  axisXLabel,
  axisYLabel,
  xMinLabel,
  xMaxLabel,
  yMinLabel,
  yMaxLabel,
  width = 720,
  height = 480,
  onBubbleClick,
  className,
  quadrantLabels,
}: BubbleMatrixProps) {
  const palette = useChartPalette();
  const [hovered, setHovered] = React.useState<Bubble | null>(null);

  // Layout constants.
  const M = { top: 24, right: 40, bottom: 48, left: 60 };
  const W = width - M.left - M.right;
  const H = height - M.top - M.bottom;

  // Normalise size: bubbles scale quadratic-area with size, cap at r=32.
  const maxSize = Math.max(1, ...bubbles.map((b) => Math.abs(b.size)));
  const radius = (b: Bubble) => {
    const t = maxSize === 0 ? 0 : Math.abs(b.size) / maxSize;
    return 6 + Math.sqrt(t) * 26;
  };

  // Bubble colour: diverging. Positive → data-positive (greenish),
  // negative → data-negative (red), zero → neutral.
  const colorFor = (b: Bubble) => {
    if (b.color > 0) return palette.positive;
    if (b.color < 0) return palette.negative;
    return palette.neutral;
  };

  // Quadrant guides at 50/50.
  const quadrantX = M.left + W / 2;
  const quadrantY = M.top + H / 2;

  return (
    <div className={cn('overflow-hidden', className)}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`BCG-style strategic matrix: ${axisXLabel} on X, ${axisYLabel} on Y. ${bubbles.length} items.`}
      >
        {/* plot area background */}
        <rect x={M.left} y={M.top} width={W} height={H} fill="transparent" stroke={palette.grid} />

        {/* quadrant cross-hairs */}
        <line
          x1={quadrantX}
          x2={quadrantX}
          y1={M.top}
          y2={M.top + H}
          stroke={palette.grid}
          strokeDasharray="3 3"
        />
        <line
          x1={M.left}
          x2={M.left + W}
          y1={quadrantY}
          y2={quadrantY}
          stroke={palette.grid}
          strokeDasharray="3 3"
        />

        {/* Axis labels */}
        <text
          x={M.left + W / 2}
          y={height - 12}
          textAnchor="middle"
          fontSize={12}
          fill={palette.text}
        >
          {axisXLabel}
        </text>
        <text
          x={14}
          y={M.top + H / 2}
          fontSize={12}
          fill={palette.text}
          textAnchor="middle"
          transform={`rotate(-90, 14, ${M.top + H / 2})`}
        >
          {axisYLabel}
        </text>

        {xMinLabel && (
          <text x={M.left} y={height - 28} textAnchor="start" fontSize={10} fill={palette.axis}>
            {xMinLabel}
          </text>
        )}
        {xMaxLabel && (
          <text x={M.left + W} y={height - 28} textAnchor="end" fontSize={10} fill={palette.axis}>
            {xMaxLabel}
          </text>
        )}
        {yMinLabel && (
          <text
            x={32}
            y={M.top + H}
            textAnchor="start"
            fontSize={10}
            fill={palette.axis}
            transform={`rotate(-90, 32, ${M.top + H})`}
          >
            {yMinLabel}
          </text>
        )}
        {yMaxLabel && (
          <text
            x={32}
            y={M.top + 8}
            textAnchor="end"
            fontSize={10}
            fill={palette.axis}
            transform={`rotate(-90, 32, ${M.top + 8})`}
          >
            {yMaxLabel}
          </text>
        )}

        {/* Optional quadrant captions — corner-anchored, single line each.
            Rendered before bubbles so a stray bubble never sits on top of
            the label legibly. */}
        {quadrantLabels && (
          <g pointerEvents="none">
            {(() => {
              const toneFill = (t?: 'positive' | 'negative' | 'neutral') =>
                t === 'positive' ? palette.positive
                : t === 'negative' ? palette.negative
                : palette.text;
              const corners: Array<{
                k: 'topRight' | 'topLeft' | 'bottomRight' | 'bottomLeft';
                x: number; y: number; anchor: 'start' | 'end';
              }> = [
                { k: 'topRight',    x: M.left + W - 8, y: M.top + 16,         anchor: 'end' },
                { k: 'topLeft',     x: M.left + 8,     y: M.top + 16,         anchor: 'start' },
                { k: 'bottomRight', x: M.left + W - 8, y: M.top + H - 8,      anchor: 'end' },
                { k: 'bottomLeft',  x: M.left + 8,     y: M.top + H - 8,      anchor: 'start' },
              ];
              return corners.map((c) => {
                const cfg = quadrantLabels[c.k];
                if (!cfg) return null;
                return (
                  <text
                    key={c.k}
                    x={c.x}
                    y={c.y}
                    textAnchor={c.anchor}
                    fontSize={11}
                    fontWeight={600}
                    fill={toneFill(cfg.tone)}
                    style={{ letterSpacing: '0.06em' }}
                    opacity={0.85}
                  >
                    {cfg.label}
                  </text>
                );
              });
            })()}
          </g>
        )}

        {/* Bubbles */}
        {bubbles.map((b) => {
          const cx = M.left + (b.x / 100) * W;
          const cy = M.top + H - (b.y / 100) * H;
          const r = radius(b);
          const lowData = (b.dataCompletenessPct ?? 100) < 50;
          return (
            <g key={b.id} style={{ cursor: onBubbleClick ? 'pointer' : 'default' }}>
              <circle
                cx={cx}
                cy={cy}
                r={r}
                fill={colorFor(b)}
                fillOpacity={lowData ? 0.25 : 0.55}
                stroke={colorFor(b)}
                strokeOpacity={0.9}
                strokeWidth={lowData ? 1 : 1.5}
                strokeDasharray={lowData ? '2 2' : undefined}
                onMouseEnter={() => setHovered(b)}
                onMouseLeave={() => setHovered((prev) => (prev?.id === b.id ? null : prev))}
                onClick={() => onBubbleClick?.(b)}
              >
                <title>{`${b.label}${lowData ? ' (low data completeness)' : ''}`}</title>
              </circle>
            </g>
          );
        })}
      </svg>

      {/* Hover details. Fixed position below the SVG keeps layout stable. */}
      <div className="mt-2 min-h-[2rem] text-sm text-text-secondary">
        {hovered ? (
          <span>
            <strong className="text-text-primary">{hovered.label}</strong>
            {' · '}
            {axisXLabel} {Math.round(hovered.x)}
            {' · '}
            {axisYLabel} {Math.round(hovered.y)}
            {' · '}
            size {Math.round(hovered.size).toLocaleString('en-US')}
            {' · '}
            contrib {hovered.color >= 0 ? '+' : ''}
            {Math.round(hovered.color).toLocaleString('en-US')}
            {hovered.dataCompletenessPct !== undefined && hovered.dataCompletenessPct < 100 && (
              <span className="text-text-tertiary">
                {' · '}data {Math.round(hovered.dataCompletenessPct)}%
              </span>
            )}
          </span>
        ) : (
          <span className="text-text-tertiary">Hover a bubble to see details.</span>
        )}
      </div>
    </div>
  );
}
