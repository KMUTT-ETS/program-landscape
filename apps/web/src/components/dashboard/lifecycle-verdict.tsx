'use client';

import * as React from 'react';
import { useChartPalette } from '@kku/ui';

interface VerdictCounts {
  FRONTIER: number;
  RISING: number;
  STABLE: number;
  SUNSET: number;
}

interface Props {
  /** Total programs covered by a snapshot. */
  total: number;
  /** Total canonical programs the snapshot is being compared against. */
  expectedTotal: number;
  counts: VerdictCounts;
  methodologyVersions: string[];
  latestComputedAt: string | null;
}

// Lifecycle verdict distribution — horizontal stacked bar with one
// segment per verdict, plus a 4-up tile row showing counts + meaning.
// Verdicts are ordered FRONTIER (best) → SUNSET (worst); rendered
// left-to-right so the eye reads health left-to-right.
//
// When no snapshots exist (backfill not run yet) we render an empty
// state with a copy-pasteable command instead of fabricating zeros.

const VERDICTS: Array<keyof VerdictCounts> = ['FRONTIER', 'RISING', 'STABLE', 'SUNSET'];

const COPY: Record<keyof VerdictCounts, { label: string; description: string }> = {
  FRONTIER: {
    label: 'Frontier',
    description: 'Leading-edge curriculum + strong fundamentals + AI-ready. Future-defining.',
  },
  RISING: {
    label: 'Rising',
    description: 'Improving across multiple signals. Funding + visibility unlock the next tier.',
  },
  STABLE: {
    label: 'Stable',
    description: 'Holding steady. Enrolment + finances maintained, no immediate threat.',
  },
  SUNSET: {
    label: 'Sunset',
    description: 'Declining trajectory. Council action: review for restructure, merger, or closure.',
  },
};

export function LifecycleVerdictViz({
  total,
  expectedTotal,
  counts,
  methodologyVersions,
  latestComputedAt,
}: Props) {
  const palette = useChartPalette();

  const tone: Record<keyof VerdictCounts, string> = {
    FRONTIER: palette.positive,
    RISING: palette.series[0] ?? palette.neutral,
    STABLE: palette.series[2] ?? palette.neutral,
    SUNSET: palette.negative,
  };

  if (total === 0) {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-dashed border-border-subtle bg-surface-2/30 p-4 text-[11px] text-text-tertiary">
        <p className="text-text-secondary">No lifecycle snapshots yet — the home dashboard reads from a write-through cache.</p>
        <p>
          Run <code className="rounded bg-surface-2 px-1.5 py-0.5 font-tabular text-[10.5px]">pnpm programs:lifecycle-snapshot</code>{' '}
          to backfill verdicts for all {expectedTotal} canonical programs.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Stacked bar */}
      <div className="flex h-9 w-full overflow-hidden rounded">
        {VERDICTS.map((v) => {
          const value = counts[v];
          const pct = total > 0 ? (value / total) * 100 : 0;
          if (pct === 0) return null;
          return (
            <div
              key={v}
              style={{ width: `${pct}%`, backgroundColor: tone[v], opacity: 0.92 }}
              title={`${COPY[v].label}: ${value} of ${total} (${pct.toFixed(1)}%)`}
              className="flex items-center justify-center"
            >
              {pct >= 8 && (
                <span className="font-tabular text-[10.5px] font-semibold text-surface-1">
                  {value}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* 4-up tile row */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {VERDICTS.map((v) => {
          const value = counts[v];
          const pct = total > 0 ? (value / total) * 100 : 0;
          return (
            <div
              key={v}
              className="flex flex-col gap-1 rounded-md border border-border-subtle bg-surface-1 p-2.5"
            >
              <div className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: tone[v] }}
                />
                <span className="text-[10px] uppercase tracking-wide text-text-tertiary">
                  {COPY[v].label}
                </span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="font-tabular text-xl font-semibold text-text-primary">
                  {value}
                </span>
                <span className="font-tabular text-[10.5px] text-text-tertiary">
                  {pct.toFixed(0)}%
                </span>
              </div>
              <p className="text-[10.5px] leading-snug text-text-tertiary">
                {COPY[v].description}
              </p>
            </div>
          );
        })}
      </div>

      {/* Footer: coverage + methodology */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[10.5px] text-text-tertiary">
        <span>
          Coverage{' '}
          <span className="font-tabular text-text-secondary">
            {total}/{expectedTotal}
          </span>
          {total < expectedTotal && (
            <span className="ml-1.5 text-warning">
              ({expectedTotal - total} missing — run{' '}
              <code className="rounded bg-surface-2 px-1 font-tabular">pnpm programs:lifecycle-snapshot</code>)
            </span>
          )}
        </span>
        <span>
          {methodologyVersions.length > 0 && (
            <span className="opacity-80">
              Methodology{' '}
              <span className="font-tabular text-text-secondary">
                {methodologyVersions.join(', ')}
              </span>
            </span>
          )}
          {latestComputedAt && (
            <span className="ml-3 opacity-60">
              · last computed {new Date(latestComputedAt).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
              })}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
