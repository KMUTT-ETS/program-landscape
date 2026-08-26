'use client';

import * as React from 'react';
import { Table } from 'lucide-react';
import type { ApiMeta } from '@kku/shared';
import { cn } from '../lib/cn';
import { ProvenanceButton } from '../feedback/provenance-button';
import { FreshnessBadge } from '../feedback/freshness-badge';
import { ConfidenceBadge } from '../feedback/confidence-badge';
import { Button } from '../primitives/button';

// Universal chart frame. Every viz in the system renders inside one of
// these so we never forget provenance, freshness, or the "show data"
// table toggle (accessibility + audit). Module code hands over `<data>`
// and `<dataTable>`; the frame does everything else.

export interface ChartFrameProps {
  title: string;
  /** Short description, shown beneath the title in smaller text. */
  description?: string;
  /** API envelope meta for the chart's dataset. */
  meta: ApiMeta;
  /** The actual chart (Recharts, d3, whatever) — rendered when showData is off. */
  chart: React.ReactNode;
  /** Tabular fallback — rendered when showData is on, and readable by screen readers. */
  dataTable: React.ReactNode;
  /** Fixed pixel height; caller picks because Recharts doesn't auto-size without one. */
  height?: number;
  className?: string;
}

export function ChartFrame({
  title,
  description,
  meta,
  chart,
  dataTable,
  height = 260,
  className,
}: ChartFrameProps) {
  const [showData, setShowData] = React.useState(false);

  return (
    <section
      className={cn(
        'flex flex-col gap-3 rounded-lg border border-border-default bg-surface-1 p-4',
        className,
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate text-sm font-semibold text-text-primary">
              {title}
            </h3>
            <ProvenanceButton size="xs" title={title} meta={meta} />
          </div>
          {description && (
            <p className="mt-0.5 text-xs text-text-tertiary">{description}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <FreshnessBadge freshnessDate={meta.freshnessDate} label={title} />
          {meta.confidence != null && (
            <ConfidenceBadge value={meta.confidence} />
          )}
          <Button
            variant={showData ? 'subtle' : 'ghost'}
            size="xs"
            onClick={() => setShowData((s) => !s)}
            aria-pressed={showData}
            title="Show underlying data"
          >
            <Table className="mr-1 size-icon-xs" aria-hidden />
            {showData ? 'Hide data' : 'Show data'}
          </Button>
        </div>
      </header>

      <div style={{ height }} className={cn(showData && 'overflow-auto')}>
        {showData ? dataTable : chart}
      </div>
    </section>
  );
}
