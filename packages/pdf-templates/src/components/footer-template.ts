/* eslint-disable no-restricted-syntax --
 * Gotenberg renders the footer in an isolated HTML document that does
 * not inherit the main document's CSS — no tokens available. Hex is
 * the only option. Light-theme only; PDFs never render in dark mode.
 */

// Gotenberg's Chromium header/footer feature uses a minimal HTML document
// with special replacement tokens. THIS FILE MUST NOT IMPORT REACT — the
// footer is rendered by Chromium itself, not by our server.
//
// Replacement tokens Chromium understands:
//   <span class="pageNumber"></span>
//   <span class="totalPages"></span>
//   <span class="date"></span>
//   <span class="title"></span>
//   <span class="url"></span>
//
// These are populated BEFORE the document body renders. If you need
// different fonts, they have to be loaded in the footer's own <style>
// block — the main document's fonts are not available here.

export interface FooterOptions {
  leftLabel: string;      // e.g., "KKU Curriculum Intelligence · Program Landscape — Council Pack"
  rightLabel?: string;    // e.g., "ลับ — สำหรับการประชุมสภาเท่านั้น"
}

export function buildFooterHtml(opts: FooterOptions): string {
  return `<!doctype html>
<html>
  <head>
    <style>
      body { margin: 0; font-family: 'TH Sarabun New', 'Sarabun', sans-serif; font-size: 9pt; color: #555; }
      .wrap { display: flex; justify-content: space-between; width: 100%; padding: 0 15mm; }
      .page-number { font-variant-numeric: tabular-nums; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div>${escape(opts.leftLabel)}</div>
      <div class="page-number">
        <span class="pageNumber"></span> / <span class="totalPages"></span>
      </div>
      <div>${escape(opts.rightLabel ?? '')}</div>
    </div>
  </body>
</html>`;
}

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
