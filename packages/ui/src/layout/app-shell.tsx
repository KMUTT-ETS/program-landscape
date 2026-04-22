import * as React from 'react';
import { cn } from '../lib/cn';

// The frame every authenticated module renders inside. Grid:
//
//   ┌────────────── TopBar ──────────────┐
//   ├ LeftNav ┬ content ┬ (RightPanel) ──┤
//   │         │         │                │
//   └─────────┴─────────┴────────────────┘
//
// RightPanel is rendered by Radix Dialog portal, not as a grid column —
// it slides over the content area.

export interface AppShellProps {
  topBar: React.ReactNode;
  leftNav: React.ReactNode;
  children: React.ReactNode;
  /** Tailwind class for the nav width. Default 220px. */
  navWidthClass?: string;
  className?: string;
}

export function AppShell({
  topBar,
  leftNav,
  children,
  navWidthClass = 'w-[220px]',
  className,
}: AppShellProps) {
  return (
    <div className={cn('min-h-screen bg-surface-0 text-text-primary', className)}>
      {topBar}
      <div className="flex min-h-[calc(100vh-56px)]">
        <aside
          className={cn(
            'hidden shrink-0 border-r border-border-default bg-surface-1 md:block',
            navWidthClass,
          )}
        >
          {leftNav}
        </aside>
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}
