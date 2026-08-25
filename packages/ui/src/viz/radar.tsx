'use client';

import * as React from 'react';
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Tooltip,
  Legend,
} from 'recharts';
import { useChartPalette } from './chart-theme';

// Radar for the 5-dim health score on the deep-dive header. Recharts'
// RadarChart with hand-tuned grid + axis colours via the palette hook.
// Width/height are explicit so it plays nicely with server-rendered
// parents (no ResponsiveContainer).
//
// Null handling — important for the Council audience:
//   - A null dimension means "no data", NOT "scored zero".
//   - We render the polygon ONLY across dimensions that have data
//     (drops the misleading "crashes to 0" line that the previous
//     version drew on null dims).
//   - Null axis labels are suffixed with a small marker so the
//     reader can see at-a-glance which dims have no underlying data.
//   - When EVERY dimension is null, we render a placeholder message
//     instead of an empty chart.

export interface RadarPoint {
  label: string;
  // 0-100, or null when no data.
  value: number | null;
}

// Optional benchmark overlays (e.g. University / Faculty averages on the
// deep-dive Health radar). Each comparison's points align by index with
// the main `points`. Rendered as stroke-only dashed polygons over the
// filled primary series, with a legend.
export interface RadarComparison {
  label: string;
  points: RadarPoint[];
}

export interface RadarChartSmallProps {
  points: RadarPoint[];
  width?: number;
  height?: number;
  seriesLabel?: string;
  comparisons?: RadarComparison[];
  /**
   * Radial axis range. Defaults to the full [0, 100] health scale.
   *
   * Pass a narrower range ONLY when a full-scale plot would be
   * unreadable — e.g. student-evaluation or competency scores, which
   * cluster in a 20-point band near the top and render as an almost
   * perfect circle against a 0-100 axis.
   *
   * A non-zero floor exaggerates differences, which is exactly how
   * radar charts mislead. If you pass one, two obligations follow:
   * the floor must sit at or below the smallest plotted value across
   * EVERY series (otherwise points are silently clipped to the centre
   * and a very low score becomes indistinguishable from a mediocre
   * one), and the surrounding UI must state the floor in words. The
   * axis ticks show it, but a reader scanning shapes will not read
   * them.
   */
  domain?: [number, number];
}

const NO_DATA_SUFFIX = ' · n/d';

/**
 * Horizontal room reserved on each side for axis labels, in px.
 *
 * Sized against the longest side label at fontSize 11 ('Relevance',
 * ~55px) plus a little slack. Recharts derives its outerRadius from the
 * box left after margins, so raising this shrinks the polygon — do not
 * raise it further without checking the radar still reads at 280px wide.
 */
const LABEL_GUTTER_PX = 56;

interface AngleTickProps {
  x?: number;
  y?: number;
  cx?: number;
  payload?: { value?: string | number };
  fill: string;
}

/**
 * Axis label for the radar.
 *
 * Two things Recharts' default tick does not do for us:
 *
 *  1. Anchors the text AWAY from the centre — labels on the right start
 *     at the vertex and run right, labels on the left end at it and run
 *     left. With a single shared anchor the outermost labels overhang the
 *     SVG and get clipped mid-word.
 *  2. Puts the ' · n/d' missing-data suffix on its own smaller line, so an
 *     empty dimension does not make its label ~30px wider than the gutter
 *     was sized for.
 */
function AngleTick({ x, y, cx, payload, fill }: AngleTickProps): React.ReactElement | null {
  if (x === undefined || y === undefined) return null;
  const raw = String(payload?.value ?? '');
  const isEmpty = raw.endsWith(NO_DATA_SUFFIX);
  const label = isEmpty ? raw.slice(0, -NO_DATA_SUFFIX.length) : raw;
  // A near-zero horizontal offset means top/bottom — centre those.
  const offset = cx === undefined ? 0 : x - cx;
  const anchor = Math.abs(offset) < 8 ? 'middle' : offset > 0 ? 'start' : 'end';
  return (
    <text x={x} y={y} textAnchor={anchor} fill={fill} fontSize={11} dominantBaseline="middle">
      <tspan>{label}</tspan>
      {isEmpty && (
        <tspan x={x} dy="1.15em" fontSize={9} opacity={0.75}>
          {NO_DATA_SUFFIX.trim()}
        </tspan>
      )}
    </text>
  );
}

export function RadarChartSmall({
  points,
  width = 280,
  height = 240,
  seriesLabel = 'Health',
  comparisons = [],
  domain = [0, 100],
}: RadarChartSmallProps) {
  const palette = useChartPalette();
  // Mount-guard: Recharts internals can produce slightly different
  // markup between SSR and the first client render (e.g. clip-path
  // ids, label positions), which Next 14 surfaces as a hydration
  // mismatch. Render a same-sized placeholder during SSR; mount on
  // the client.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  // Series the user has toggled off via the legend (by dataKey:
  // 'value' = this program, 'cmp<i>' = a comparison overlay).
  const [hidden, setHidden] = React.useState<Set<string>>(new Set());
  const toggleSeries = (key: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  if (!mounted) {
    return (
      <div
        style={{ width, height }}
        className="flex items-center justify-center rounded-md border border-dashed border-border-subtle text-xs text-text-tertiary"
      >
        Loading…
      </div>
    );
  }
  const populated = points.filter((p) => p.value !== null);
  if (populated.length === 0) {
    return (
      <div
        style={{ width, height }}
        className="flex items-center justify-center rounded-md border border-dashed border-border-subtle text-xs text-text-tertiary"
      >
        Health radar unavailable — every dimension is missing data.
      </div>
    );
  }
  // Plot all 5 axes (so the radar's structure stays stable across
  // programs) but the value series is `null` on missing dims, which
  // Recharts renders as a gap — the polygon connects only the dims
  // with real data. Comparison overlays (University / Faculty averages)
  // ride alongside as `cmp<i>` keys, aligned by index.
  const data = points.map((p, i) => {
    const row: Record<string, string | number | boolean | null> = {
      subject: p.value === null ? p.label + NO_DATA_SUFFIX : p.label,
      value: p.value,
      hasData: p.value !== null,
    };
    comparisons.forEach((c, ci) => {
      row[`cmp${ci}`] = c.points[i]?.value ?? null;
    });
    return row;
  });
  const hasComparisons = comparisons.length > 0;
  // Make room for the legend when overlays are present.
  const chartHeight = hasComparisons ? height + 28 : height;
  return (
    <RadarChart
      width={width}
      height={chartHeight}
      data={data}
      /* Without a horizontal margin Recharts centres the polygon in the
       * full width and the axis labels render past both edges, where the
       * SVG clips them — 'Relevance' lost its leading 'R', 'Financial'
       * its trailing 'l'. The margin reserves label room; Recharts derives
       * a smaller outerRadius from the remaining box automatically.
       * LABEL_GUTTER_PX must stay >= the widest label at fontSize 11,
       * including the ' · n/d' suffix an empty dimension carries. */
      margin={{ top: 8, right: LABEL_GUTTER_PX, bottom: 8, left: LABEL_GUTTER_PX }}
    >
      <PolarGrid stroke={palette.grid} />
      <PolarAngleAxis
        dataKey="subject"
        stroke={palette.axis}
        tick={<AngleTick fill={palette.text} />}
      />
      {/* The scale ray must not sit on a spoke. Recharts puts the first
        * data point at 90° (straight up) and steps 360/n per axis, so
        * angle={90} drew the tick labels directly under the first axis
        * label and the two collided. Half a step off a spoke is empty
        * space at every radius.
        *
        * Derived rather than hardcoded: this used to be a literal 54,
        * correct for the 5-dimension health radar it was written for
        * (90 - 36). The DQ radars plot 13 and 4 axes, where 54° lands
        * back ON a spoke and the tick labels crowd it. The formula is
        * the one the original comment instructed a later reader to
        * apply; n=5 still yields exactly 54, so the health radar is
        * unchanged. */}
      <PolarRadiusAxis
        angle={points.length > 0 ? 90 - 360 / points.length / 2 : 54}
        domain={domain}
        tick={{ fill: palette.axis, fontSize: 10 }}
        stroke={palette.grid}
      />
      <Tooltip
        formatter={(v) =>
          v === null || v === undefined || v === '' ? 'no data' : String(Math.round(Number(v)))
        }
        contentStyle={{
          border: `1px solid ${palette.grid}`,
          fontSize: 12,
        }}
      />
      {hasComparisons && (
        <Legend
          wrapperStyle={{ fontSize: 11, cursor: 'pointer' }}
          iconSize={10}
          onClick={(entry) => {
            // Our series use string dataKeys ('value' / 'cmp<i>'); ignore
            // the (typed-but-never-used-here) function-dataKey case.
            if (typeof entry?.dataKey === 'string') toggleSeries(entry.dataKey);
          }}
        />
      )}
      <Radar
        name={seriesLabel}
        dataKey="value"
        stroke={palette.series[0] ?? palette.text}
        fill={palette.series[0] ?? palette.text}
        fillOpacity={0.3}
        connectNulls={false}
        isAnimationActive={false}
        dot={{ r: 3 }}
        hide={hidden.has('value')}
      />
      {comparisons.map((c, ci) => {
        const stroke = palette.series[(ci + 1) % palette.series.length] ?? palette.text;
        return (
          <Radar
            key={`cmp${ci}`}
            name={c.label}
            dataKey={`cmp${ci}`}
            stroke={stroke}
            fill="none"
            strokeWidth={1.75}
            strokeDasharray="4 3"
            connectNulls={false}
            isAnimationActive={false}
            dot={{ r: 2 }}
            hide={hidden.has(`cmp${ci}`)}
          />
        );
      })}
    </RadarChart>
  );
}
