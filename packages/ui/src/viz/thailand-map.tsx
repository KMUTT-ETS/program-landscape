'use client';

import * as React from 'react';
import { cn } from '../lib/cn';
import { useChartPalette } from './chart-theme';

// Schematic Thailand regional map. NOT a real choropleth — a true
// province-level GeoJSON + demographics join is deferred to prompt 14
// with the KKU-Alumni real data pipeline. For now we render 6 regional
// blocks (North, Northeast/Isaan, Central, East, West, South) with
// colour intensity reflecting demand/supply imbalance.
//
// The Northeast (Isaan) is called out with a heavier border because it
// is KKU's primary mandate region — readers should always see where
// "our" region sits relative to the rest of the country.

export type MapIntensity = 'demand-heavy' | 'supply-heavy' | 'balanced' | 'no-data';

export interface ThailandRegion {
  code: string; // 'N' | 'NE' | 'C' | 'E' | 'W' | 'S'
  nameEn: string;
  nameTh: string;
  intensity: MapIntensity;
  demand: number;
  supply: number;
}

export interface ThailandMapProps {
  regions: ThailandRegion[];
  highlightRegionCode?: string;
  width?: number;
  height?: number;
  className?: string;
  onRegionClick?: (region: ThailandRegion) => void;
}

// Coordinates are intentionally schematic (not cartographically
// accurate) — each region is a labelled rectangle placed in the
// approximate geographic quadrant. Keeps the visual legible at small
// sizes and avoids ~500 KB of GeoJSON in the bundle.
const REGION_LAYOUT: Record<string, { x: number; y: number; w: number; h: number }> = {
  N: { x: 60, y: 20, w: 100, h: 90 },
  NE: { x: 160, y: 20, w: 160, h: 120 },
  W: { x: 30, y: 110, w: 70, h: 120 },
  C: { x: 110, y: 110, w: 80, h: 90 },
  E: { x: 200, y: 140, w: 120, h: 70 },
  S: { x: 100, y: 220, w: 90, h: 180 },
};

export function ThailandMap({
  regions,
  highlightRegionCode = 'NE',
  width = 360,
  height = 440,
  className,
  onRegionClick,
}: ThailandMapProps) {
  const palette = useChartPalette();

  const fillFor = (intensity: MapIntensity): string => {
    switch (intensity) {
      case 'demand-heavy':
        return palette.negative;
      case 'supply-heavy':
        return palette.series[1] ?? palette.positive;
      case 'balanced':
        return palette.neutral;
      case 'no-data':
        return palette.grid;
      default:
        return palette.grid;
    }
  };

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <svg width={width} height={height} role="img" aria-label="Thailand regional gap map">
        <rect x={0} y={0} width={width} height={height} fill="transparent" />
        {regions.map((r) => {
          const box = REGION_LAYOUT[r.code];
          if (!box) return null;
          const isHighlight = r.code === highlightRegionCode;
          return (
            <g
              key={r.code}
              onClick={onRegionClick ? () => onRegionClick(r) : undefined}
              style={onRegionClick ? { cursor: 'pointer' } : undefined}
            >
              <rect
                x={box.x}
                y={box.y}
                width={box.w}
                height={box.h}
                fill={fillFor(r.intensity)}
                fillOpacity={0.65}
                stroke={isHighlight ? palette.text : palette.grid}
                strokeWidth={isHighlight ? 2 : 1}
                rx={6}
              />
              <text x={box.x + box.w / 2} y={box.y + box.h / 2 - 4} textAnchor="middle" fontSize={13} fontWeight={600} fill={palette.text}>
                {r.nameEn}
              </text>
              <text x={box.x + box.w / 2} y={box.y + box.h / 2 + 12} textAnchor="middle" fontSize={10} fill={palette.text}>
                {r.nameTh}
              </text>
              <text x={box.x + box.w / 2} y={box.y + box.h - 6} textAnchor="middle" fontSize={10} fill={palette.axis}>
                gap {(r.demand - r.supply).toFixed(0)}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="flex items-center gap-3 text-xs text-text-tertiary">
        <LegendSwatch color={palette.negative} label="Demand > supply" />
        <LegendSwatch color={palette.series[1] ?? palette.positive} label="Supply > demand" />
        <LegendSwatch color={palette.neutral} label="Balanced" />
        <LegendSwatch color={palette.grid} label="No data" />
      </div>
      <p className="text-[10px] leading-tight text-text-tertiary">
        Schematic regions — true province-level choropleth ships with prompt 14 (KKU-Alumni real data).
      </p>
    </div>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        aria-hidden
        className="inline-block h-3 w-3 rounded-sm"
        style={{ backgroundColor: color, opacity: 0.65 }}
      />
      {label}
    </span>
  );
}
