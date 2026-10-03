'use client';

// Ranked list of programme pairs for /education/program-overlap
// (program-overlap.v1, spec §10.1). It sits under the overlap network and
// doubles as the chart's table view: every edge drawn above is one row here,
// strongest first. A row opens the pair side panel.
//
// Type-only imports from @kku/db: this file runs in the client bundle.

import * as React from 'react';
import type { OverlapMatrixCell, OverlapProgrammeRef } from '@kku/db';
import { Badge } from '@kku/ui';
import { OverlapMiniBar } from './pair-evidence';
import { LANGUAGE_VARIANT_LABEL, actionBadgeLabel, pct, programmeLabel } from './labels';

export interface OverlapPairRow {
  cell: OverlapMatrixCell;
  /** The ranked measure (index, structure or content). */
  value: number;
  /** Larger containment direction, or null. */
  containment: { inner: 'A' | 'B'; value: number } | null;
}

export function OverlapPairList({
  rows,
  programmes,
  valueLabel,
  selectedPairId,
  onOpen,
  emptyText,
}: {
  rows: readonly OverlapPairRow[];
  programmes: ReadonlyMap<string, OverlapProgrammeRef>;
  /** Header of the ranked number, e.g. "Index". */
  valueLabel: string;
  selectedPairId: string | null;
  onOpen: (pairId: string) => void;
  emptyText: string;
}) {
  if (rows.length === 0) return <p className="text-sm text-text-tertiary">{emptyText}</p>;
  return (
    <ol className="flex flex-col" aria-label="Programme pairs, strongest overlap first">
      {rows.map((r, i) => {
        const a = programmes.get(r.cell.a);
        const b = programmes.get(r.cell.b);
        const selected = r.cell.pairId === selectedPairId;
        return (
          <li key={r.cell.pairId} className="border-t border-subtle first:border-t-0">
            <button
              type="button"
              onClick={() => onOpen(r.cell.pairId)}
              aria-current={selected ? 'true' : undefined}
              className={`grid w-full grid-cols-[28px_minmax(0,1fr)] items-start gap-x-[12px] gap-y-[8px] px-[8px] py-[12px] text-left hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none md:grid-cols-[28px_minmax(0,1fr)_72px_180px_150px] md:items-center ${
                selected ? 'bg-surface-3' : ''
              }`}
            >
              <span className="pt-[2px] text-xs tabular-nums text-text-tertiary">{i + 1}</span>

              <span className="flex min-w-0 flex-col gap-[6px]">
                <ProgrammeCell side="A" p={a} fallback={r.cell.a} />
                <ProgrammeCell side="B" p={b} fallback={r.cell.b} />
                <span className="flex flex-wrap gap-[6px]">
                  {r.cell.languageVariant ? <Badge tone="info">{LANGUAGE_VARIANT_LABEL}</Badge> : null}
                  {r.cell.primaryAction ? (
                    <Badge tone="neutral">{actionBadgeLabel(r.cell.primaryAction)}</Badge>
                  ) : null}
                </span>
              </span>

              <span className="col-start-2 flex items-baseline gap-[6px] md:col-start-auto md:flex-col md:items-end md:gap-0">
                <span className="text-[11px] text-text-tertiary">{valueLabel}</span>
                <span className="text-lg font-semibold tabular-nums text-text-primary">{Math.round(r.value)}</span>
              </span>

              <span className="col-start-2 flex flex-col gap-[6px] md:col-start-auto">
                <LayerLine label="Structure" value={r.cell.structure} />
                <LayerLine label="Content" value={r.cell.content} />
              </span>

              <span className="col-start-2 flex flex-col text-xs md:col-start-auto md:items-end">
                <span className="text-text-tertiary">Containment</span>
                {r.containment ? (
                  <span className="tabular-nums text-text-primary">
                    {r.containment.inner === 'A' ? 'A ⊂ B' : 'B ⊂ A'}
                    <span className="text-text-tertiary"> · </span>
                    {Math.round(r.containment.value)} %
                  </span>
                ) : (
                  <span className="text-text-tertiary">—</span>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function ProgrammeCell({ side, p, fallback }: { side: 'A' | 'B'; p: OverlapProgrammeRef | undefined; fallback: string }) {
  return (
    <span className="flex min-w-0 items-baseline gap-[8px]">
      <span className="w-[12px] shrink-0 text-xs font-semibold text-text-tertiary">{side}</span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-text-primary" lang="th">
          {p ? programmeLabel(p) : fallback}
        </span>
        {p ? (
          <span className="block truncate text-xs text-text-tertiary">
            {[p.nameEn, p.facultyCode].filter(Boolean).join(' · ')}
          </span>
        ) : null}
      </span>
    </span>
  );
}

function LayerLine({ label, value }: { label: string; value: number | null }) {
  return (
    <span className="grid grid-cols-[64px_minmax(0,1fr)_28px] items-center gap-[8px] text-xs">
      <span className="text-text-tertiary">{label}</span>
      <OverlapMiniBar value={value} />
      <span className={`text-right tabular-nums ${value === null ? 'text-text-tertiary' : 'text-text-secondary'}`}>
        {pct(value)}
      </span>
    </span>
  );
}
