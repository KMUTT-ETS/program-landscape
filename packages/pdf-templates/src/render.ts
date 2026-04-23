import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';

// Turns a React element into an HTML string suitable for Gotenberg's
// Chromium module. We use `renderToStaticMarkup` rather than
// `renderToString` because the output is one-shot (no hydration) — the
// markup has no React data attributes or hydration markers.
export function renderTemplateToHtml(element: ReactElement): string {
  return renderToStaticMarkup(element);
}
