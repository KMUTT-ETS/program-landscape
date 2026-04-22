import * as React from 'react';
import { cn } from '../lib/cn';

// Lightweight inline number display for table cells, drawers, and
// descriptive content. If a metric has delta/provenance, use KPI instead.

export interface StatProps {
  label: string;
  value: React.ReactNode;
  helper?: string;
  align?: 'left' | 'right';
  className?: string;
}

export function Stat({ label, value, helper, align = 'left', className }: StatProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-0.5',
        align === 'right' && 'items-end text-right',
        className,
      )}
    >
      <span className="text-[11px] uppercase tracking-wide text-text-tertiary">
        {label}
      </span>
      <span className="font-tabular text-base font-semibold text-text-primary">
        {value}
      </span>
      {helper && <span className="text-xs text-text-tertiary">{helper}</span>}
    </div>
  );
}
