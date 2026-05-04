'use client';

import * as React from 'react';

// PrintButton — visible affordance to trigger the browser's print dialog.
// When the page is opened with `?autoprint=1` (the "Export PDF" entry
// point on the deep-dive header), the dialog fires automatically so the
// user can land directly on "Save as PDF". One-shot via a ref guard so
// React StrictMode's double-render doesn't fire it twice.
export function PrintButton() {
  const fired = React.useRef(false);
  React.useEffect(() => {
    if (fired.current) return;
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('autoprint') === '1') {
      fired.current = true;
      // Tiny delay lets the page paint + fonts settle before Chromium
      // grabs the snapshot. 350ms is conservative but unnoticeable.
      const t = window.setTimeout(() => window.print(), 350);
      return () => window.clearTimeout(t);
    }
  }, []);
  return (
    <button
      onClick={() => window.print()}
      className="rounded border border-border-default bg-surface-0 px-3 py-1 text-sm font-medium hover:bg-surface-2"
    >
      Print / Save as PDF
    </button>
  );
}
