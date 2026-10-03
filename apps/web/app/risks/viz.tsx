'use client';

import * as React from 'react';
import { useChartPalette } from '@kku/ui';
import type { RiskTier, RiskIndicatorSeverity } from './types';
import { TIER_FILL_HEX } from './types';

// ── Back-nav breadcrumb (used on every sub-page of /risks/) ──────────────

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export function RisksBackNav({
  current,
  hint,
}: {
  current: string;
  hint?: string;
}) {
  return (
    <nav className="mb-2 flex items-center gap-2 text-xs text-text-tertiary">
      <Link
        href="/risks"
        className="inline-flex items-center gap-1 rounded-md border border-border-subtle bg-surface-1 px-2 py-1 transition-colors hover:bg-surface-2 hover:text-text-primary"
      >
        <ArrowLeft className="size-icon-xs" /> Risk Management
      </Link>
      <span aria-hidden>·</span>
      <span className="text-text-secondary">{current}</span>
      {hint && (
        <>
          <span aria-hidden>·</span>
          <span className="opacity-80">{hint}</span>
        </>
      )}
    </nav>
  );
}

// ── Faculty heatmap — faculties × ERM level matrix ───────────────────────
//
// Switched from analytic tier (CRITICAL/HIGH/MODERATE/LOW/NEEDS_DATA) to
// ERM level (VERY_HIGH/HIGH/MODERATE/LOW/NEEDS_DATA) so the columns match
// the L × I institutional verdict the rest of the page uses (KPI tiles,
// 5×5 matrix, per-program badge).

export interface FacultyHeatmapRow {
  facultyId: string;
  facultyNameTh: string;
  facultyNameEn: string;
  total: number;
  counts: Record<KkuRiskLevel, number>;
}

export function FacultyHeatmap({
  rows,
  onCellClick,
}: {
  rows: FacultyHeatmapRow[];
  onCellClick?: (facultyId: string, ermLevel: KkuRiskLevel) => void;
}) {
  // NEEDS_DATA excluded from the heatmap — programs without enough data
  // to produce an ERM verdict don't belong on a comparative grid (the
  // dedicated NEEDS_DATA section in the tier-grouped table below covers
  // the data-acquisition worklist).
  const levels: KkuRiskLevel[] = ['VERY_HIGH', 'HIGH', 'MODERATE', 'LOW'];
  const maxRow = Math.max(1, ...rows.map((r) => r.total));

  const labelFor = (lvl: KkuRiskLevel): string => {
    if (lvl === 'NEEDS_DATA') return 'Needs data';
    if (lvl === 'VERY_HIGH') return 'Very high';
    return lvl.charAt(0) + lvl.slice(1).toLowerCase();
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs text-text-tertiary">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Faculty</th>
            {levels.map((lvl) => (
              <th
                key={lvl}
                className="px-2 py-2 text-center font-medium"
                style={{ color: KKU_LEVEL_FILL[lvl] }}
              >
                {labelFor(lvl)}
              </th>
            ))}
            <th className="px-3 py-2 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.facultyId} className="border-t border-border-subtle hover:bg-surface-1">
              <td className="px-3 py-1.5">
                <button
                  type="button"
                  onClick={() => onCellClick?.(row.facultyId, 'NEEDS_DATA')}
                  className="text-left transition-colors hover:text-accent-default"
                >
                  <div className="text-sm" lang="th">
                    {row.facultyNameTh}
                  </div>
                  <div className="text-[10px] text-text-tertiary">{row.facultyNameEn}</div>
                </button>
              </td>
              {levels.map((lvl) => {
                const count = row.counts[lvl] ?? 0;
                if (count === 0) {
                  return (
                    <td key={lvl} className="px-2 py-1.5 text-center text-text-tertiary">
                      —
                    </td>
                  );
                }
                const intensity = Math.min(1, count / Math.max(1, maxRow));
                const color = KKU_LEVEL_FILL[lvl];
                return (
                  <td key={lvl} className="px-1 py-1.5 text-center">
                    <button
                      type="button"
                      onClick={() => onCellClick?.(row.facultyId, lvl)}
                      className="mx-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-xs font-semibold tabular-nums transition-transform hover:scale-110 cursor-pointer"
                      style={{
                        background: tint(color, ((40 + intensity * 60) / 255) * 100),
                        color,
                        border: `1px solid ${tint(color, 40)}`,
                      }}
                      title={`${row.facultyNameEn}: ${count} ${labelFor(lvl)} program${count === 1 ? '' : 's'}\nClick to filter portfolio`}
                    >
                      {count}
                    </button>
                  </td>
                );
              })}
              <td className="px-3 py-1.5 text-right text-sm font-semibold tabular-nums">{row.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── ERM score histogram (1–25, L × I) ────────────────────────────────────
//
// Replaces the older composite-likelihood histogram on the portfolio page.
// Each bar = one integer ERM score (1, 2, ..., 25). Programs with the same
// L × I product stack at the same bar. Bars colour by KKU criteria band
// (1–4 green / 5–9 yellow / 10–15 orange / 16–25 red). NEEDS_DATA programs
// are excluded by the caller (no kkuMatrixScore = no bar).

function ermBandFromScore(score: number): KkuRiskLevel {
  if (score >= 16) return 'VERY_HIGH';
  if (score >= 10) return 'HIGH';
  if (score >= 5) return 'MODERATE';
  return 'LOW';
}

export function ErmScoreHistogram({ scores }: { scores: Array<number | null> }) {
  // 25 buckets, one per integer score 1..25. Skips score=0 / null entries.
  const buckets = Array.from({ length: 25 }, () => 0);
  for (const s of scores) {
    if (s == null || s < 1 || s > 25) continue;
    buckets[s - 1]! += 1;
  }
  const max = Math.max(1, ...buckets);
  // viewBox dimensions; SVG stretches to fit panel via preserveAspectRatio="none"
  const W = 1000;
  const H = 100;

  return (
    <div className="flex min-h-[180px] flex-1 flex-col gap-1">
      <div className="relative flex-1" style={{ minHeight: 140 }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
        >
          {/* Subtle gridlines at 25/50/75% of max */}
          {[0.25, 0.5, 0.75].map((g) => (
            <line
              key={g}
              x1={0}
              x2={W}
              y1={H * g}
              y2={H * g}
              stroke="currentColor"
              strokeOpacity={0.07}
              strokeDasharray="4 4"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {/* Baseline */}
          <line
            x1={0}
            x2={W}
            y1={H}
            y2={H}
            stroke="currentColor"
            strokeOpacity={0.2}
            vectorEffect="non-scaling-stroke"
          />
          {/* ERM-band division lines at scores 5, 10, 16 (start of next band) */}
          {[5, 10, 16].map((boundary) => {
            const x = ((boundary - 0.5) / 25) * W;
            return (
              <line
                key={boundary}
                x1={x}
                x2={x}
                y1={0}
                y2={H}
                stroke="currentColor"
                strokeOpacity={0.12}
                strokeDasharray="2 3"
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
          {buckets.map((count, i) => {
            const score = i + 1;
            const band = ermBandFromScore(score);
            const barGap = 2;
            const totalGap = barGap * (25 - 1);
            const barWidth = (W - totalGap) / 25;
            const x = i * (barWidth + barGap);
            const barH = (count / max) * H;
            const y = H - barH;
            const labelTh = band === 'VERY_HIGH'
              ? 'สูงมาก'
              : band === 'HIGH'
                ? 'สูง'
                : band === 'MODERATE'
                  ? 'ปานกลาง'
                  : 'ต่ำ';
            const labelEn = band === 'VERY_HIGH' ? 'Very high' : band.charAt(0) + band.slice(1).toLowerCase();
            return (
              <rect
                key={i}
                x={x}
                y={y}
                width={barWidth}
                height={barH || 0.4}
                fill={KKU_LEVEL_FILL[band]}
                opacity={count > 0 ? 0.9 : 0.12}
              >
                <title>{`Score ${score} · ${count} program${count === 1 ? '' : 's'} · ${labelEn} (${labelTh})`}</title>
              </rect>
            );
          })}
        </svg>
        {/* Per-bar count labels positioned on top of each bar */}
        {buckets.map((count, i) => {
          if (count === 0) return null;
          const barCenterPct = ((i + 0.5) / 25) * 100;
          const barHeightPct = (count / max) * 100;
          return (
            <div
              key={i}
              className="pointer-events-none absolute text-[10px] font-semibold tabular-nums text-text-secondary"
              style={{
                left: `${barCenterPct}%`,
                bottom: `${barHeightPct}%`,
                transform: 'translate(-50%, -2px)',
              }}
            >
              {count}
            </div>
          );
        })}
      </div>
      {/* X-axis labels at 1, 5, 10, 15, 20, 25 — bracketed by ERM band */}
      <div className="relative h-3 text-[10px] tabular-nums text-text-tertiary">
        {[1, 5, 10, 15, 20, 25].map((tick) => (
          <span
            key={tick}
            className="absolute -translate-x-1/2"
            style={{ left: `${((tick - 0.5) / 25) * 100}%` }}
          >
            {tick}
          </span>
        ))}
      </div>
      {/* Compact legend */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-text-tertiary">
        {(
          [
            { lvl: 'LOW' as const, range: '1–4' },
            { lvl: 'MODERATE' as const, range: '5–9' },
            { lvl: 'HIGH' as const, range: '10–15' },
            { lvl: 'VERY_HIGH' as const, range: '16–25' },
          ] satisfies Array<{ lvl: KkuRiskLevel; range: string }>
        ).map((entry) => (
          <span key={entry.lvl} className="flex items-center gap-1">
            <span
              className="inline-block h-2 w-2 rounded-sm"
              style={{ background: KKU_LEVEL_FILL[entry.lvl] }}
            />
            {entry.range}
          </span>
        ))}
        <span className="ml-auto">L × I score · NEEDS_DATA programs excluded</span>
      </div>
    </div>
  );
}

// ── Composite distribution histogram ──────────────────────────────────────

export function CompositeHistogram({
  values,
  bucketSize = 10,
}: {
  values: Array<number | null>;
  bucketSize?: number;
}) {
  const buckets = Array.from({ length: 100 / bucketSize }, () => 0);
  for (const v of values) {
    if (v == null) continue;
    const idx = Math.min(buckets.length - 1, Math.floor(v / bucketSize));
    buckets[idx]! += 1;
  }
  const max = Math.max(1, ...buckets);

  function bucketTier(midpoint: number): RiskTier {
    if (midpoint >= 80) return 'CRITICAL';
    if (midpoint >= 60) return 'HIGH';
    if (midpoint >= 35) return 'MODERATE';
    return 'LOW';
  }

  // SVG histogram — scales to fill its parent container exactly. CSS-flex
  // height resolution was unreliable through the wrapper chain (h-full and
  // flex-1 both depend on definite parent sizing which broke when the panel
  // grew taller than content via grid items-stretch). SVG with viewBox +
  // preserveAspectRatio="none" handles arbitrary container sizes natively.
  // Numeric labels live in a parallel HTML row above the SVG so they keep
  // proper font size when the SVG stretches.
  const W = 1000; // viewBox width
  const H = 100; // viewBox height (chart area only — labels external)

  return (
    <div className="flex min-h-[180px] flex-1 flex-col gap-1">
      {/* Chart area — SVG fills container; count labels are absolutely
          positioned HTML so each label sits right on top of its bar
          regardless of where the bar tops out. */}
      <div className="relative flex-1" style={{ minHeight: 140 }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
        >
          {[0.25, 0.5, 0.75].map((g) => (
            <line
              key={g}
              x1={0}
              x2={W}
              y1={H * g}
              y2={H * g}
              stroke="currentColor"
              strokeOpacity={0.07}
              strokeDasharray="4 4"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <line
            x1={0}
            x2={W}
            y1={H}
            y2={H}
            stroke="currentColor"
            strokeOpacity={0.2}
            vectorEffect="non-scaling-stroke"
          />
          {buckets.map((count, i) => {
            const mid = i * bucketSize + bucketSize / 2;
            const tier = bucketTier(mid);
            const lo = i * bucketSize;
            const hi = (i + 1) * bucketSize;
            const tierLabel =
              tier === 'CRITICAL' ? 'Critical' : tier === 'HIGH' ? 'High' : tier === 'MODERATE' ? 'Moderate' : 'Low';
            const barGap = 2;
            const totalGap = barGap * (buckets.length - 1);
            const barWidth = (W - totalGap) / buckets.length;
            const x = i * (barWidth + barGap);
            const barH = (count / max) * H;
            const y = H - barH;
            return (
              <rect
                key={i}
                x={x}
                y={y}
                width={barWidth}
                height={barH || 0.4}
                fill={TIER_FILL_HEX[tier]}
                opacity={count > 0 ? 0.88 : 0.15}
              >
                <title>{`Composite ${lo}–${hi}: ${count} program${count === 1 ? '' : 's'} · ${tierLabel} tier`}</title>
              </rect>
            );
          })}
        </svg>
        {/* Count labels — one per bucket, positioned to sit directly on top
            of each bar. left = bar centre as % of width; bottom = bar height
            as % of chart area; transform lifts the label above the bar. */}
        {buckets.map((count, i) => {
          if (count === 0) return null;
          const barCenterPct = ((i + 0.5) / buckets.length) * 100;
          const barHeightPct = (count / max) * 100;
          return (
            <div
              key={i}
              className="pointer-events-none absolute text-[10px] font-semibold tabular-nums text-text-secondary"
              style={{
                left: `${barCenterPct}%`,
                bottom: `${barHeightPct}%`,
                transform: 'translate(-50%, -2px)',
              }}
            >
              {count}
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] text-text-tertiary">
        <span>0</span>
        <span>25</span>
        <span>50</span>
        <span>75</span>
        <span>100</span>
      </div>
      <div className="text-[10px] text-text-tertiary">
        Composite likelihood score (0 = healthy, 100 = severe) · hover bars for counts
      </div>
    </div>
  );
}

// ── Driver dominance donut ─────────────────────────────────────────────────

export interface DriverMixSlice {
  label: string;
  count: number;
  color: string;
}

export function DriverMixDonut({ slices, title, footnote }: { slices: DriverMixSlice[]; title: string; footnote?: string }) {
  const total = slices.reduce((acc, s) => acc + s.count, 0);
  if (total === 0) {
    return <div className="text-xs text-text-tertiary">No data.</div>;
  }

  // Vertical layout — fits a narrow column. Donut on top, percentage bars
  // below. Donut renders in a square SVG that scales to its parent.
  const cx = 80;
  const cy = 80;
  const r = 64;
  const inner = 38;
  let cumAngle = -Math.PI / 2;
  const arcs = slices
    .filter((s) => s.count > 0)
    .map((s) => {
      const angle = (s.count / total) * Math.PI * 2;
      const startAngle = cumAngle;
      const endAngle = cumAngle + angle;
      cumAngle = endAngle;
      const x1 = cx + r * Math.cos(startAngle);
      const y1 = cy + r * Math.sin(startAngle);
      const x2 = cx + r * Math.cos(endAngle);
      const y2 = cy + r * Math.sin(endAngle);
      const ix1 = cx + inner * Math.cos(startAngle);
      const iy1 = cy + inner * Math.sin(startAngle);
      const ix2 = cx + inner * Math.cos(endAngle);
      const iy2 = cy + inner * Math.sin(endAngle);
      const large = angle > Math.PI ? 1 : 0;
      const d = `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${ix2} ${iy2} A ${inner} ${inner} 0 ${large} 0 ${ix1} ${iy1} Z`;
      return { d, slice: s };
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* Donut — centred, scales with available space */}
      <div className="flex items-center justify-center">
        <svg
          viewBox="0 0 160 160"
          className="h-auto w-full"
          style={{ maxWidth: 180, maxHeight: 180 }}
          role="img"
          aria-label={title}
        >
          {arcs.map((a, i) => (
            <path key={i} d={a.d} fill={a.slice.color} stroke="var(--color-surface-0)" strokeWidth={2}>
              <title>{`${a.slice.label}: ${a.slice.count} (${((a.slice.count / total) * 100).toFixed(0)}%)`}</title>
            </path>
          ))}
          <text x={cx} y={cy - 2} textAnchor="middle" className="fill-current" fontSize="24" fontWeight="600">
            {total}
          </text>
          <text x={cx} y={cy + 16} textAnchor="middle" className="fill-current opacity-60" fontSize="10">
            programs
          </text>
        </svg>
      </div>

      {/* Legend rows with percentage bars — fills horizontal width */}
      <div className="space-y-2">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">{title}</div>
        {slices.map((s) => {
          const pct = total > 0 ? (s.count / total) * 100 : 0;
          return (
            <div key={s.label} className="space-y-1">
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
                  <span className="text-text-secondary">{s.label}</span>
                </span>
                <span className="tabular-nums">
                  <span className="font-semibold">{s.count}</span>
                  <span className="ml-1 text-text-tertiary">({pct.toFixed(0)}%)</span>
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${pct}%`, background: s.color, opacity: pct > 0 ? 0.85 : 0.15 }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {footnote && <div className="mt-auto text-[10px] text-text-tertiary">{footnote}</div>}
    </div>
  );
}

// ── Top concentration horizontal bars ─────────────────────────────────────

export interface ConcentrationBar {
  programId: string;
  label: string;
  sublabel?: string;
  value: number;
  // Optional secondary annotation rendered under the bar — used by the
  // "Top revenue at risk" panel to surface an expected-loss view alongside
  // the gross exposure (likelihood-weighted = Impact × Likelihood).
  secondaryLabel?: string;
  // Bar fill uses the KKU ERM L×I band (matches KPI tiles, faculty heatmap,
  // score histogram, matrix). Previously used composite tier colour, which
  // is likelihood-only — Pharmacy + Medicine showed up GREEN here while the
  // rest of the page showed them ORANGE (HIGH ERM, low likelihood × high
  // impact). Mismatched colour on every surface confused readers.
  kkuRiskLevel: KkuRiskLevel;
}

export function ConcentrationBars({
  rows,
  formatValue,
}: {
  rows: ConcentrationBar[];
  formatValue: (n: number) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <a
          key={r.programId}
          href={`/risks/${r.programId}`}
          className="block rounded-md px-2 py-1.5 hover:bg-surface-1"
        >
          <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
            <span className="truncate" lang="th">
              {r.label}
            </span>
            <span className="tabular-nums text-text-secondary">{formatValue(r.value)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full"
              style={{ width: `${(r.value / max) * 100}%`, background: KKU_LEVEL_FILL[r.kkuRiskLevel] }}
            />
          </div>
          {r.sublabel && <div className="mt-0.5 text-[10px] text-text-tertiary">{r.sublabel}</div>}
          {r.secondaryLabel && (
            <div className="mt-0.5 text-[10px] tabular-nums text-text-tertiary/80">
              {r.secondaryLabel}
            </div>
          )}
        </a>
      ))}
    </div>
  );
}

// ── Driver radar (L1 / L2 / L3 triangle, with optional university overlay) ──

export function DriverRadar({
  l1,
  l2,
  l3,
  universityAverages,
}: {
  l1: number | null;
  l2: number | null;
  l3: number | null;
  universityAverages?: { l1: number | null; l2: number | null; l3: number | null; programCount: number } | null;
}) {
  const palette = useChartPalette();
  // This program's own polygon is series-identity, not a judgement — the
  // indigo chart token keeps it visually distinct from the danger/warning
  // encodings used elsewhere on the page.
  const programColor = palette.series[6]!;
  const cx = 130;
  const cy = 120;
  const radius = 92;
  const axes = [
    { label: 'L1 Recruitment', sub: 'TCAS / fill rate', score: l1, uni: universityAverages?.l1 ?? null, angle: -Math.PI / 2 },
    {
      label: 'L2 AI risk',
      sub: 'Skill automation',
      score: l2,
      uni: universityAverages?.l2 ?? null,
      angle: -Math.PI / 2 + (Math.PI * 2) / 3,
    },
    {
      label: 'L3 Demographic',
      sub: 'Cohort × percentile',
      score: l3,
      uni: universityAverages?.l3 ?? null,
      angle: -Math.PI / 2 + (Math.PI * 4) / 3,
    },
  ];
  const points = axes.map((a) => {
    const r = ((a.score ?? 0) / 100) * radius;
    return { x: cx + r * Math.cos(a.angle), y: cy + r * Math.sin(a.angle), score: a.score };
  });
  const polygon = points.map((p) => `${p.x},${p.y}`).join(' ');

  const uniPoints = axes.map((a) => {
    const r = ((a.uni ?? 0) / 100) * radius;
    return { x: cx + r * Math.cos(a.angle), y: cy + r * Math.sin(a.angle), score: a.uni };
  });
  const uniPolygon = uniPoints.map((p) => `${p.x},${p.y}`).join(' ');
  const hasUniOverlay = universityAverages?.l1 != null || universityAverages?.l2 != null || universityAverages?.l3 != null;

  function rings(steps: number[]) {
    return steps.map((step) => {
      const r = (step / 100) * radius;
      const pts = axes
        .map((a) => `${cx + r * Math.cos(a.angle)},${cy + r * Math.sin(a.angle)}`)
        .join(' ');
      return <polygon key={step} points={pts} fill="none" stroke="currentColor" strokeOpacity={0.1} />;
    });
  }

  return (
    <div className="flex items-center gap-4">
      <svg width={260} height={240} viewBox="0 0 260 240">
        {rings([25, 50, 75, 100])}
        {axes.map((a) => {
          const x = cx + radius * Math.cos(a.angle);
          const y = cy + radius * Math.sin(a.angle);
          return <line key={a.label} x1={cx} y1={cy} x2={x} y2={y} stroke="currentColor" strokeOpacity={0.18} />;
        })}
        {/* University average polygon — drawn first so program polygon sits on top */}
        {hasUniOverlay && (
          <g>
            <polygon
              points={uniPolygon}
              fill={palette.neutral}
              fillOpacity={0.12}
              stroke={palette.neutral}
              strokeWidth={1.2}
              strokeDasharray="3 3"
            />
            {uniPoints.map(
              (p, i) => p.score != null && <circle key={i} cx={p.x} cy={p.y} r={2} fill={palette.neutral} />,
            )}
          </g>
        )}
        {/* Program polygon */}
        <polygon points={polygon} fill={programColor} fillOpacity={0.28} stroke={programColor} strokeWidth={1.8} />
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={3.5} fill={programColor} />
        ))}
        {axes.map((a, i) => {
          // Compact "L1/L2/L3" markers at each axis tip. Full labels +
          // sub-text live in the right-side KPI cards already (avoiding
          // double-labelling), and the original "L1 Recruitment / TCAS /
          // fill rate" text overflowed the 260-wide viewBox on L2 and
          // bled into the right-hand KPI column. The cos-sign anchor
          // also avoided the L3 label rendering INTO the radar polygon
          // (the old `angle > 0` test sent both L2 and L3 to 'start').
          const labelR = radius + 14;
          const x = cx + labelR * Math.cos(a.angle);
          const y = cy + labelR * Math.sin(a.angle);
          return (
            <text
              key={a.label}
              x={x}
              y={y + 4}
              textAnchor="middle"
              className="fill-current opacity-70"
              fontSize="10"
              fontWeight="600"
            >
              L{i + 1}
            </text>
          );
        })}
      </svg>
      <div className="flex flex-col gap-2 text-xs">
        {axes.map((a, i) => (
          <div key={a.label} className="rounded-md border border-border-subtle bg-surface-1 px-3 py-1.5">
            <div className="text-[10px] uppercase text-text-tertiary">{a.label}</div>
            <div className="flex items-baseline gap-2">
              <span className="text-lg font-semibold tabular-nums" style={{ color: programColor }}>
                {points[i]!.score?.toFixed(0) ?? '–'}
              </span>
              {hasUniOverlay && (
                <span className="text-[10px] text-text-tertiary">
                  univ avg{' '}
                  <span className="tabular-nums" style={{ color: palette.neutral }}>
                    {a.uni?.toFixed(0) ?? '–'}
                  </span>
                </span>
              )}
            </div>
          </div>
        ))}
        {hasUniOverlay && universityAverages?.programCount && (
          <div className="text-[10px] text-text-tertiary">
            <span className="inline-block h-0.5 w-3 align-middle" style={{ background: palette.neutral }} />{' '}
            University average across {universityAverages.programCount} undergraduate programs
          </div>
        )}
      </div>
    </div>
  );
}

// ── KRI status tile ────────────────────────────────────────────────────────

const SEVERITY_TONE: Record<'OK' | 'WARN' | 'CRITICAL', { bg: string; fg: string; ring: string }> = {
  OK: { bg: 'bg-emerald-500/10', fg: 'text-emerald-700 dark:text-emerald-300', ring: 'ring-emerald-500/30' },
  WARN: { bg: 'bg-amber-500/15', fg: 'text-amber-700 dark:text-amber-300', ring: 'ring-amber-500/40' },
  CRITICAL: { bg: 'bg-rose-500/15', fg: 'text-rose-700 dark:text-rose-300', ring: 'ring-rose-500/40' },
};

export function KriTile({
  labelEn,
  labelTh,
  severity,
  value,
  warnThreshold,
  criticalThreshold,
  alarmDirection,
}: {
  labelEn: string;
  labelTh: string;
  severity: RiskIndicatorSeverity | null;
  value: number | null;
  warnThreshold: number;
  criticalThreshold: number;
  alarmDirection: string;
}) {
  if (severity == null) {
    return (
      <div className="rounded-lg border border-dashed border-border-default bg-surface-1 p-3">
        <div className="text-xs font-semibold text-text-secondary">{labelEn}</div>
        <div className="mt-1 text-[10px] text-text-tertiary" lang="th">
          {labelTh}
        </div>
        <div className="mt-3 text-sm text-text-tertiary">No data</div>
      </div>
    );
  }
  const tone = SEVERITY_TONE[severity];
  const alarmIsLow = alarmDirection === 'low';
  // Gauge: render value position relative to thresholds. 0..max scaled; max
  // = 2× the warn threshold for low-direction, 2× critical for high-direction.
  const max = alarmIsLow
    ? Math.max(warnThreshold * 2, value ?? 0)
    : Math.max(criticalThreshold * 1.5, value ?? 0);
  const valuePct = value != null ? Math.min(100, (value / max) * 100) : 0;
  const warnPct = Math.min(100, (warnThreshold / max) * 100);
  const critPct = Math.min(100, (criticalThreshold / max) * 100);
  return (
    <div className={`rounded-lg border ring-1 ${tone.bg} ${tone.ring} border-transparent p-3`}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-xs font-semibold text-text-primary">{labelEn}</div>
          <div className="text-[10px] text-text-tertiary" lang="th">
            {labelTh}
          </div>
        </div>
        <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase ${tone.fg}`}>
          {severity}
        </span>
      </div>
      <div className="mt-3 flex items-baseline gap-1">
        <span className={`text-2xl font-semibold tabular-nums ${tone.fg}`}>
          {value != null ? (Math.abs(value) < 1 ? value.toFixed(2) : value.toFixed(1)) : '—'}
        </span>
        <span className="text-[10px] text-text-tertiary">
          {alarmIsLow ? `warn ≤ ${warnThreshold}` : `warn ≥ ${warnThreshold}`}
        </span>
      </div>
      <div className="relative mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div
          className="absolute inset-y-0 left-0"
          style={{ width: `${valuePct}%`, background: 'currentColor', opacity: 0.6 }}
        />
        <div className="absolute inset-y-0 w-px bg-amber-500" style={{ left: `${warnPct}%` }} />
        <div className="absolute inset-y-0 w-px bg-rose-500" style={{ left: `${critPct}%` }} />
      </div>
    </div>
  );
}

// ── Skill automation horizontal stacked bar ───────────────────────────────

export function SkillAutomationBar({
  shares,
}: {
  shares: { LOW: number; MEDIUM: number; HIGH: number; UNKNOWN: number };
}) {
  const palette = useChartPalette();
  const segs = [
    { label: 'LOW automation risk', share: shares.LOW, color: palette.positive },
    { label: 'MEDIUM', share: shares.MEDIUM, color: palette.warning },
    { label: 'HIGH', share: shares.HIGH, color: palette.negative },
    { label: 'UNKNOWN', share: shares.UNKNOWN, color: palette.neutral },
  ];
  return (
    <div className="space-y-2">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-2">
        {segs.map((s) =>
          s.share > 0 ? (
            <div
              key={s.label}
              style={{ width: `${s.share * 100}%`, background: s.color }}
              title={`${s.label}: ${(s.share * 100).toFixed(0)}%`}
            />
          ) : null,
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
        {segs.map((s) => (
          <div key={s.label} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
            <span className="text-text-secondary">{s.label}</span>
            <span className="tabular-nums text-text-tertiary">{(s.share * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── TCAS funnel sparkline (multi-series mini chart) ───────────────────────

export function TcasSparkline({
  years,
}: {
  years: Array<{
    year: number;
    plan: number | null;
    applicants: number | null;
    reported: number | null;
    inProgress?: boolean;
  }>;
}) {
  // Hook must run before the empty-data early return below.
  const palette = useChartPalette();
  if (years.length === 0) {
    return <div className="text-xs text-text-tertiary">No TCAS funnel data.</div>;
  }
  const W = 320;
  const H = 120;
  const pad = { l: 30, r: 10, t: 10, b: 22 };
  const allValues = years.flatMap((y) => [y.plan ?? 0, y.applicants ?? 0, y.reported ?? 0]);
  const max = Math.max(1, ...allValues);
  const x = (i: number) => pad.l + (i / Math.max(1, years.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number | null) => pad.t + (v == null ? 0 : (1 - v / max) * (H - pad.t - pad.b));

  // Separate "complete" segment from "in-progress" segment so the line
  // dashes from the last complete year into the in-progress year, signalling
  // that the partial counts shouldn't be read as a trend.
  const lastCompleteIdx = (() => {
    for (let i = years.length - 1; i >= 0; i -= 1) {
      if (!years[i]!.inProgress) return i;
    }
    return -1;
  })();

  function pathForRange(field: 'plan' | 'applicants' | 'reported', from: number, to: number): string {
    const pts: Array<{ i: number; v: number }> = [];
    for (let i = from; i <= to; i += 1) {
      const v = years[i]?.[field];
      if (v != null) pts.push({ i, v });
    }
    if (pts.length === 0) return '';
    return pts.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${x(p.i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ');
  }

  const series = [
    { field: 'plan' as const, label: 'Plan', color: palette.neutral, dash: '3 3' },
    { field: 'applicants' as const, label: 'Applicants', color: palette.series[6]! },
    { field: 'reported' as const, label: 'Reported', color: palette.positive },
  ];

  const inProgressYears = years.filter((y) => y.inProgress);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {/* In-progress band — soft tint behind the partial year */}
        {inProgressYears.length > 0 && lastCompleteIdx >= 0 && lastCompleteIdx < years.length - 1 && (
          <rect
            x={x(lastCompleteIdx) + 1}
            y={pad.t}
            width={W - pad.r - x(lastCompleteIdx) - 1}
            height={H - pad.t - pad.b}
            fill={palette.warning}
            fillOpacity={0.08}
          />
        )}
        {/* Y gridlines */}
        {[0, 0.5, 1].map((g) => (
          <g key={g}>
            <line
              x1={pad.l}
              y1={pad.t + g * (H - pad.t - pad.b)}
              x2={W - pad.r}
              y2={pad.t + g * (H - pad.t - pad.b)}
              stroke="currentColor"
              strokeOpacity={0.08}
            />
            <text x={pad.l - 5} y={pad.t + g * (H - pad.t - pad.b) + 3} textAnchor="end" className="fill-current opacity-50" fontSize="9">
              {Math.round(max * (1 - g))}
            </text>
          </g>
        ))}
        {/* Series — solid through last complete year, then dashed across the in-progress portion */}
        {series.map((s) => {
          const completePath =
            lastCompleteIdx >= 0 ? pathForRange(s.field, 0, lastCompleteIdx) : '';
          const inProgressPath =
            lastCompleteIdx >= 0 && lastCompleteIdx < years.length - 1
              ? pathForRange(s.field, lastCompleteIdx, years.length - 1)
              : '';
          return (
            <g key={s.label}>
              {completePath && (
                <path
                  d={completePath}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={1.5}
                  strokeDasharray={s.dash}
                />
              )}
              {inProgressPath && (
                <path
                  d={inProgressPath}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={1.5}
                  strokeDasharray="2 3"
                  opacity={0.55}
                />
              )}
            </g>
          );
        })}
        {/* X labels */}
        {years.map((yr, i) => (
          <text
            key={yr.year}
            x={x(i)}
            y={H - 6}
            textAnchor="middle"
            className="fill-current"
            fontSize="9"
            opacity={yr.inProgress ? 0.5 : 0.7}
            fontStyle={yr.inProgress ? 'italic' : 'normal'}
          >
            BE {yr.year}
            {yr.inProgress ? '*' : ''}
          </text>
        ))}
      </svg>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
        {series.map((s) => (
          <div key={s.label} className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-4" style={{ background: s.color }} />
            <span className="text-text-secondary">{s.label}</span>
          </div>
        ))}
        {inProgressYears.length > 0 && (
          <div className="ml-auto text-text-tertiary">
            * BE {inProgressYears.map((y) => y.year).join(', ')} in progress — partial counts, excluded from scoring
          </div>
        )}
      </div>
    </div>
  );
}

// ── KKU 5×5 institutional risk heatmap ────────────────────────────────────
// Standard ERM matrix: likelihood (rows, 5 = almost certain at top) × impact
// (cols, 5 = catastrophic at right). Cell colour follows KKU's policy:
//   matrix score 1-4   → green   (LOW)
//   matrix score 5-9   → yellow  (MODERATE)
//   matrix score 10-15 → orange  (HIGH)
//   matrix score 16-25 → red     (VERY_HIGH)

import type { KkuRiskLevel } from './types';
import { KKU_LEVEL_FILL, kkuLevelFromMatrixScore, tint } from './types';

const LIKELIHOOD_LABELS = ['Rare', 'Unlikely', 'Possible', 'Likely', 'Almost certain'];
const IMPACT_LABELS = ['Insignificant', 'Minor', 'Moderate', 'Major', 'Catastrophic'];

export function KkuRiskMatrix({
  cells,
  selectedLikelihood,
  selectedImpact,
  onCellClick,
  compact = false,
}: {
  /** cells[likelihood-1][impact-1] = program count. */
  cells: number[][];
  selectedLikelihood?: number | null;
  selectedImpact?: number | null;
  onCellClick?: (likelihood: number, impact: number) => void;
  /** Compact = drop axis sub-labels and shrink cell size. */
  compact?: boolean;
}) {
  const max = Math.max(1, ...cells.flat());
  const cellSize = compact ? 'min-h-[44px]' : 'min-h-[60px]';
  const labelGutter = compact ? 64 : 120;
  return (
    <div className="space-y-3">
      <div
        className="grid"
        style={{ gridTemplateColumns: `${labelGutter}px repeat(5, 1fr) 8px`, gap: '4px' }}
      >
        <div />
        {IMPACT_LABELS.map((label, i) => (
          <div key={i} className="text-center text-[10px] text-text-tertiary">
            <div className="font-semibold">I={i + 1}</div>
            {!compact && <div className="opacity-70">{label}</div>}
          </div>
        ))}
        <div />

        {[5, 4, 3, 2, 1].map((l) => (
          <React.Fragment key={l}>
            <div className="flex flex-col items-end justify-center pr-1 text-right text-[10px] text-text-tertiary">
              <div className="font-semibold">L={l}</div>
              {!compact && <div className="opacity-70">{LIKELIHOOD_LABELS[l - 1]}</div>}
            </div>
            {[1, 2, 3, 4, 5].map((i) => {
              const score = l * i;
              const level = kkuLevelFromMatrixScore(score);
              const count = cells[l - 1]?.[i - 1] ?? 0;
              const fill = KKU_LEVEL_FILL[level];
              const intensity = count > 0 ? Math.min(1, 0.55 + (count / max) * 0.45) : 0.18;
              const isSelected = selectedLikelihood === l && selectedImpact === i;
              const clickable = !!onCellClick && count > 0;
              return (
                <button
                  key={i}
                  type="button"
                  disabled={!clickable}
                  onClick={() => clickable && onCellClick(l, i)}
                  className={`relative flex aspect-square ${cellSize} items-center justify-center rounded-md border text-center transition-all ${
                    isSelected
                      ? 'ring-2 ring-offset-2 ring-offset-surface-0'
                      : clickable
                        ? 'cursor-pointer hover:scale-[1.04] hover:shadow-md'
                        : 'cursor-default'
                  }`}
                  style={{ background: fill, opacity: intensity, borderColor: fill }}
                  title={`L=${l} (${LIKELIHOOD_LABELS[l - 1]}) × I=${i} (${IMPACT_LABELS[i - 1]}) = score ${score} · ${count} program${count === 1 ? '' : 's'} · ${level === 'LOW' ? 'Low' : level === 'MODERATE' ? 'Moderate' : level === 'HIGH' ? 'High' : 'Very high'}${clickable ? '\nClick to filter portfolio to these programs' : ''}`}
                >
                  <span
                    className={`font-bold tabular-nums leading-none text-white drop-shadow-sm ${
                      compact ? 'text-2xl' : 'text-3xl'
                    }`}
                  >
                    {count > 0 ? count : ''}
                  </span>
                </button>
              );
            })}
            <div className="pointer-events-none" />
          </React.Fragment>
        ))}
      </div>

      {!compact && (
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="text-text-tertiary">ERM criteria</span>
          {(
            [
              { lvl: 'LOW' as const, range: '1–4', en: 'Low', th: 'ต่ำ' },
              { lvl: 'MODERATE' as const, range: '5–9', en: 'Moderate', th: 'ปานกลาง' },
              { lvl: 'HIGH' as const, range: '10–15', en: 'High', th: 'สูง' },
              { lvl: 'VERY_HIGH' as const, range: '16–25', en: 'Very high', th: 'สูงมาก' },
            ] satisfies Array<{ lvl: KkuRiskLevel; range: string; en: string; th: string }>
          ).map((entry) => (
            <div key={entry.lvl} className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm" style={{ background: KKU_LEVEL_FILL[entry.lvl] }} />
              <span className="text-text-secondary">
                {entry.en} <span className="text-text-tertiary">/ {entry.th}</span> · {entry.range}
              </span>
            </div>
          ))}
          <span className="ml-auto text-text-tertiary">Score = L × I (1–25)</span>
        </div>
      )}
    </div>
  );
}

// ── Compact per-program KKU score badge ──────────────────────────────────

export function KkuScoreBadge({
  matrixScore,
  level,
  likelihoodBin,
  impactBin,
  size = 'md',
}: {
  matrixScore: number | null;
  level: KkuRiskLevel;
  likelihoodBin: number | null;
  impactBin: number | null;
  size?: 'sm' | 'md' | 'lg';
}) {
  const fill = KKU_LEVEL_FILL[level];
  const labels: Record<KkuRiskLevel, string> = {
    NEEDS_DATA: 'Needs data',
    LOW: 'Low',
    MODERATE: 'Moderate',
    HIGH: 'High',
    VERY_HIGH: 'Very high',
  };
  const labelTh: Record<KkuRiskLevel, string> = {
    NEEDS_DATA: 'ข้อมูลไม่พอ',
    LOW: 'ต่ำ',
    MODERATE: 'ปานกลาง',
    HIGH: 'สูง',
    VERY_HIGH: 'สูงมาก',
  };
  const sizeClasses =
    size === 'lg'
      ? { wrap: 'p-3', score: 'text-3xl', label: 'text-xs' }
      : size === 'sm'
        ? { wrap: 'p-1.5', score: 'text-base', label: 'text-[9px]' }
        : { wrap: 'p-2', score: 'text-xl', label: 'text-[10px]' };
  return (
    <div
      className={`flex items-center gap-2 rounded-md border ${sizeClasses.wrap}`}
      style={{ background: tint(fill, 12.5), borderColor: tint(fill, 40) }}
    >
      <div className="flex items-baseline gap-1">
        <span className={`font-bold tabular-nums ${sizeClasses.score}`} style={{ color: fill }}>
          {matrixScore ?? '—'}
        </span>
        <span className="text-[10px] text-text-tertiary">/ 25</span>
      </div>
      <div className={sizeClasses.label}>
        <div className="font-semibold uppercase tracking-wide" style={{ color: fill }}>
          {labels[level]}
        </div>
        <div className="text-text-tertiary" lang="th">
          {labelTh[level]}
          {likelihoodBin != null && impactBin != null && (
            <span className="ml-1 opacity-80">
              · L{likelihoodBin} × I{impactBin}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── L2 component breakdown (skill / readiness / disruption) ──────────────

// Colour is resolved from the live theme inside the component (see
// `componentColor` below) — the meta table itself carries only static text.
const L2_COMPONENT_META: Record<
  'skillPressure' | 'readinessDeficit' | 'disruptionSignal',
  { label: string; sub: string }
> = {
  skillPressure: {
    label: 'Skill pressure',
    sub: 'Weighted share of HIGH/MEDIUM automation-risk skills',
  },
  readinessDeficit: {
    label: 'Readiness deficit',
    sub: '100 − discipline-aware AI readiness score',
  },
  disruptionSignal: {
    label: 'Disruption signal',
    sub: 'Severity-weighted gaps + priority-weighted recommendations',
  },
};

export function L2ComponentBreakdown({
  overallScore,
  composition,
}: {
  overallScore: number | null;
  composition: Array<{
    key: 'skillPressure' | 'readinessDeficit' | 'disruptionSignal';
    value: number;
    weight: number;
  }>;
}) {
  const palette = useChartPalette();
  // The three L2 sub-scores are components of one composite, not a
  // good/bad scale — they take distinct series colours so the stacked
  // contribution reads as a breakdown rather than a severity ranking.
  const componentColor: Record<typeof composition[number]['key'], string> = {
    skillPressure: palette.series[10]!,
    readinessDeficit: palette.series[7]!,
    disruptionSignal: palette.series[9]!,
  };
  if (composition.length === 0) {
    return (
      <div className="text-xs text-text-tertiary">
        No L2 signal yet — needs either skill automation tags or a discipline-aware AI readiness assessment.
      </div>
    );
  }
  const totalWeight = composition.reduce((acc, c) => acc + c.weight, 0);
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">
          L2 = Σ weight × value
        </span>
        <div className="text-right">
          <span className="text-2xl font-semibold tabular-nums">
            {overallScore != null ? overallScore.toFixed(0) : '–'}
          </span>
          <span className="ml-1 text-xs text-text-tertiary">/ 100</span>
        </div>
      </div>
      <div className="space-y-2">
        {composition.map((c) => {
          const meta = L2_COMPONENT_META[c.key];
          const contribution = (c.value * c.weight) / Math.max(0.01, totalWeight);
          return (
            <div key={c.key}>
              <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
                <div>
                  <span className="font-semibold">{meta.label}</span>
                  <span className="ml-1 text-text-tertiary">· weight {(c.weight * 100).toFixed(0)}%</span>
                </div>
                <span className="tabular-nums text-text-secondary">
                  {c.value.toFixed(0)}
                  <span className="ml-1 text-text-tertiary">
                    → {contribution.toFixed(1)}
                  </span>
                </span>
              </div>
              <div className="relative h-2 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.min(100, c.value)}%`, background: componentColor[c.key], opacity: 0.85 }}
                />
              </div>
              <div className="mt-0.5 text-[10px] text-text-tertiary">{meta.sub}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Impact breakdown horizontal bars ──────────────────────────────────────

function fmtThbCompact(n: number | null): string {
  if (n == null) return '–';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)} M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)} K`;
  return Math.round(n).toLocaleString();
}

export function ImpactBars({
  directThb,
}: {
  directThb: number | null;
}) {
  const direct = directThb ?? 0;
  if (direct === 0) return <div className="text-xs text-text-tertiary">No impact data.</div>;

  // v1.10: only the direct revenue exposure is plotted now. Stranded
  // structural cost was dropped because KKU's finance system doesn't
  // track per-program expenses — the cost columns it does carry are
  // placeholder seed data, not real allocations.
  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1 flex items-baseline justify-between text-xs">
          <span className="text-text-secondary">Direct revenue at risk (5y)</span>
          <span className="font-semibold tabular-nums">฿ {fmtThbCompact(directThb)}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-rose-500/70" style={{ width: '100%' }} />
        </div>
        <div className="mt-1 text-[10px] text-text-tertiary">
          Tuition revenue × 5 years if program closes. Stranded cost excluded — no per-program
          expense data in source systems.
        </div>
      </div>
    </div>
  );
}
