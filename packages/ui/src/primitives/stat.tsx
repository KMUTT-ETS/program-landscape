import * as React from 'react';
import type { ModuleKey } from '@kku/design';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { cn } from '../lib/cn';

// 2026-04-24 new primitive — the Stat metric-tile. Council packs and
// module cockpits are dense with big numbers; the Stat standardises
// how one "number + label + trend delta" renders so every KPI strip
// feels of a piece.
//
// Visual contract:
//   eyebrow   ← 11px uppercase, module-tinted (or neutral)
//   ─ value   ← 30px tabular-nums, tight tracking
//   delta     ← arrow + signed % in success/danger/tertiary tone
//   hint      ← optional sub-line (e.g. "vs. last year")

export interface StatProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  value: React.ReactNode;
  /** Signed delta (e.g. "+2.3%", "-14"). If a number, formatted as `%`. */
  delta?: number | string | null;
  /** Override delta tone; defaults to success when positive, danger when negative. */
  deltaTone?: 'positive' | 'negative' | 'neutral';
  /** Sub-line after the delta. */
  hint?: React.ReactNode;
  /** Icon rendered as a small chip to the left of the label. */
  icon?: React.ReactNode;
  /** Module tint applied to the eyebrow + icon chip. */
  moduleKey?: ModuleKey;
}

const MODULE_EYEBROW: Record<ModuleKey, string> = {
  cockpit: 'text-module-cockpit',
  programs: 'text-module-programs',
  trends: 'text-module-trends',
  gap: 'text-module-gap',
  scenarios: 'text-module-scenarios',
  benchmarking: 'text-module-benchmarking',
  analyst: 'text-module-analyst',
  decisions: 'text-module-decisions',
  neutral: 'text-text-tertiary',
};

const MODULE_ICON_BG: Record<ModuleKey, string> = {
  cockpit: 'bg-module-cockpit/12 text-module-cockpit',
  programs: 'bg-module-programs/12 text-module-programs',
  trends: 'bg-module-trends/12 text-module-trends',
  gap: 'bg-module-gap/12 text-module-gap',
  scenarios: 'bg-module-scenarios/12 text-module-scenarios',
  benchmarking: 'bg-module-benchmarking/12 text-module-benchmarking',
  analyst: 'bg-module-analyst/12 text-module-analyst',
  decisions: 'bg-module-decisions/12 text-module-decisions',
  neutral: 'bg-surface-2 text-text-secondary',
};

function resolveDeltaTone(
  delta: number | string | null | undefined,
  override?: 'positive' | 'negative' | 'neutral',
): 'positive' | 'negative' | 'neutral' {
  if (override) return override;
  if (delta === null || delta === undefined) return 'neutral';
  const n = typeof delta === 'number' ? delta : parseFloat(String(delta));
  if (!Number.isFinite(n)) return 'neutral';
  if (n > 0) return 'positive';
  if (n < 0) return 'negative';
  return 'neutral';
}

function formatDelta(delta: number | string | null | undefined): string | null {
  if (delta === null || delta === undefined) return null;
  if (typeof delta === 'string') return delta;
  const sign = delta > 0 ? '+' : '';
  return `${sign}${delta.toFixed(1)}%`;
}

const DELTA_TONE_CLASSES: Record<'positive' | 'negative' | 'neutral', string> = {
  positive: 'text-data-positive',
  negative: 'text-data-negative',
  neutral: 'text-text-tertiary',
};

export function Stat({
  label,
  value,
  delta,
  deltaTone,
  hint,
  icon,
  moduleKey = 'neutral',
  className,
  ...props
}: StatProps) {
  const tone = resolveDeltaTone(delta, deltaTone);
  const deltaText = formatDelta(delta);
  const DeltaArrow = tone === 'positive' ? ArrowUpRight : tone === 'negative' ? ArrowDownRight : null;
  return (
    <div className={cn('flex flex-col gap-1.5', className)} {...props}>
      <div className="flex items-center gap-2">
        {icon && (
          <span
            aria-hidden
            className={cn(
              'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md',
              '[&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:stroke-[2.2]',
              MODULE_ICON_BG[moduleKey],
            )}
          >
            {icon}
          </span>
        )}
        <span
          className={cn(
            'truncate text-[11px] font-semibold uppercase tracking-[0.12em]',
            MODULE_EYEBROW[moduleKey],
          )}
        >
          {label}
        </span>
      </div>
      <div className="font-mono text-[30px] font-semibold leading-none tracking-[-0.01em] text-text-primary tabular-nums">
        {value}
      </div>
      {(deltaText || hint) && (
        <div className="flex items-center gap-1.5 text-[12px]">
          {deltaText && (
            <span
              className={cn(
                'inline-flex items-center gap-0.5 font-semibold tabular-nums',
                DELTA_TONE_CLASSES[tone],
              )}
            >
              {DeltaArrow && <DeltaArrow className="h-3.5 w-3.5" aria-hidden />}
              {deltaText}
            </span>
          )}
          {hint && <span className="truncate text-text-tertiary">{hint}</span>}
        </div>
      )}
    </div>
  );
}

export interface StatStripProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Column count at the md+ breakpoint. Below, tiles stack 2-up. */
  columns?: 2 | 3 | 4 | 5 | 6;
}

/** Horizontal row of Stat tiles with a shared hairline card wrapper. */
export function StatStrip({
  className,
  columns = 4,
  children,
  ...props
}: StatStripProps) {
  const colClass =
    columns === 2
      ? 'md:grid-cols-2'
      : columns === 3
        ? 'md:grid-cols-3'
        : columns === 4
          ? 'md:grid-cols-4'
          : columns === 5
            ? 'md:grid-cols-5'
            : 'md:grid-cols-6';
  return (
    <div
      className={cn(
        'grid grid-cols-2 divide-y divide-x-0 divide-border-subtle rounded-xl border border-border-subtle bg-surface-1',
        'md:divide-x md:divide-y-0',
        colClass,
        className,
      )}
      {...props}
    >
      {React.Children.map(children, (child, i) => (
        <div key={i} className="p-5">
          {child}
        </div>
      ))}
    </div>
  );
}
