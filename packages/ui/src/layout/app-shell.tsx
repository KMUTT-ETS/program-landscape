'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { cn } from '../lib/cn';

// The frame every authenticated module renders inside.
//
// Desktop (md+, ≥768px):
//   ┌──────────┬──────── TopBar ─────────────┐
//   │          ├─────────────────────────────┤
//   │ LeftNav  │ content                     │
//   │  (fixed) │                             │
//   └──────────┴─────────────────────────────┘
//
// Mobile (<768px):
//   ┌─────────────────────────────────────────┐
//   │ ☰  Brand                                │  ← mobile bar (56px)
//   ├─────────────────────────────────────────┤
//   │ TopBar (compact — scrolls horizontally) │
//   ├─────────────────────────────────────────┤
//   │ content                                 │
//   └─────────────────────────────────────────┘
//   Tap ☰ → LeftNav slides in from the left over a dimmed backdrop.
//
// RightPanel is rendered by Radix Dialog portal, not as a grid column —
// it slides over the content area regardless of breakpoint.

export interface AppShellProps {
  topBar: React.ReactNode;
  leftNav: React.ReactNode;
  children: React.ReactNode;
  /** Tailwind class for the nav width. Default 280px. */
  navWidthClass?: string;
  /**
   * Compact label rendered in the mobile-only top bar next to the
   * hamburger icon. Defaults to "Program Landscape".
   */
  mobileBrandLabel?: string;
  className?: string;
}

export function AppShell({
  topBar,
  leftNav,
  children,
  navWidthClass = 'w-[280px]',
  mobileBrandLabel = 'Program Landscape',
  className,
}: AppShellProps) {
  const [open, setOpen] = React.useState(false);
  const pathname = usePathname();

  // Close the drawer on route change so the user lands on the new
  // page without an obstructing overlay.
  React.useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Lock body scroll while the drawer is open on mobile.
  React.useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  }, [open]);

  // Close on Escape — keyboard parity with the rest of our overlays.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className={cn('min-h-screen bg-surface-0 text-text-primary', className)}>
      {/* Mobile backdrop — covers the content area when the drawer
          is open so taps anywhere outside the nav close it. */}
      <div
        aria-hidden
        onClick={() => setOpen(false)}
        className={cn(
          'fixed inset-0 z-30 bg-black/55 backdrop-blur-[2px] md:hidden',
          'transition-opacity duration-200 ease-out',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />

      {/* Sidebar — fixed on desktop, slide-in drawer on mobile. */}
      <aside
        aria-label="Primary navigation"
        aria-hidden={!open ? undefined : false}
        className={cn(
          'fixed inset-y-0 left-0 z-40 shrink-0',
          navWidthClass,
          // Desktop: always visible.
          'md:translate-x-0',
          // Mobile: slide in/out — controlled by `open`.
          open ? 'translate-x-0 shadow-2xl' : '-translate-x-full',
          'transition-transform duration-300 ease-out md:transition-none',
        )}
      >
        {leftNav}
        {/* Mobile close button — only visible inside the drawer. */}
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setOpen(false)}
          className={cn(
            'absolute right-3 top-4 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full',
            'bg-surface-1/90 text-text-secondary shadow-sm backdrop-blur-sm',
            'hover:bg-surface-2 hover:text-text-primary',
            'md:hidden',
          )}
        >
          <X className="h-5 w-5" />
        </button>
      </aside>

      <div className="flex min-h-screen flex-col md:ml-[280px]">
        {/* Mobile-only header strip with the hamburger trigger.
            Sits above the regular top bar so the user always has a
            way back to the nav. Hidden on md+ where the LeftNav is
            permanently visible. */}
        <div
          className={cn(
            'sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border-subtle',
            'bg-surface-0/95 px-4 backdrop-blur-sm md:hidden',
          )}
        >
          <button
            type="button"
            aria-label="Open menu"
            aria-expanded={open}
            onClick={() => setOpen(true)}
            className={cn(
              'inline-flex h-10 w-10 items-center justify-center rounded-lg',
              'text-text-primary hover:bg-surface-2',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-default',
            )}
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="truncate text-sm font-semibold tracking-tight">
            {mobileBrandLabel}
          </span>
        </div>
        {topBar}
        <main className="min-w-0 flex-1 px-4 py-6 md:px-10 md:py-10">
          <div className="mx-auto max-w-[1400px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
