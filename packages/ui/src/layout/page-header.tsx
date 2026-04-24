import * as React from 'react';
import type { ModuleKey } from '@kku/design';
import { cn } from '../lib/cn';

// 2026-04-24 redesign — the PageHeader is now the handshake between
// the module colour (set once per page) and the rest of the page. It
// prints:
//
//   [ eyebrow · module name                ]  ← optional coloured label
//   [ H1 title                             ]  ← page title
//   [ subtitle                             ]
//   ─ gradient underline in module colour ─
//   [ filters row ]                          ← optional
//
// The coloured eyebrow + underline are the only module-signalling
// inside the content area; the sidebar handles the rest. If no
// `moduleKey` is provided the header is plain neutral.

export interface PageHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  eyebrow?: React.ReactNode;
  actions?: React.ReactNode;
  filters?: React.ReactNode;
  /** Module signature colour. If omitted, underline + eyebrow render neutral. */
  moduleKey?: ModuleKey;
  className?: string;
}

// Static Tailwind class maps — Tailwind JIT requires literal strings.
const EYEBROW_CLASSES: Record<ModuleKey, string> = {
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

const UNDERLINE_CLASSES: Record<ModuleKey, string> = {
  cockpit: 'from-module-cockpit/80 via-module-cockpit/30',
  programs: 'from-module-programs/80 via-module-programs/30',
  trends: 'from-module-trends/80 via-module-trends/30',
  gap: 'from-module-gap/80 via-module-gap/30',
  scenarios: 'from-module-scenarios/80 via-module-scenarios/30',
  benchmarking: 'from-module-benchmarking/80 via-module-benchmarking/30',
  analyst: 'from-module-analyst/80 via-module-analyst/30',
  decisions: 'from-module-decisions/80 via-module-decisions/30',
  neutral: 'from-border-strong/40 via-border-default/20',
};

export function PageHeader({
  title,
  subtitle,
  eyebrow,
  actions,
  filters,
  moduleKey = 'neutral',
  className,
}: PageHeaderProps) {
  return (
    <header className={cn('mb-6 flex flex-col gap-4', className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          {eyebrow && (
            <div
              className={cn(
                'mb-2 text-[11px] font-semibold uppercase tracking-[0.14em]',
                EYEBROW_CLASSES[moduleKey],
              )}
            >
              {eyebrow}
            </div>
          )}
          <h1 className="truncate text-[28px] font-semibold leading-tight tracking-[-0.01em] text-text-primary">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-2 max-w-[70ch] text-[15px] leading-relaxed text-text-secondary">
              {subtitle}
            </p>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {/* Module-coloured gradient underline — soft-left to transparent-
          right so it reads as a highlight rather than a ruled divider. */}
      <div
        aria-hidden
        className={cn(
          'h-px w-full rounded-full bg-gradient-to-r to-transparent',
          UNDERLINE_CLASSES[moduleKey],
        )}
      />
      {filters && <div className="flex items-center gap-2">{filters}</div>}
    </header>
  );
}
