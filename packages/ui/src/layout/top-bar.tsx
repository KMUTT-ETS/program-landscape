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
        // 2026-05-02c: 56px → 72px, bold gradient backdrop, animated
        // coral underline edge — replaces the previous "thin
        // translucent strip with subtle tints" that read as
        // unchanged.
        // 2026-05-05: responsive padding/gap so the bar doesn't
        // overflow on narrow viewports. The mobile-only hamburger
        // strip sits above this on <md screens (rendered by
        // AppShell), so the topbar still reads as the second row.
        'kku-topbar sticky top-14 z-20 flex h-14 items-center gap-2 px-3',
        'md:top-0 md:z-30 md:h-[72px] md:gap-5 md:px-7',
        'text-text-primary',
        className,
      )}
    >
      <div className="hidden min-w-0 shrink-0 items-center gap-2 text-[15px] text-text-secondary md:flex">
        {breadcrumb}
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-2 md:gap-3">{center}</div>
      <div className="flex shrink-0 items-center gap-1 md:gap-2">{right}</div>
    </header>
  );
}
