'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { Menu, X, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { cn } from '../lib/cn';

// Per-user sidebar mode preference. Stored in localStorage rather than
// the DB — it's a viewport-level UI affordance and varies per device.
// FOUC is a non-issue: the page renders with the default 'pinned' mode
// and the effect swaps to 'auto-hide' silently if that was the
// preference. The transition is unobtrusive.
type SidebarMode = 'pinned' | 'auto-hide';
const SIDEBAR_MODE_KEY = 'kku-sidebar-mode';
const SIDEBAR_DEFAULT_MODE: SidebarMode = 'pinned';

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
  const [mode, setMode] = React.useState<SidebarMode>(SIDEBAR_DEFAULT_MODE);
  const pathname = usePathname();

  // Hydrate mode from localStorage (client-only).
  React.useEffect(() => {
    try {
      const stored = window.localStorage.getItem(SIDEBAR_MODE_KEY);
      if (stored === 'auto-hide' || stored === 'pinned') {
        setMode(stored);
      }
    } catch {
      /* localStorage may be unavailable in private mode — silent fallback */
    }
  }, []);

  // Persist mode changes.
  React.useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_MODE_KEY, mode);
    } catch {
      /* ignore */
    }
  }, [mode]);

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

  // In auto-hide mode the sidebar behaves like the mobile drawer on
  // ALL viewports — hidden by default, slides in with a backdrop when
  // the user opens it. In pinned mode, the desktop sidebar is fixed
  // (current default behaviour).
  const isAutoHide = mode === 'auto-hide';

  return (
    <div className={cn('min-h-screen bg-surface-0 text-text-primary', className)}>
      {/* Backdrop — covers the content area when the drawer is open so
          taps anywhere outside the nav close it. In pinned mode the
          desktop nav is always visible, so the backdrop is mobile-only;
          in auto-hide mode it appears on every viewport. */}
      <div
        aria-hidden
        onClick={() => setOpen(false)}
        className={cn(
          'fixed inset-0 z-30 bg-black/55 backdrop-blur-[2px]',
          isAutoHide ? '' : 'md:hidden',
          'transition-opacity duration-200 ease-out',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />

      {/* Sidebar — fixed on desktop in pinned mode, slide-in drawer
          otherwise (mobile always, plus desktop in auto-hide mode). */}
      <aside
        aria-label="Primary navigation"
        aria-hidden={!open ? undefined : false}
        className={cn(
          'fixed inset-y-0 left-0 z-40 shrink-0',
          navWidthClass,
          // Pinned mode keeps the desktop nav visible permanently.
          !isAutoHide && 'md:translate-x-0',
          // Drawer translation (mobile always, desktop when auto-hide).
          open ? 'translate-x-0 shadow-2xl' : '-translate-x-full',
          'transition-transform duration-300 ease-out',
          !isAutoHide && 'md:transition-none',
        )}
      >
        {leftNav}
        {/* Close button — visible inside the drawer on every viewport
            where the nav is currently a drawer (always when auto-hide,
            mobile only otherwise). */}
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setOpen(false)}
          className={cn(
            'absolute right-3 top-4 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full',
            'bg-surface-1/90 text-text-secondary shadow-sm backdrop-blur-sm',
            'hover:bg-surface-2 hover:text-text-primary',
            !isAutoHide && 'md:hidden',
          )}
        >
          <X className="size-icon-lg" />
        </button>
      </aside>

      <div
        className={cn(
          'flex min-h-screen flex-col',
          // Pinned mode reserves a 280px gutter; auto-hide takes full width.
          !isAutoHide && 'md:ml-[280px]',
        )}
      >
        {/* Top strip with the drawer trigger + sidebar-mode toggle. On
            mobile it's always visible (mode-agnostic); on desktop it's
            visible only when auto-hide is on, since pinned mode has the
            sidebar permanently expanded. */}
        <div
          className={cn(
            'sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border-subtle',
            'bg-surface-0/95 px-4 backdrop-blur-sm',
            !isAutoHide && 'md:hidden',
          )}
        >
          {/* Hamburger — opens the drawer. Only meaningful when the
              sidebar isn't already visible (mobile or auto-hide+closed). */}
          {(!isAutoHide || (isAutoHide && !open)) && (
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
              <Menu className="size-icon-lg" />
            </button>
          )}
          <span className="truncate text-sm font-semibold tracking-tight md:hidden">
            {mobileBrandLabel}
          </span>
          {/* Sidebar-mode toggle — switches between pinned and
              auto-hide. Right-aligned on desktop, far-right on mobile. */}
          <button
            type="button"
            aria-label={isAutoHide ? 'Pin sidebar' : 'Auto-hide sidebar (drawer)'}
            title={isAutoHide ? 'Pin sidebar' : 'Auto-hide sidebar (drawer)'}
            onClick={() => {
              setMode(isAutoHide ? 'pinned' : 'auto-hide');
              setOpen(false);
            }}
            className={cn(
              'ml-auto inline-flex h-9 w-9 items-center justify-center rounded-lg',
              'text-text-secondary hover:bg-surface-2 hover:text-text-primary',
            )}
          >
            {isAutoHide ? (
              <PanelLeftOpen className="size-icon-lg" />
            ) : (
              <PanelLeftClose className="size-icon-lg" />
            )}
          </button>
        </div>
        {/* In pinned mode on desktop, the strip above is hidden — so
            the mode-toggle still needs a desktop home. Render a small
            floating control at the top-left of the content area. */}
        {!isAutoHide && (
          <button
            type="button"
            aria-label="Auto-hide sidebar (drawer)"
            title="Auto-hide sidebar (drawer)"
            onClick={() => setMode('auto-hide')}
            className={cn(
              'fixed left-[300px] top-3 z-30 hidden h-8 w-8 items-center justify-center rounded-md',
              'bg-surface-1/90 text-text-tertiary shadow-sm backdrop-blur-sm',
              'hover:bg-surface-2 hover:text-text-primary md:inline-flex',
            )}
          >
            <PanelLeftClose className="size-icon-md" />
          </button>
        )}
        {topBar}
        <main className="min-w-0 flex-1 px-4 py-6 md:px-10 md:py-10">
          <div className="mx-auto max-w-[1400px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
