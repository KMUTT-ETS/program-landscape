'use client';

import * as React from 'react';
import { Info } from 'lucide-react';
import type { ApiMeta } from '@kku/shared';
import { cn } from '../lib/cn';
import { Tooltip, TooltipContent, TooltipTrigger } from '../primitives/tooltip';
import { useProvenance } from './provenance-context';

// The "ⓘ" icon next to every chart, every metric card, every AI output.
// Single-click opens the app-global ProvenanceDrawer via context.
//
// Non-negotiable per CLAUDE.md → Council-readiness. Do not render charts
// or metric cards without exposing one of these.

export interface ProvenanceButtonProps {
  /** Short label for what this provenance describes, e.g. "Enrollment 2022–2024". */
  title: string;
  /** ApiMeta from the envelope that produced this number. */
  meta: ApiMeta;
  className?: string;
  /** `xs` for inline beside a KPI; `sm` default beside a chart title. */
  size?: 'xs' | 'sm';
}

export function ProvenanceButton({
  title,
  meta,
  className,
  size = 'sm',
}: ProvenanceButtonProps) {
  const prov = useProvenance();
  const sizeClass = size === 'xs' ? 'h-3.5 w-3.5' : 'h-4 w-4';
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`Show provenance for ${title}`}
          className={cn(
            'inline-flex items-center justify-center rounded-sm text-text-tertiary hover:text-text-primary',
            'transition-colors duration-fast',
            className,
          )}
          onClick={() =>
            prov.show({ id: `${title}-${Date.now()}`, title, meta })
          }
        >
          <Info className={sizeClass} aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent>Show data sources &amp; method</TooltipContent>
    </Tooltip>
  );
}
