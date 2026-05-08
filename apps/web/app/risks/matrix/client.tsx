'use client';

import * as React from 'react';
import Link from 'next/link';
import type { PortfolioRiskRow, KkuRiskLevel } from '../types';
import { KKU_LEVEL_FILL, KKU_LEVEL_LABEL } from '../types';
import { KkuRiskMatrix } from '../viz';

const W = 900;
const H = 520;
const M = { top: 20, right: 30, bottom: 50, left: 64 };
const PLOT_W = W - M.left - M.right;
const PLOT_H = H - M.top - M.bottom;

// Bubble colour comes from the program's ERM level (L × I score band), NOT
// the composite tier. The plot's two axes ARE likelihood and impact, so a
// bubble's position implies the ERM level — colour must match that, not
// the analytic composite tier (which discounts L2 for risk-aversion).
//
// ERM bands per KKU criteria:
//   1–4   green (LOW)
//   5–9   yellow (MODERATE)
//   10–15 orange (HIGH)
//   16–25 red (VERY_HIGH)
const ERM_FILL: Record<KkuRiskLevel, string> = {
  NEEDS_DATA: 'rgb(100 116 139 / 0.55)',
  LOW: 'rgb(34 197 94 / 0.75)',
  MODERATE: 'rgb(234 179 8 / 0.80)',
  HIGH: 'rgb(249 115 22 / 0.80)',
  VERY_HIGH: 'rgb(220 38 38 / 0.85)',
};

const ERM_STROKE: Record<KkuRiskLevel, string> = {
  NEEDS_DATA: 'rgb(71 85 105)',
  LOW: 'rgb(22 163 74)',
  MODERATE: 'rgb(202 138 4)',
  HIGH: 'rgb(234 88 12)',
  VERY_HIGH: 'rgb(185 28 28)',
};

interface Bubble {
  row: PortfolioRiskRow;
  cx: number;
  cy: number;
  r: number;
}

export function RiskMatrixClient({
  rows,
  methodology,
  kkuMatrixCells,
  kkuLevelCounts,
}: {
  rows: PortfolioRiskRow[];
  methodology: string;
  kkuMatrixCells: number[][];
  kkuLevelCounts: Record<KkuRiskLevel, number>;
}) {
  const [hovered, setHovered] = React.useState<string | null>(null);
  const [view, setView] = React.useState<'bubble' | 'kku'>('bubble');
  const [selectedCell, setSelectedCell] = React.useState<{ likelihood: number; impact: number } | null>(null);

  const filteredRows = React.useMemo(() => {
    if (!selectedCell) return rows;
    return rows.filter(
      (r) => r.likelihoodBin === selectedCell.likelihood && r.impactBin === selectedCell.impact,
    );
  }, [rows, selectedCell]);

  const bubbles: Bubble[] = React.useMemo(() => {
    // Exclude NEEDS_DATA tier — these programs have unmeasured impact (no
    // FinancialMetric data, or no L1+L2 signal) and would mislead by
    // clustering at the bottom of the impact axis.
    const valid = rows.filter((r) => r.composite != null && r.tier !== 'NEEDS_DATA');
    if (valid.length === 0) return [];
    const xValues = valid.map((r) => r.composite ?? 0);
    const xMin = 0;
    const xMax = 100;
    const yValues = valid.map((r) => r.impactScore ?? 0);
    const yMin = 0;
    const yMax = Math.max(100, ...yValues);

    return valid.map((r) => {
      const x = ((r.composite ?? 0) - xMin) / (xMax - xMin);
      const y = ((r.impactScore ?? 0) - yMin) / (yMax - yMin);
      const cx = M.left + x * PLOT_W;
      const cy = M.top + (1 - y) * PLOT_H;
      const headcountSeed = (r.directRevenueAtRiskThb ?? 0) / 1e7;
      const r_ = Math.max(5, Math.min(18, 5 + Math.sqrt(headcountSeed)));
      return { row: r, cx, cy, r: r_ };
    });
  }, [rows]);

  // Bubble counts grouped by ERM level (matches bubble colour).
  const ermCounts = React.useMemo(() => {
    const c: Record<KkuRiskLevel, number> = {
      NEEDS_DATA: 0,
      LOW: 0,
      MODERATE: 0,
      HIGH: 0,
      VERY_HIGH: 0,
    };
    for (const b of bubbles) c[b.row.kkuRiskLevel] += 1;
    return c;
  }, [bubbles]);

  return (
    <div className="space-y-4">
      {/* View toggle */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-border-default bg-surface-1 p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setView('bubble')}
            className={`rounded px-3 py-1 transition-colors ${view === 'bubble' ? 'bg-surface-0 font-semibold text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'}`}
          >
            BCG bubble · log-scaled
          </button>
          <button
            type="button"
            onClick={() => setView('kku')}
            className={`rounded px-3 py-1 transition-colors ${view === 'kku' ? 'bg-surface-0 font-semibold text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'}`}
          >
            ERM 5×5 · institutional matrix
          </button>
        </div>
        <span className="text-xs text-text-tertiary">
          {view === 'bubble'
            ? `${bubbles.length} programs plotted · hover for detail · click to drill in`
            : 'Click a cell to filter the program list below'}
        </span>
      </div>

      {view === 'kku' ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-border-default bg-surface-0 p-4">
            <KkuRiskMatrix
              cells={kkuMatrixCells}
              selectedLikelihood={selectedCell?.likelihood ?? null}
              selectedImpact={selectedCell?.impact ?? null}
              onCellClick={(l, i) => {
                setSelectedCell((prev) => (prev?.likelihood === l && prev.impact === i ? null : { likelihood: l, impact: i }));
              }}
            />
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {/* Level summary */}
            <div className="rounded-lg border border-border-default bg-surface-0 p-4">
              <h4 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-secondary">
                ERM level summary
              </h4>
              <div className="space-y-2">
                {(['VERY_HIGH', 'HIGH', 'MODERATE', 'LOW', 'NEEDS_DATA'] as KkuRiskLevel[]).map((lvl) => {
                  const count = kkuLevelCounts[lvl];
                  const pct = rows.length > 0 ? (count / rows.length) * 100 : 0;
                  return (
                    <div key={lvl}>
                      <div className="mb-0.5 flex items-baseline justify-between text-xs">
                        <span className="flex items-center gap-1.5">
                          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: KKU_LEVEL_FILL[lvl] }} />
                          <span className="font-medium">{KKU_LEVEL_LABEL[lvl].en}</span>
                          <span className="text-text-tertiary" lang="th">/ {KKU_LEVEL_LABEL[lvl].th}</span>
                        </span>
                        <span className="tabular-nums">
                          <span className="font-semibold">{count}</span>
                          <span className="ml-1 text-text-tertiary">({pct.toFixed(0)}%)</span>
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: KKU_LEVEL_FILL[lvl] }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Selected cell detail */}
            <div className="rounded-lg border border-border-default bg-surface-0 p-4">
              <h4 className="mb-2 text-sm font-semibold uppercase tracking-wide text-text-secondary">
                {selectedCell
                  ? `Programs at L${selectedCell.likelihood} × I${selectedCell.impact} (${filteredRows.length})`
                  : 'Click a cell to inspect'}
              </h4>
              {selectedCell ? (
                filteredRows.length === 0 ? (
                  <p className="text-xs text-text-tertiary">No programs in this cell.</p>
                ) : (
                  <ul className="max-h-72 space-y-1 overflow-y-auto text-xs">
                    {filteredRows.map((r) => (
                      <li key={r.programId} className="rounded-md border border-border-subtle bg-surface-1 p-2">
                        <Link href={`/risks/${r.programId}`} className="block hover:text-accent-default">
                          <div className="font-medium" lang="th">
                            {r.programNameTh}
                          </div>
                          <div className="text-[10px] text-text-tertiary">
                            {r.programNameEn} · {r.facultyNameTh}
                          </div>
                          <div className="mt-0.5 text-[10px] text-text-tertiary">
                            Score {r.kkuMatrixScore} · {r.tier} · ฿
                            {(r.directRevenueAtRiskThb ?? 0) >= 1e6
                              ? `${((r.directRevenueAtRiskThb ?? 0) / 1e6).toFixed(1)}M`
                              : '—'}{' '}
                            at risk
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )
              ) : (
                <p className="text-xs text-text-tertiary">Click any cell on the heatmap above to see the programs landing in that L × I combination.</p>
              )}
            </div>
          </div>
        </div>
      ) : (
      <>
      <div className="rounded-lg border border-border-default bg-surface-0 p-4">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Risk likelihood × impact matrix">
          {/* Quadrant guides */}
          <line
            x1={M.left + PLOT_W * 0.5}
            y1={M.top}
            x2={M.left + PLOT_W * 0.5}
            y2={M.top + PLOT_H}
            stroke="currentColor"
            strokeOpacity={0.1}
            strokeDasharray="4 4"
          />
          <line
            x1={M.left}
            y1={M.top + PLOT_H * 0.5}
            x2={M.left + PLOT_W}
            y2={M.top + PLOT_H * 0.5}
            stroke="currentColor"
            strokeOpacity={0.1}
            strokeDasharray="4 4"
          />
          {/* Frame */}
          <rect
            x={M.left}
            y={M.top}
            width={PLOT_W}
            height={PLOT_H}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.18}
          />
          {/* Quadrant labels */}
          <text x={M.left + 8} y={M.top + 14} className="fill-current opacity-50" fontSize="10">
            High impact / Low likelihood
          </text>
          <text x={M.left + PLOT_W - 8} y={M.top + 14} textAnchor="end" className="fill-current opacity-50" fontSize="10">
            High impact / High likelihood — watch
          </text>
          <text x={M.left + 8} y={M.top + PLOT_H - 6} className="fill-current opacity-50" fontSize="10">
            Low impact / Low likelihood
          </text>
          <text
            x={M.left + PLOT_W - 8}
            y={M.top + PLOT_H - 6}
            textAnchor="end"
            className="fill-current opacity-50"
            fontSize="10"
          >
            Low impact / High likelihood
          </text>

          {/* X-axis ticks */}
          {[0, 25, 50, 75, 100].map((t) => {
            const x = M.left + (t / 100) * PLOT_W;
            return (
              <g key={t}>
                <line x1={x} y1={M.top + PLOT_H} x2={x} y2={M.top + PLOT_H + 4} stroke="currentColor" strokeOpacity={0.3} />
                <text x={x} y={M.top + PLOT_H + 16} textAnchor="middle" className="fill-current opacity-70" fontSize="10">
                  {t}
                </text>
              </g>
            );
          })}
          <text
            x={M.left + PLOT_W / 2}
            y={H - 8}
            textAnchor="middle"
            className="fill-current opacity-80"
            fontSize="11"
          >
            Composite likelihood (0 = healthy, 100 = severe)
          </text>

          {/* Y-axis ticks */}
          {[0, 25, 50, 75, 100].map((t) => {
            const y = M.top + (1 - t / 100) * PLOT_H;
            return (
              <g key={t}>
                <line x1={M.left - 4} y1={y} x2={M.left} y2={y} stroke="currentColor" strokeOpacity={0.3} />
                <text x={M.left - 8} y={y + 3} textAnchor="end" className="fill-current opacity-70" fontSize="10">
                  {t}
                </text>
              </g>
            );
          })}
          <text
            x={16}
            y={M.top + PLOT_H / 2}
            transform={`rotate(-90 16 ${M.top + PLOT_H / 2})`}
            textAnchor="middle"
            className="fill-current opacity-80"
            fontSize="11"
          >
            Impact (log-normalised, 0–100)
          </text>

          {/* Bubbles */}
          {bubbles.map((b) => (
            <g
              key={b.row.programId}
              onMouseEnter={() => setHovered(b.row.programId)}
              onMouseLeave={() => setHovered(null)}
              style={{ cursor: 'pointer' }}
            >
              <Link href={`/risks/${b.row.programId}`} legacyBehavior>
                <a aria-label={`${b.row.programNameTh} risk profile`}>
                  <circle
                    cx={b.cx}
                    cy={b.cy}
                    r={b.r}
                    fill={ERM_FILL[b.row.kkuRiskLevel]}
                    stroke={ERM_STROKE[b.row.kkuRiskLevel]}
                    strokeWidth={hovered === b.row.programId ? 2.5 : 1.2}
                  />
                </a>
              </Link>
              {hovered === b.row.programId && (
                <g pointerEvents="none">
                  <rect
                    x={b.cx + 12}
                    y={b.cy - 28}
                    width={260}
                    height={48}
                    fill="rgba(0,0,0,0.85)"
                    stroke="rgba(255,255,255,0.1)"
                    rx={4}
                  />
                  <text x={b.cx + 18} y={b.cy - 14} fontSize="11" fill="white">
                    {b.row.programNameTh}
                  </text>
                  <text x={b.cx + 18} y={b.cy + 0} fontSize="10" fill="rgba(255,255,255,0.7)">
                    {b.row.programCode} · {b.row.facultyNameTh}
                  </text>
                  <text x={b.cx + 18} y={b.cy + 14} fontSize="10" fill="rgba(255,255,255,0.7)">
                    L{b.row.likelihoodBin}·I{b.row.impactBin} = {b.row.kkuMatrixScore} ·{' '}
                    {b.row.kkuRiskLevel === 'VERY_HIGH'
                      ? 'Very high'
                      : b.row.kkuRiskLevel.charAt(0) + b.row.kkuRiskLevel.slice(1).toLowerCase()}
                  </text>
                </g>
              )}
            </g>
          ))}
        </svg>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-text-tertiary">ERM band:</span>
        {(['VERY_HIGH', 'HIGH', 'MODERATE', 'LOW'] as KkuRiskLevel[]).map((lvl) => {
          const range =
            lvl === 'VERY_HIGH'
              ? '16–25'
              : lvl === 'HIGH'
                ? '10–15'
                : lvl === 'MODERATE'
                  ? '5–9'
                  : '1–4';
          const labelEn =
            lvl === 'VERY_HIGH'
              ? 'Very high'
              : lvl.charAt(0) + lvl.slice(1).toLowerCase();
          return (
            <div
              key={lvl}
              className="flex items-center gap-2 rounded-md border px-3 py-1 text-xs"
              style={{ borderColor: ERM_STROKE[lvl] + '66', background: ERM_STROKE[lvl] + '12' }}
              title={KKU_LEVEL_LABEL[lvl].th}
            >
              <span
                className="inline-block h-3 w-3 rounded-full"
                style={{
                  background: ERM_FILL[lvl],
                  borderColor: ERM_STROKE[lvl],
                  borderWidth: 1,
                  borderStyle: 'solid',
                }}
              />
              <span>
                {labelEn} <span className="text-text-tertiary">· score {range}</span>
              </span>
              <span className="font-semibold tabular-nums">({ermCounts[lvl]})</span>
            </div>
          );
        })}
        <div className="ml-auto text-xs text-text-tertiary">
          {methodology} · bubble size = 5-year revenue at risk · colour = ERM band (L × I)
        </div>
      </div>
      </>
      )}
    </div>
  );
}
