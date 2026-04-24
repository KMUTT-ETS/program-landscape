import * as React from 'react';
import { cn } from '../lib/cn';

// The frame every authenticated module renders inside. 2026-04-24 —
// the sidebar is now FIXED at the left edge so it owns the full
// viewport height (brand → modules → user chip as one continuous
// column). The top bar and main content sit in a column to its right.
//
//   ┌──────────┬──────── TopBar ─────────────┐
//   │          ├─────────────────────────────┤
//   │ LeftNav  │ content                     │
//   │  (fixed) │                             │
//   │          │                             │
//   └──────────┴─────────────────────────────┘
//
// RightPanel is rendered by Radix Dialog portal, not as a grid column —
// it slides over the content area.

export interface AppShellProps {
  topBar: React.ReactNode;
  leftNav: React.ReactNode;
  children: React.ReactNode;
  /** Tailwind class for the nav width. Default 240px. */
  navWidthClass?: string;
  className?: string;
}

export function AppShell({
  topBar,
  leftNav,
  children,
  navWidthClass = 'w-[240px]',
  className,
}: AppShellProps) {
  return (
    <div className={cn('min-h-screen bg-surface-0 text-text-primary', className)}>
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 hidden shrink-0 md:block',
          navWidthClass,
        )}
      >
        {leftNav}
      </aside>
      <div className="flex min-h-screen flex-col md:ml-[240px]">
        {topBar}
        {/* Padding lives on the shell so pages don't each re-invent
            it. max-w keeps long-form content from drifting into
            unreadable measures on ultra-wide monitors. */}
        <main className="min-w-0 flex-1 px-6 py-6 md:px-8 md:py-8">
          <div className="mx-auto max-w-[1400px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
