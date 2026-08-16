/* eslint-disable no-restricted-syntax --
 * This module embeds literal hex colours inside a CSS string that
 * ships to Gotenberg/Chromium, same as base-css.ts. CSS custom-property
 * tokens aren't available in a PDF — no <html data-theme> to read off,
 * and PDFs are deliberately light-theme only. Keep these values in
 * sync with the light-mode design tokens (KKU Cardinal, muted greys).
 */

// Magazine layout for the rebuilt program-detail deep-dive PDF.
// Included ALONGSIDE `baseCss` (via `${baseCss}${magazineCss}` in the
// template's style block) — never instead of it. Every rule here is
// additive: section openers, the chart lede, the back-matter appendix,
// pull-quotes and the cover's stat row. The magazine feel comes from
// structure and white space, not from shrinking the Cabinet-mandated
// 16pt body text — this file must never touch `html`/`body` font-size.
//
// Running heads and folios are deliberately NOT here. Chromium doesn't
// support `@page` margin boxes, and Gotenberg renders header/footer as
// separate, isolated HTML documents that inherit neither this CSS nor
// the main document's fonts — see `deep-dive-page-furniture.ts`.
//
// Section and appendix numbering both use CSS counters instead of
// literal numbers typed into JSX, so inserting, removing or reordering
// a section file never requires a manual renumbering pass:
//   - `.section-opener` increments the shared `section` counter once
//     per section, in document order, and prints it as "§04" — this
//     is the number the body ever shows.
//   - An appendix entry cross-references its originating section (the
//     spec's "§04 -> B.4" example). CSS counters cannot look backward
//     to "what was `section` when §04 rendered", so the appendix
//     entry seeds its OWN `appendix-item` counter to that same number
//     via an inline `style="counter-reset: appendix-item 4"` — set at
//     render time by appendix.tsx (a later task), which already knows
//     the section's index. This file only owns the "B." + counter
//     display format; it never hardcodes which number goes where.

export const magazineCss = `
/* ── Section openers ───────────────────────────────────────────── */
.program-body {
  counter-reset: section;
}
.section-opener {
  counter-increment: section;
  display: flex;
  align-items: baseline;
  gap: 12pt;
  margin: 22pt 0 10pt 0;
  padding-bottom: 6pt;
  border-bottom: 1.5pt solid #9c1d2e;
  break-after: avoid;
  page-break-after: avoid;
}
.section-opener::before {
  content: '§' counter(section, decimal-leading-zero);
  flex: none;
  font-size: 34pt;
  font-weight: 700;
  line-height: 1;
  color: #9c1d2e;                  /* KKU Cardinal — the navigation device */
}
.section-opener .section-title {
  font-size: 20pt;
  font-weight: 700;
  line-height: 1.3;
}
.section-opener .section-kicker {
  display: block;
  font-size: 11pt;
  font-weight: 500;
  letter-spacing: 0.5pt;
  text-transform: uppercase;
  color: #555;
}

/* ── Chart lede ─────────────────────────────────────────────────── */
/* The one-sentence Thai lede under a section title. ChartFrame emits
   this class today with an inline style as a stopgap (see
   src/charts/chart-frame.tsx) — this rule is what it was waiting for;
   the inline style and this rule intentionally carry the same values
   so nothing visibly changes the day ChartFrame's inline style is
   deleted. */
.chart-lede {
  font-size: 14pt;
  line-height: 1.6;                /* >= 1.5 for Thai diacritics */
  color: #333;
  max-width: 150mm;
  margin: 2pt 0 8pt 0;
}

/* ── Prose sections (strategic narrative, lifecycle verdict) ──────── */
.magazine-columns {
  column-count: 2;
  column-gap: 10mm;
  column-rule: 0.5pt solid #ddd;
}
.magazine-columns p {
  break-inside: avoid;
  page-break-inside: avoid;
}

.pull-quote {
  font-size: 20pt;
  font-weight: 500;
  line-height: 1.6;
  color: #1a1a1a;
  border-left: 3pt solid #9c1d2e;
  margin: 14pt 0;
  padding: 2pt 0 2pt 16pt;
  break-inside: avoid;
  page-break-inside: avoid;
}
.pull-quote .attribution {
  display: block;
  margin-top: 6pt;
  font-size: 12pt;
  font-weight: 400;
  color: #555;
}

/* ── Cover stat row ─────────────────────────────────────────────── */
.stat-block {
  display: flex;
  justify-content: center;
  gap: 20pt;
  margin: 18pt 0;
}
.stat-block .stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 42mm;
}
.stat-block .stat-value {
  font-size: 28pt;
  font-weight: 700;
  color: #9c1d2e;
  line-height: 1.1;
}
.stat-block .stat-label {
  margin-top: 3pt;
  font-size: 11pt;
  color: #555;
  text-align: center;
}

/* ── Appendix ───────────────────────────────────────────────────── */
.appendix {
  margin-top: 12pt;
}
.appendix-entry {
  counter-increment: appendix-item;
  margin: 0 0 14pt 0;
  break-inside: avoid;
  page-break-inside: avoid;
}
.appendix-entry .appendix-number::before {
  content: 'B.' counter(appendix-item);
  font-weight: 700;
  color: #9c1d2e;
  margin-right: 6pt;
}
.appendix-table {
  font-size: 14pt;
  font-variant-numeric: tabular-nums;
}
.appendix-table th,
.appendix-table td {
  padding: 3pt 5pt;
}
`;
