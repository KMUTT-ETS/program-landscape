'use client';

import * as React from 'react';
import { ArrowDown, ArrowRight, ArrowUp } from 'lucide-react';
import type { ApiMeta } from '@kku/shared';
import { cn } from '../lib/cn';
import { Card, CardHeader, CardTitle } from '../primitives/card';
import { ProvenanceButton } from '../feedback/provenance-button';
import { FreshnessBadge } from '../feedback/freshness-badge';

export interface KPIProps {
  /** Short, English-only label (e.g. "Enrolled, 2024"). */
  label: string;
  /** Pre-formatted display value (e.g. "3,075"). Caller formats. */
  value: React.ReactNode;
  /** Delta vs prior period. Positive means improvement; caller controls sign. */
  delta?: {
    value: number;
    /** Which direction is "good". If absent, colour stays neutral. */
    goodDirection?: 'up' | 'down';
    /** Pre-formatted display (e.g. "+12%" or "+1.2k"). */
    display: string;
  };
  /** Small inline visualization slot (e.g. sparkline). */
  sparkline?: React.ReactNode;
  /** Provenance metadata. Required for Council use — skippable only in styleguide stubs. */
  meta?: ApiMeta;
  className?: string;
}

export function KPI({ label, value, delta, sparkline, meta, className }: KPIProps) {
  const tone =
    !delta || !delta.goodDirection
      ? 'text-text-tertiary'
      : (delta.value >= 0) === (delta.goodDirection === 'up')
        ? 'text-data-positive'
        : 'text-data-negative';
  const Arrow = !delta ? null : delta.value === 0 ? ArrowRight : delta.value > 0 ? ArrowUp : ArrowDown;
  return (
    <Card padding="sm" elevation="sm" className={cn('flex flex-col gap-1.5', className)}>
      <CardHeader className="mb-0">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <CardTitle className="truncate text-xs font-medium uppercase tracking-wide text-text-tertiary">
            {label}
          </CardTitle>
          {meta && <ProvenanceButton size="xs" title={label} meta={meta} />}
        </div>
      </CardHeader>
      <div className="flex items-end justify-between gap-3">
        <div className="font-tabular text-2xl font-semibold tracking-tight text-text-primary">
          {value}
        </div>
        {sparkline && <div className="h-8 flex-1 opacity-90">{sparkline}</div>}
      </div>
      <div className="flex items-center justify-between gap-2">
        {delta ? (
          <span className={cn('inline-flex items-center gap-1 text-xs font-medium', tone)}>
            {Arrow && <Arrow className="h-3 w-3" aria-hidden />}
            <span className="font-tabular">{delta.display}</span>
          </span>
        ) : (
          <span />
        )}
        {meta && (
          <FreshnessBadge
            freshnessDate={meta.freshnessDate}
            label={label}
            className="text-[10px]"
          />
        )}
      </div>
    </Card>
  );
}
