'use client';

import * as React from 'react';
import { cn } from '../lib/cn';
import { useChartPalette } from './chart-theme';

// Trends Radar — polar scatter with concentric time rings. Inspired by
// futures-radar tools but simplified: each dot is one TrendSignal,
// angle = signal type (wedge), radius = "how far out" (time since
// detection — today dots sit near the centre, older dots drift out).
//
// Impact is encoded by dot radius (bigger = higher impact) AND colour
// opacity. A Council member's attention naturally lands on the biggest
// and reddest dots in the centre ring.
//
// NOT Recharts — Recharts' PolarScatter is limited and doesn't handle
// the concentric-ring framing well. Hand-rolled SVG.

export type TrendSignalType = 'POLICY' | 'RESEARCH' | 'MARKET' | 'TECH' | 'NEWS';

export interface TrendDot {
  id: string;
  title: string;
  signalType: TrendSignalType;
  detectedAtMsAgo: number; // 0 = now; 30*24*60*60*1000 = 30 days ago, etc.
  impactScore: number;     // 0-1
}

// Wedge order — fixed so the shape is stable across renders.
const TYPE_ORDER: TrendSignalType[] = ['POLICY', 'RESEARCH', 'MARKET', 'TECH', 'NEWS'];

// Concentric-ring labels. Rings are evenly spaced; these are the
// "tick" labels. 0d → "Now", 30d → "1mo", 90d → "3mo", 365d → "1yr".
const RING_LABELS = [
  { label: 'Now', msAgo: 0 },
  { label: '1 mo', msAgo: 30 * 24 * 60 * 60 * 1000 },
  { label: '3 mo', msAgo: 90 * 24 * 60 * 60 * 1000 },
  { label: '1 yr', msAgo: 365 * 24 * 60 * 60 * 1000 },
];

export interface TrendsRadarProps {
  dots: TrendDot[];
  size?: number;
  onDotClick?: (d: TrendDot) => void;
  highlightedSignalId?: string | null;
  className?: string;
}

export function TrendsRadar({
  dots,
  size = 420,
  onDotClick,
  highlightedSignalId = null,
  className,
}: TrendsRadarProps) {
  const palette = useChartPalette();
  const [hovered, setHovered] = React.useState<TrendDot | null>(null);
  const cx = size / 2;
  const cy = size / 2;
  const maxR = size / 2 - 18;
  const minR = 12;

  const maxMsAgo = Math.max(...RING_LABELS.map((r) => r.msAgo));
  const radiusForMsAgo = (ms: number) => {
    const clamped = Math.max(0, Math.min(ms, maxMsAgo));
    return minR + (clamped / maxMsAgo) * (maxR - minR);
  };

  // Angle per type: full circle divided into TYPE_ORDER.length wedges.
  const wedgeSpan = (2 * Math.PI) / TYPE_ORDER.length;
  const angleForType = (t: TrendSignalType) => {
    const idx = TYPE_ORDER.indexOf(t);
    // Center of the wedge, with a deterministic jitter per dot id so
    // coincident signals don't stack.
    return idx * wedgeSpan - Math.PI / 2 + wedgeSpan / 2;
  };

  const dotRadius = (score: number) => 4 + score * 10; // 4-14 px
  const dotOpacity = (score: number) => 0.35 + score * 0.55;

  // Deterministic per-id jitter within the wedge to avoid overlap.
  const jitter = (id: string) => {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffff;
    // −0.4..+0.4 of the wedge span
    return ((h % 1000) / 1000 - 0.5) * 0.8 * wedgeSpan;
  };

  return (
    <div className={cn('flex flex-col items-center gap-2', className)}>
      <svg width={size} height={size} role="img" aria-label="Trends radar">
        {/* Concentric rings */}
        {RING_LABELS.slice(1).map((r) => (
          <circle
            key={r.label}
            cx={cx}
            cy={cy}
            r={radiusForMsAgo(r.msAgo)}
            fill="none"
            stroke={palette.grid}
            strokeDasharray="2 3"
          />
        ))}
        {/* Ring labels on the top edge */}
        {RING_LABELS.map((r) => (
          <text
            key={r.label}
            x={cx + 4}
            y={cy - radiusForMsAgo(r.msAgo) - 3}
            fontSize={10}
            fill={palette.axis}
          >
            {r.label}
          </text>
        ))}
        {/* Wedge dividers + labels */}
        {TYPE_ORDER.map((t, i) => {
          const a = i * wedgeSpan - Math.PI / 2;
          const x2 = cx + Math.cos(a) * maxR;
          const y2 = cy + Math.sin(a) * maxR;
          const labelA = a + wedgeSpan / 2;
          const labelR = maxR + 2;
          const lx = cx + Math.cos(labelA) * labelR;
          const ly = cy + Math.sin(labelA) * labelR;
          const color = palette.series[i % palette.series.length] ?? palette.text;
          return (
            <g key={t}>
              <line x1={cx} y1={cy} x2={x2} y2={y2} stroke={palette.grid} />
              <text
                x={lx}
                y={ly}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={11}
                fill={color}
              >
                {t}
              </text>
            </g>
          );
        })}
        {/* Dots */}
        {dots.map((d) => {
          const a = angleForType(d.signalType) + jitter(d.id);
          const r = radiusForMsAgo(d.detectedAtMsAgo);
          const x = cx + Math.cos(a) * r;
          const y = cy + Math.sin(a) * r;
          const typeIdx = TYPE_ORDER.indexOf(d.signalType);
          const color =
            palette.series[typeIdx % palette.series.length] ?? palette.text;
          const isHighlighted = highlightedSignalId === d.id || hovered?.id === d.id;
          return (
            <circle
              key={d.id}
              cx={x}
              cy={y}
              r={dotRadius(d.impactScore)}
              fill={color}
              fillOpacity={dotOpacity(d.impactScore)}
              stroke={isHighlighted ? color : 'transparent'}
              strokeWidth={isHighlighted ? 2 : 0}
              style={{ cursor: onDotClick ? 'pointer' : 'default' }}
              onMouseEnter={() => setHovered(d)}
              onMouseLeave={() =>
                setHovered((prev) => (prev?.id === d.id ? null : prev))
              }
              onClick={() => onDotClick?.(d)}
            >
              <title>
                {d.title} · {d.signalType} · impact {(d.impactScore * 100).toFixed(0)}
              </title>
            </circle>
          );
        })}
      </svg>
      <div className="min-h-[1.25rem] text-center text-xs text-text-secondary">
        {hovered ? (
          <>
            <strong className="text-text-primary">{hovered.title}</strong> · {hovered.signalType} ·
            impact {(hovered.impactScore * 100).toFixed(0)}
          </>
        ) : (
          <span className="text-text-tertiary">
            Dot size + opacity = impact · distance from centre = time since detection
          </span>
        )}
      </div>
    </div>
  );
}
