'use client';

import * as React from 'react';
import { Clock } from 'lucide-react';
import { cn } from '../lib/cn';
import { Tooltip, TooltipContent, TooltipTrigger } from '../primitives/tooltip';

// Shows "Updated Xh ago" with the exact timestamp on hover. The visual
// tone signals staleness:
//   - fresh (< 24h):   neutral
//   - stale (1-7d):    warning subtle
//   - very stale (>7d): danger subtle
//
// Rules live in CLAUDE.md → Council-readiness.

export interface FreshnessBadgeProps {
  freshnessDate: string | Date | null | undefined;
  className?: string;
  /** What the timestamp describes, e.g. "enrolment figures". */
  label?: string;
}

function parse(d: string | Date | null | undefined): Date | null {
  if (!d) return null;
  const date = typeof d === 'string' ? new Date(d) : d;
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Render a date as either `YYYY-MM-DD HH:MM:SS UTC` (when time-of-day
 *  is meaningful) or `YYYY-MM-DD (date only)` (when the source was a
 *  Postgres DATE column — those arrive as 00:00:00 UTC, and showing
 *  "00:00:00 UTC" looks like the time component was wrongly stripped). */
function formatTooltipTimestamp(d: Date): string {
  const iso = d.toISOString();
  const isMidnightUtc = iso.endsWith('T00:00:00.000Z');
  if (isMidnightUtc) return `${iso.slice(0, 10)} (date only)`;
  return `${iso.replace('T', ' ').slice(0, 19)} UTC`;
}

function relative(d: Date): { text: string; hours: number } {
  const hours = (Date.now() - d.getTime()) / 36e5;
  if (hours < 1) return { text: `${Math.max(1, Math.floor(hours * 60))}m ago`, hours };
  if (hours < 24) return { text: `${Math.floor(hours)}h ago`, hours };
  const days = hours / 24;
  if (days < 30) return { text: `${Math.floor(days)}d ago`, hours };
  const months = days / 30;
  if (months < 12) return { text: `${Math.floor(months)}mo ago`, hours };
  return { text: `${Math.floor(days / 365)}y ago`, hours };
}

export function FreshnessBadge({
  freshnessDate,
  className,
  label = 'data',
}: FreshnessBadgeProps) {
  // Defer the time-relative render to after hydration so SSR and client
  // markup match. `Date.now()` differs between the two, so computing
  // tone/text during render produces hydration mismatches near every
  // bucket boundary (59m → 1h, 23h → 1d, …).
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const date = parse(freshnessDate);
  if (!date) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs',
          'bg-surface-2 text-text-tertiary',
          className,
        )}
      >
        <Clock className="h-3 w-3" aria-hidden />
        No freshness
      </span>
    );
  }

  const isoDate = date.toISOString().slice(0, 10);
  const rel = mounted ? relative(date) : null;
  const text = rel ? rel.text : isoDate;
  const tone = !rel
    ? 'bg-surface-2 text-text-secondary'
    : rel.hours < 24
      ? 'bg-surface-2 text-text-secondary'
      : rel.hours < 24 * 7
        ? 'bg-warning-subtle text-warning'
        : 'bg-danger-subtle text-danger';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'inline-flex cursor-help items-center gap-1 rounded-full px-2 py-0.5 text-xs',
            tone,
            className,
          )}
        >
          <Clock className="h-3 w-3" aria-hidden />
          Updated {text}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] uppercase tracking-wide text-text-tertiary">
            {label}
          </span>
          <span className="font-tabular">{formatTooltipTimestamp(date)}</span>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
