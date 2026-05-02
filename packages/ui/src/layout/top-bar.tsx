import * as React from 'react';
import { cn } from '../lib/cn';

// 2026-04-24 redesign — the TopBar is now a slim neutral strip (56px).
// Brand lives in the LeftNav; the top bar holds breadcrumbs on the
// left, the scope selector + search in the centre, and the utility
// cluster (notifications + user) on the right.
//
// Layout grid:
//   [ breadcrumb | scopeSelector + search fills rest | right-cluster ]

export interface TopBarProps {
  /** Breadcrumb or contextual label rendered at the left edge. */
  breadcrumb?: React.ReactNode;
  /** Scope selector + search trigger. */
  center?: React.ReactNode;
  /** Notification bell + user chip. */
  right?: React.ReactNode;
  className?: string;
}

export function TopBar({ breadcrumb, center, right, className }: TopBarProps) {
  return (
    <header
      data-surface="neutral"
      className={cn(
        'sticky top-0 z-30 flex h-14 items-center gap-4 px-5',
        // Glossy translucent backdrop with faint coral wash. The
        // ::before layer (added via .kku-topbar) carries a subtle
        // gradient + a 1px hairline at the bottom that fades into
        // the accent edge palette on the right side.
        'kku-topbar bg-surface-0/70 backdrop-blur-xl',
        'text-text-primary',
        className,
      )}
    >
      <div className="flex min-w-0 shrink-0 items-center gap-2 text-[13px] text-text-secondary">
        {breadcrumb}
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-3">{center}</div>
      <div className="flex shrink-0 items-center gap-1.5">{right}</div>
    </header>
  );
}
