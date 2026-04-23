/* eslint-disable no-restricted-syntax --
 * This module embeds literal hex colours inside a CSS string that
 * ships to Gotenberg/Chromium. CSS custom-property tokens (the usual
 * theme channel) aren't available here — PDFs have no <html> with a
 * data-theme to read off, and they are deliberately light-theme only.
 * Keep these values in sync with the light-mode values of the design
 * tokens in packages/design/src/css/tokens.css.
 */

// Master CSS for every Thai PDF this app emits. Every template includes
// this verbatim (via `${baseCss}` in its style block).
//
// WHY the rules below — don't silently remove them:
//   - `font-size: 16pt` is the Cabinet-mandated body size for official
//     Thai government documents (Cabinet Resolution, 7 September 2010).
//   - `word-break: keep-all` — Thai is written without spaces between
//     words. Default `word-break: normal` makes Chromium break at
//     character boundaries, which is wrong. keep-all lets the Thai
//     line-break algorithm (dictionary-based in modern Chromium) do
//     its job.
//   - `line-height: 1.5+` — Thai has vowels both above and below the
//     consonant line, plus tone marks. Tight line-heights clash.
//   - Always light theme — PDFs end up printed, screenshotted, attached
//     to email; dark PDFs read badly in all those contexts.
//   - `font-variant-numeric: tabular-nums` on tables — Sarabun's default
//     proportional figures make columns jitter.

export const baseCss = `
/* ── Page ───────────────────────────────────────────────────────── */
@page {
  size: A4;
  margin: 20mm 15mm 20mm 15mm;
}

/* ── Root ───────────────────────────────────────────────────────── */
html, body {
  font-family: 'TH Sarabun New', 'Sarabun', 'Noto Sans Thai', sans-serif;
  font-size: 16pt;                 /* Thai government standard */
  line-height: 1.5;                /* room for Thai diacritics */
  color: #111;
  background: #ffffff;             /* PDFs are always light theme */
  margin: 0;
  padding: 0;
  word-break: keep-all;            /* break at word, not char */
  overflow-wrap: break-word;
  text-rendering: optimizeLegibility;
  -webkit-font-feature-settings: "liga", "clig", "calt";
  font-feature-settings: "liga", "clig", "calt";
}

/* English fragments inside a Thai-primary doc (axis labels, code, ids) */
[lang="en"] {
  font-size: 11pt;
  font-family: 'Sarabun', 'Inter', system-ui, sans-serif;
}

/* ── Type scale ─────────────────────────────────────────────────── */
h1 { font-size: 24pt; font-weight: 700; margin: 0 0 12pt 0; }
h2 { font-size: 20pt; font-weight: 700; margin: 16pt 0 8pt 0; }
h3 { font-size: 18pt; font-weight: 700; margin: 12pt 0 6pt 0; }
h4 { font-size: 16pt; font-weight: 700; margin: 8pt 0 4pt 0; }

p  { margin: 0 0 6pt 0; }

small, .caption {
  font-size: 13pt;
  color: #444;
}

strong { font-weight: 700; }
em     { font-style: italic; }

/* ── Tables ─────────────────────────────────────────────────────── */
table {
  width: 100%;
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;
  margin: 8pt 0 12pt 0;
}
th, td {
  padding: 4pt 6pt;
  border-bottom: 0.5pt solid #ddd;
  text-align: left;
  vertical-align: top;
}
th {
  font-weight: 700;
  border-bottom: 1pt solid #333;
  background: #f6f4f0;             /* warm neutral, matches surface-2 */
}
td.numeric, th.numeric {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* ── Print utilities ────────────────────────────────────────────── */
.page-break-before { page-break-before: always; break-before: page; }
.page-break-after  { page-break-after: always;  break-after: page; }
.avoid-break       { page-break-inside: avoid;  break-inside: avoid; }
.no-orphans        { orphans: 3; widows: 3; }

/* ── Semantic accents (light-only; matches design-system tokens) ── */
.accent   { color: #9c1d2e; }       /* KKU Cardinal */
.muted    { color: #555; }
.danger   { color: #b42318; }
.warning  { color: #a15c00; }
.success  { color: #046c4e; }
.info     { color: #2b4ba4; }

.badge {
  display: inline-block;
  padding: 1pt 6pt;
  border-radius: 4pt;
  font-size: 12pt;
  font-weight: 500;
  background: #efecdf;
  color: #2b2b2b;
}
.badge.danger  { background: #fee4e2; color: #91231c; }
.badge.warning { background: #fdf2d8; color: #8a4a00; }
.badge.success { background: #d1f3e4; color: #045c3f; }

/* ── Layout primitives used by the base template shell ───────────── */
.cover-page {
  min-height: 230mm;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  text-align: center;
  page-break-after: always;
}
.cover-page .title-th   { font-size: 32pt; font-weight: 700; margin-bottom: 6pt; }
.cover-page .title-en   { font-size: 16pt; font-weight: 400; color: #444; }
.cover-page .scope      { font-size: 14pt; color: #444; margin-top: 20pt; }
.cover-page .date       { font-size: 14pt; margin-top: 6pt; }
.cover-page .brand-mark { height: 24mm; margin-bottom: 14pt; }

.section { margin: 10pt 0; }
.section > h2:first-child { margin-top: 0; }

.kv-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6pt 14pt;
}
.kv-grid .label { color: #555; font-size: 13pt; }
.kv-grid .value { font-weight: 500; }

/* ── Chart containers ───────────────────────────────────────────── */
.chart-frame {
  margin: 6pt 0 12pt 0;
  page-break-inside: avoid;
}
.chart-frame .chart-title {
  font-weight: 700;
  margin-bottom: 2pt;
}
.chart-frame .chart-caption {
  font-size: 12pt;
  color: #555;
  margin-top: 2pt;
}
`;
