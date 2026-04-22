'use client';

import * as React from 'react';
import { Sparkles } from 'lucide-react';
import { cn } from '../lib/cn';
import { Tooltip, TooltipContent, TooltipTrigger } from '../primitives/tooltip';

// Confidence for AI-generated content. Required on every AI output per
// CLAUDE.md. Thresholds chosen conservatively — analysts would rather
// see "medium" than trust a false "high".

export interface ConfidenceBadgeProps {
  /** 0–1 inclusive. Missing → "unknown". */
  value: number | null | undefined;
  className?: string;
  /** Optional model rationale shown in the tooltip. */
  rationale?: string;
}

function bucket(v: number): { level: 'high' | 'medium' | 'low'; tone: string } {
  if (v >= 0.8) return { level: 'high', tone: 'bg-success-subtle text-success' };
  if (v >= 0.55) return { level: 'medium', tone: 'bg-warning-subtle text-warning' };
  return { level: 'low', tone: 'bg-danger-subtle text-danger' };
}

export function ConfidenceBadge({ value, className, rationale }: ConfidenceBadgeProps) {
  if (value == null) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs',
          'bg-surface-2 text-text-tertiary',
          className,
        )}
      >
        <Sparkles className="h-3 w-3" aria-hidden />
        No confidence
      </span>
    );
  }
  const { level, tone } = bucket(value);
  const pct = Math.round(value * 100);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'inline-flex cursor-help items-center gap-1 rounded-full px-2 py-0.5 text-xs capitalize',
            tone,
            className,
          )}
        >
          <Sparkles className="h-3 w-3" aria-hidden />
          {level} <span className="font-tabular opacity-80">({pct}%)</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <div className="flex max-w-[260px] flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wide text-text-tertiary">
            Model confidence
          </span>
          <span>
            The model assigned <span className="font-tabular">{pct}%</span>{' '}
            confidence to this output.
          </span>
          {rationale && (
            <span className="text-text-secondary">{rationale}</span>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
