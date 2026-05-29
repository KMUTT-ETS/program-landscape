'use client';

import * as React from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

// Global navigation progress indicator. A thin animated bar pinned to the
// top of the viewport that shows while a route transition is in flight —
// so the user gets immediate "please wait" feedback on slow surfaces
// (Executive Landscape, Portfolio Cockpit, Program Deep-Dive, Risk
// Management, the Education/Staff hubs) AND on same-route filter changes
// that re-fetch from the server (e.g. the /staff/research year-range
// slider).
//
// Why this and not `loading.tsx`: the app shell (sidebar + top bar) is
// rendered per-page, not in a layout, so a route-segment loading fallback
// would render without the chrome and look broken. A fixed bar mounted
// above the shell sidesteps that entirely and works uniformly.
//
// Mechanism: every App-Router client navigation — whether a <Link> click
// or a programmatic router.push from a filter — goes through
// history.pushState. We patch pushState/replaceState (+ popstate) to flip
// the bar ON, then flip it OFF when the committed URL (pathname OR query
// string) changes. A safety timeout hides a stuck bar.

const SAFETY_MS = 15000;
const DONE_MS = 280;

// Filters that navigate via router.push (e.g. the /staff/research year
// slider) can fire this to start the bar at click-time — the App Router
// may otherwise defer history.pushState until the navigation commits,
// which would make the bar barely flash on a slow re-fetch.
const START_EVENT = 'kku:route-progress-start';
export function startRouteProgress(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(START_EVENT));
}

function RouteProgressInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const navKey = `${pathname}?${searchParams.toString()}`;

  const [visible, setVisible] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const firstRender = React.useRef(true);
  const hideTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const safetyTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // START — patch the History API so any client navigation flips the bar
  // on. Restored on unmount (Providers never unmounts in practice, but
  // keep it tidy for fast-refresh).
  React.useEffect(() => {
    const start = () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (safetyTimer.current) clearTimeout(safetyTimer.current);
      setDone(false);
      setVisible(true);
      safetyTimer.current = setTimeout(() => {
        setDone(false);
        setVisible(false);
      }, SAFETY_MS);
    };

    // Intercept internal <a> clicks so the bar starts the instant the
    // user clicks a side-menu link — before the server render begins —
    // rather than waiting for pushState (which the App Router can defer
    // until the navigation commits, making the bar useless on slow pages).
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as HTMLElement | null)?.closest('a');
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href || anchor.hasAttribute('download')) return;
      if (anchor.target && anchor.target !== '_self') return;
      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      // Same URL → no navigation will happen; don't flash the bar.
      if (url.pathname === window.location.pathname && url.search === window.location.search) {
        return;
      }
      start();
    };
    document.addEventListener('click', onClick, true);

    // Programmatic navigations (router.push from a filter) go through the
    // History API — patch it so those flip the bar on too.
    const origPush = history.pushState.bind(history);
    const origReplace = history.replaceState.bind(history);
    history.pushState = (...args: Parameters<History['pushState']>) => {
      start();
      origPush(...args);
    };
    history.replaceState = (...args: Parameters<History['replaceState']>) => {
      start();
      origReplace(...args);
    };
    window.addEventListener('popstate', start);
    window.addEventListener(START_EVENT, start);

    return () => {
      document.removeEventListener('click', onClick, true);
      history.pushState = origPush;
      history.replaceState = origReplace;
      window.removeEventListener('popstate', start);
      window.removeEventListener(START_EVENT, start);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (safetyTimer.current) clearTimeout(safetyTimer.current);
    };
  }, []);

  // FINISH — the committed URL changed, so the new render is in. Snap the
  // bar to full, then fade it out.
  React.useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (safetyTimer.current) clearTimeout(safetyTimer.current);
    setDone(true);
    hideTimer.current = setTimeout(() => {
      setVisible(false);
      setDone(false);
    }, DONE_MS);
  }, [navKey]);

  if (!visible && !done) return null;

  return (
    <div className="route-progress" role="progressbar" aria-label="Loading" aria-hidden>
      <div className={`route-progress__bar${done ? ' route-progress__bar--done' : ''}`} />
    </div>
  );
}

// useSearchParams() must sit under a Suspense boundary so it doesn't
// opt the whole tree out of static rendering.
export function RouteProgress() {
  return (
    <React.Suspense fallback={null}>
      <RouteProgressInner />
    </React.Suspense>
  );
}
