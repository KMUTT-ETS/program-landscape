'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Menu, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import { cn } from '../lib/cn';
import { NavChromeProvider } from './nav-chrome';
import {
  NAV_DEFAULT_VARIANT,
  NAV_ELEMENT_ID,
  readNavVariantCookie,
  writeNavVariantCookie,
  type NavVariant,
} from './nav-preference';

// The frame every authenticated module renders inside.
//
// Desktop (md+, ≥768px) — the nav is a RESERVED COLUMN, never an
// overlay. It has two widths:
//
//   expanded (280px)                rail (56px)
//   ┌──────────┬──── TopBar ──┐     ┌──┬──────── TopBar ────────┐
//   │ LeftNav  │ content      │     │▣ │ content                │
//   │          │              │     │▣ │                        │
//   │ [ ‹ ]    │              │     │‹ │                        │
//   └──────────┴──────────────┘     └──┴────────────────────────┘
//
// The rail keeps every module reachable — icon tiles with tooltips —
// so collapsing is a density choice, not a "hide the navigation"
// choice. Toggled by the chevron at the foot of the column or by `[`.
// Remembered per browser; default expanded.
//
// Mobile (<768px) — the column is collapsed unconditionally and the nav
// becomes an off-canvas drawer:
//
//   ┌─────────────────────────────────────────┐
//   │ ☰  Brand                                │  ← mobile bar
//   ├─────────────────────────────────────────┤
//   │ TopBar (compact)                        │
//   ├─────────────────────────────────────────┤
//   │ content                                 │
//   └─────────────────────────────────────────┘
//
// The drawer is a Radix Dialog, so the focus trap, Escape, body-scroll
// lock, `role="dialog"` and `aria-modal` come from the primitive rather
// than from four hand-rolled effects — the same primitive RightPanel is
// built on. The two things Radix cannot know about are handled here:
// closing on a route change, and closing when the viewport grows past
// the breakpoint (a trapped focus ring over a nav that CSS has just
// hidden is the worst of both layouts).
//
// Width lives in `--app-nav-width`, keyed off `[data-nav]` on this
// component's root by CSS in @kku/design. `initialVariant` is resolved
// on the SERVER from a cookie, so the first byte of HTML already
// carries the right width — no flash, and nothing to suppress a
// hydration warning for. See nav-preference.ts for why it is a cookie
// and not localStorage. RightPanel is portaled by Radix, not a grid
// column, so it slides over the content area at every breakpoint.

export interface AppShellProps {
  topBar: React.ReactNode;
  leftNav: React.ReactNode;
  children: React.ReactNode;
  /**
   * Compact label rendered in the mobile-only top bar next to the
   * hamburger icon. Defaults to "Program Landscape".
   */
  mobileBrandLabel?: string;
  /**
   * Collapse state as the server resolved it from the preference
   * cookie. Rendering from this — rather than reading storage after
   * mount — is what keeps the column the right width on first paint.
   */
  initialVariant?: NavVariant;
  className?: string;
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function AppShell({
  topBar,
  leftNav,
  children,
  mobileBrandLabel = 'Program Landscape',
  initialVariant = NAV_DEFAULT_VARIANT,
  className,
}: AppShellProps) {
  const [variant, setVariant] = React.useState<NavVariant>(initialVariant);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const pathname = usePathname();

  const toggleVariant = React.useCallback(() => {
    setVariant((current) => (current === 'rail' ? 'expanded' : 'rail'));
  }, []);

  // `initialVariant` comes from the RSC payload, which Next may serve from
  // the client router cache — a payload rendered before the last toggle. The
  // cookie was written synchronously by that toggle, so it is newer. Reading
  // it once on mount costs nothing when they agree (the common case) and is
  // the difference between "remembered" and "remembered for 30 seconds".
  React.useEffect(() => {
    const stored = readNavVariantCookie();
    if (stored && stored !== initialVariant) setVariant(stored);
    // mount only — later divergence is this tab's own writes
  }, []);

  // Updaters must stay pure — StrictMode double-invokes them, and a cookie
  // write is a side effect. Persisting here instead also re-stamps max-age
  // on every visit, not just on the visits where the user actually toggles.
  React.useEffect(() => {
    writeNavVariantCookie(variant);
  }, [variant]);

  // `[` collapses / expands. No conflict with the existing registry:
  // ⌘K opens the palette, ⌘/ the dashboard chat, `?` the shortcut sheet.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '[' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      toggleVariant();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleVariant]);

  // Land on the new page without an obstructing overlay.
  React.useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // Growing past the breakpoint reveals the persistent column, so the
  // drawer showing the same nav on top of it is both redundant and a
  // focus trap the user did not ask for.
  React.useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const onChange = () => {
      if (mq.matches) setDrawerOpen(false);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const railed = variant === 'rail';

  return (
    <div
      data-nav={variant}
      className={cn('min-h-screen bg-surface-0 text-text-primary', className)}
    >
      {/* Persistent column — desktop only. `.kku-nav-rail-scope` is what
          scopes every rail rule in tokens.css to this copy of the nav;
          the drawer below renders the same `leftNav` and must stay
          full-width whatever the stored preference is. */}
      <aside
        id={NAV_ELEMENT_ID}
        aria-label="Primary navigation"
        className={cn(
          'kku-nav-rail-scope fixed inset-y-0 left-0 z-30 hidden flex-col md:flex',
          'w-[var(--app-nav-width)] overflow-hidden',
          'transition-[width] duration-slow ease-standard motion-reduce:transition-none',
        )}
      >
        <NavChromeProvider value={{ variant, railed, inDrawer: false }}>
          <div className="min-h-0 flex-1">{leftNav}</div>
        </NavChromeProvider>
        <div
          className={cn(
            'kku-nav-toggle-bar flex shrink-0 items-center justify-end',
            'border-t border-subtle bg-nav-surface px-3 py-2',
          )}
        >
          <button
            type="button"
            onClick={toggleVariant}
            aria-expanded={!railed}
            aria-controls={NAV_ELEMENT_ID}
            aria-label={railed ? 'Expand navigation' : 'Collapse navigation'}
            title={`${railed ? 'Expand' : 'Collapse'} navigation  [`}
            className={cn(
              // 32px hit area — the spacing scale is half-stock, so h-16
              // is 32px. Kept on the scale because it is a button box,
              // not an icon.
              'inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-lg',
              'text-text-tertiary transition-[background-color,color] duration-fast',
              'hover:bg-accent-subtle hover:text-accent-default',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-default',
            )}
          >
            {railed ? (
              <PanelLeftOpen className="size-icon-md" aria-hidden />
            ) : (
              <PanelLeftClose className="size-icon-md" aria-hidden />
            )}
          </button>
        </div>
      </aside>

      <div
        className={cn(
          'flex min-h-screen flex-col',
          'md:pl-[var(--app-nav-width)]',
          'transition-[padding-left] duration-slow ease-standard motion-reduce:transition-none',
        )}
      >
        {/* Mobile bar — the only place the nav can be opened below md. */}
        <div
          className={cn(
            'sticky top-0 z-20 flex h-[var(--app-mobile-bar-h)] items-center gap-3',
            'border-b border-subtle bg-surface-0/95 px-4 backdrop-blur-sm md:hidden',
          )}
        >
          <DialogPrimitive.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
            <DialogPrimitive.Trigger asChild>
              <button
                type="button"
                aria-label="Open navigation menu"
                className={cn(
                  'inline-flex h-20 w-20 shrink-0 items-center justify-center rounded-lg',
                  'text-text-primary hover:bg-surface-2',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-default',
                )}
              >
                <Menu className="size-icon-lg" aria-hidden />
              </button>
            </DialogPrimitive.Trigger>
            <DialogPrimitive.Portal>
              <DialogPrimitive.Overlay
                className={cn(
                  'fixed inset-0 z-40 bg-text-primary/30 backdrop-blur-md',
                  'data-[state=open]:animate-fade-in',
                )}
              />
              <DialogPrimitive.Content
                // Radix gives us role="dialog", the focus trap, Escape and
                // the scroll lock, but this version does NOT emit
                // `aria-modal` — verified in the browser, not assumed. It
                // relies on aria-hidden'ing the siblings instead, which is
                // stronger but leaves the dialog unannounced as modal.
                aria-modal="true"
                aria-describedby={undefined}
                className={cn(
                  // `kku-nav-drawer` carries the left-entry animation —
                  // see tokens.css for why it is not a Tailwind keyframe.
                  'kku-nav-drawer fixed inset-y-0 left-0 z-50 flex w-[min(300px,86vw)] flex-col shadow-2xl',
                )}
              >
                <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
                <NavChromeProvider value={{ variant: 'expanded', railed: false, inDrawer: true }}>
                  {leftNav}
                </NavChromeProvider>
                <DialogPrimitive.Close
                  aria-label="Close navigation menu"
                  className={cn(
                    'absolute right-3 top-4 z-10 inline-flex h-20 w-20 items-center justify-center rounded-full',
                    'bg-surface-1/90 text-text-secondary shadow-sm backdrop-blur-sm',
                    'hover:bg-surface-2 hover:text-text-primary',
                    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-default',
                  )}
                >
                  <X className="size-icon-lg" aria-hidden />
                </DialogPrimitive.Close>
              </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
          </DialogPrimitive.Root>
          <span className="truncate text-sm font-semibold tracking-tight">{mobileBrandLabel}</span>
        </div>

        {topBar}
        <main className="min-w-0 flex-1 px-4 py-6 md:px-10 md:py-10">
          <div className="mx-auto max-w-[1400px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
