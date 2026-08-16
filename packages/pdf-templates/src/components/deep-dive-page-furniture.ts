/* eslint-disable no-restricted-syntax --
 * Gotenberg renders the header and footer in isolated HTML documents
 * that do not inherit the main document's CSS — no design tokens
 * available here. Hex is the only option. Light-theme only; PDFs
 * never render in dark mode.
 */

// Page furniture (running head + folio) for the rebuilt program-detail
// deep-dive PDF. THIS FILE MUST NOT IMPORT REACT — Chromium renders
// these documents itself, not our server. Mirrors the mechanism in
// footer-template.ts; read that file's header comment for the full
// rationale.
//
// Replacement tokens Chromium understands, populated BEFORE the body
// renders:
//   <span class="pageNumber"></span>
//   <span class="totalPages"></span>
//   <span class="date"></span>
//   <span class="title"></span>
//   <span class="url"></span>
//
// Fonts must be declared in THIS file's own <style> block — the main
// document's fonts are not available here. Pin 'TH Sarabun New'
// explicitly and do not list bare 'Sarabun' as a fallback: a spike
// established 'Sarabun' is not installed in the Gotenberg image, so a
// fallback stack silently substitutes a different, larger, bolder
// face. 'Noto Sans Thai' IS installed and is the safe fallback.
//
// Gotenberg's header/footer viewport is the page margin box — 20mm
// top/bottom in this template's @page rule (base-css.ts) — and content
// that overflows it is clipped. Keep both to a single line and a
// modest font size.

export interface DeepDivePageFurnitureOptions {
  /** e.g. 'KKU-SEQ-0065' — carried on every page so a sheet photocopied out of context stays attributable. */
  programCode: string;
  programNameEn: string;
  /** Thai, e.g. 'ลับ — สำหรับการประชุมสภาเท่านั้น'. Omit for an unrestricted document. */
  confidentialityLabel?: string;
}

const FONT_STACK = "'TH Sarabun New','Noto Sans Thai',sans-serif";

export function buildDeepDiveHeaderHtml(opts: DeepDivePageFurnitureOptions): string {
  return `<!doctype html>
<html>
  <head>
    <style>
      body { margin: 0; font-family: ${FONT_STACK}; font-size: 9pt; color: #666; }
      .wrap {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        width: 100%;
        padding: 0 15mm;
        border-bottom: 0.5pt solid #ccc;
        box-sizing: border-box;
      }
      .code { font-weight: 700; color: #9c1d2e; white-space: nowrap; }
      .name { text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="code">${escape(opts.programCode)}</div>
      <div class="name">${escape(opts.programNameEn)}</div>
    </div>
  </body>
</html>`;
}

export function buildDeepDiveFooterHtml(opts: DeepDivePageFurnitureOptions): string {
  return `<!doctype html>
<html>
  <head>
    <style>
      body { margin: 0; font-family: ${FONT_STACK}; font-size: 9pt; color: #666; }
      .wrap {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        width: 100%;
        padding: 0 15mm;
        box-sizing: border-box;
      }
      .page-number { font-variant-numeric: tabular-nums; white-space: nowrap; }
      .confidentiality { color: #9c1d2e; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="confidentiality">${escape(opts.confidentialityLabel ?? '')}</div>
      <div class="page-number">
        <span class="pageNumber"></span> / <span class="totalPages"></span>
      </div>
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
