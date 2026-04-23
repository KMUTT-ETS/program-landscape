/* eslint-disable no-restricted-syntax --
 * Hex literals ARE the right thing here. PDFs are always light-theme
 * regardless of user preference, and CSS variables cannot be resolved
 * inside server-rendered SVG — Gotenberg receives the rendered HTML
 * with no <html> that has a theme to read off. The PRINT_PALETTE array
 * below is the evaluated light version of the chart tokens; mirror any
 * change to packages/design/src/css/tokens.css here in the same commit.
 */
import type { ReactNode } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  BarChart,
  Bar,
} from 'recharts';

// ChartForPrint — a Recharts wrapper that is safe to render with
// `renderToStaticMarkup`.
//
// Why this is NOT just `<Chart>` from packages/ui:
//   - No ResponsiveContainer. ResponsiveContainer measures its parent
//     at runtime — in SSR that parent is `undefined`, so the chart
//     renders at 0×0. We take explicit width + height instead.
//   - No theme tokens via CSS variables. PDFs are always light, so we
//     pass literal light-mode hex colours straight to Recharts. These
//     are the light-mode OKLCH tokens evaluated offline and recorded
//     here — update if packages/design/src/css/tokens.css changes.
//   - No hover, no tooltips, no animation. SSR doesn't need them, and
//     animation would make the rendered SVG still be mid-transition
//     when Gotenberg snapshots.

// Evaluated from packages/design/src/css/tokens.css → [data-theme='light']
// Kept in sync manually — there is no runtime CSS var resolution inside
// a server-rendered SVG. Changes to the chart palette tokens must be
// mirrored here in the same commit.
export const PRINT_PALETTE = [
  '#2B4BA4',  // chart-1 — indigo
  '#9C1D2E',  // chart-2 — KKU cardinal
  '#046C4E',  // chart-3 — green
  '#A15C00',  // chart-4 — amber
  '#5E2D90',  // chart-5 — violet
  '#00716B',  // chart-6 — teal
  '#8A1A57',  // chart-7 — magenta
  '#5E5E5E',  // chart-8 — slate
  '#7A4A18',  // chart-9 — brown
  '#386018',  // chart-10 — olive
  '#1C4587',  // chart-11 — deep blue
  '#7A3E00',  // chart-12 — rust
];

const AXIS_COLOR = '#555';
const GRID_COLOR = '#e7e4db';
const LABEL_COLOR = '#333';

export interface ChartFrameForPrintProps {
  title: string;
  caption?: string;
  children: ReactNode;
}

export function ChartFrameForPrint({ title, caption, children }: ChartFrameForPrintProps) {
  return (
    <div className="chart-frame">
      <div className="chart-title">{title}</div>
      {children}
      {caption && <div className="chart-caption">{caption}</div>}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Concrete chart wrappers. Kept minimal — the module templates compose them.
// ────────────────────────────────────────────────────────────────────────────

export interface PrintLinePoint {
  x: string | number;
  [series: string]: string | number;
}

export interface PrintLineChartProps {
  data: PrintLinePoint[];
  series: Array<{ key: string; label: string; color?: string }>;
  width?: number;
  height?: number;
  xLabel?: string;
  yLabel?: string;
}

export function PrintLineChart(props: PrintLineChartProps) {
  const width = props.width ?? 560;
  const height = props.height ?? 260;
  return (
    <LineChart
      data={props.data}
      width={width}
      height={height}
      margin={{ top: 8, right: 16, bottom: 24, left: 40 }}
    >
      <CartesianGrid stroke={GRID_COLOR} strokeDasharray="2 2" />
      <XAxis
        dataKey="x"
        stroke={AXIS_COLOR}
        tick={{ fill: LABEL_COLOR, fontSize: 11 }}
        label={
          props.xLabel
            ? { value: props.xLabel, position: 'insideBottom', offset: -8, fill: LABEL_COLOR, fontSize: 11 }
            : undefined
        }
      />
      <YAxis
        stroke={AXIS_COLOR}
        tick={{ fill: LABEL_COLOR, fontSize: 11 }}
        label={
          props.yLabel
            ? { value: props.yLabel, angle: -90, position: 'insideLeft', fill: LABEL_COLOR, fontSize: 11 }
            : undefined
        }
      />
      {props.series.map((s, i) => (
        <Line
          key={s.key}
          type="monotone"
          dataKey={s.key}
          stroke={s.color ?? PRINT_PALETTE[i % PRINT_PALETTE.length]}
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
      ))}
    </LineChart>
  );
}

export interface PrintBarChartProps {
  data: Array<Record<string, string | number>>;
  xKey: string;
  series: Array<{ key: string; label: string; color?: string }>;
  width?: number;
  height?: number;
  xLabel?: string;
  yLabel?: string;
}

export function PrintBarChart(props: PrintBarChartProps) {
  const width = props.width ?? 560;
  const height = props.height ?? 260;
  return (
    <BarChart
      data={props.data}
      width={width}
      height={height}
      margin={{ top: 8, right: 16, bottom: 24, left: 40 }}
    >
      <CartesianGrid stroke={GRID_COLOR} strokeDasharray="2 2" />
      <XAxis
        dataKey={props.xKey}
        stroke={AXIS_COLOR}
        tick={{ fill: LABEL_COLOR, fontSize: 11 }}
        label={
          props.xLabel
            ? { value: props.xLabel, position: 'insideBottom', offset: -8, fill: LABEL_COLOR, fontSize: 11 }
            : undefined
        }
      />
      <YAxis
        stroke={AXIS_COLOR}
        tick={{ fill: LABEL_COLOR, fontSize: 11 }}
        label={
          props.yLabel
            ? { value: props.yLabel, angle: -90, position: 'insideLeft', fill: LABEL_COLOR, fontSize: 11 }
            : undefined
        }
      />
      {props.series.map((s, i) => (
        <Bar
          key={s.key}
          dataKey={s.key}
          fill={s.color ?? PRINT_PALETTE[i % PRINT_PALETTE.length]}
          isAnimationActive={false}
        />
      ))}
    </BarChart>
  );
}
