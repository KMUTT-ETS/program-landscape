// Tiny inline-SVG bar chart of publications-per-year (last 5 years).
// Server-renderable (no client JS, no charting library); theme-aware
// via oklch CSS vars (light + dark mode automatic). Designed for the
// 25% personal slice on the welcome home — must render in <5ms and
// stay visually small (≤ 6rem tall).
//
// Inputs: array of { year, count } in any order. Component sorts +
// pads to a fixed last-N-years window so empty years still render.

import * as React from 'react';

interface YearCount {
  year: number;
  count: number;
}

interface Props {
  data: YearCount[];
  /** how many years to show, ending at the latest year present (default 5) */
  yearsBack?: number;
  /** label rendered above the bars (e.g., "Publications") */
  label?: string;
  /** optional subtitle (e.g., "Last 5 years · Scopus + PubMed") */
  sub?: string;
}

export function PublicationsSparkline({
  data,
  yearsBack = 5,
  label = 'Publications',
  sub,
}: Props) {
  // Pad missing years with zeros — fixed-window so the visual is
  // stable across users with very different output volumes.
  const latestYear =
    data.length > 0
      ? Math.max(...data.map((d) => d.year))
      : new Date().getUTCFullYear();
  const startYear = latestYear - yearsBack + 1;
  const byYear = new Map(data.map((d) => [d.year, d.count]));
  const series: YearCount[] = [];
  for (let y = startYear; y <= latestYear; y++) {
    series.push({ year: y, count: byYear.get(y) ?? 0 });
  }

  const max = Math.max(1, ...series.map((s) => s.count));
  const total = series.reduce((acc, s) => acc + s.count, 0);

  // SVG geometry — fixed viewBox so it scales nicely. 100 units wide
  // per bar group keeps integer arithmetic clean.
  const barW = 14;
  const barGap = 6;
  const chartH = 48;
  const labelH = 12;
  const totalW = series.length * (barW + barGap) - barGap;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-text-tertiary">
          {label}
        </p>
        <p className="font-tabular text-xs text-text-secondary">
          {total} total · last {yearsBack}y
        </p>
      </div>
      {sub && <p className="text-[10px] text-text-tertiary">{sub}</p>}
      <svg
        viewBox={`0 0 ${totalW} ${chartH + labelH}`}
        width="100%"
        height="60"
        role="img"
        aria-label={`${label}: ${total} total over the last ${yearsBack} years`}
        style={{ overflow: 'visible' }}
      >
        {series.map((s, i) => {
          const h = (s.count / max) * chartH;
          const x = i * (barW + barGap);
          const y = chartH - h;
          return (
            <g key={s.year}>
              {/* baseline track — subtle backdrop so empty years still register */}
              <rect
                x={x}
                y={0}
                width={barW}
                height={chartH}
                rx={2}
                fill="oklch(var(--color-surface-2) / 0.6)"
              />
              {/* the bar — accent colour, height proportional to count */}
              {s.count > 0 && (
                <rect
                  x={x}
                  y={y}
                  width={barW}
                  height={h}
                  rx={2}
                  fill="oklch(var(--color-accent-default))"
                />
              )}
              {/* count label above the bar (only when count > 0 to reduce
                  clutter for empty years) */}
              {s.count > 0 && (
                <text
                  x={x + barW / 2}
                  y={y - 2}
                  textAnchor="middle"
                  fontSize="9"
                  fill="oklch(var(--color-text-secondary))"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {s.count}
                </text>
              )}
              {/* year label below */}
              <text
                x={x + barW / 2}
                y={chartH + 10}
                textAnchor="middle"
                fontSize="9"
                fill="oklch(var(--color-text-tertiary))"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {String(s.year).slice(2)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
