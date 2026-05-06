/* eslint-disable no-restricted-syntax --
 * Inline styles in this file embed literal hex values (cover banner +
 * status pills). The Gotenberg/Chromium pipeline has no CSS custom-
 * property tokens because the rendered HTML has no <html data-theme>;
 * see styles/base-css.ts for the rationale. Light-theme only.
 */

import * as React from 'react';
import type { TemplateDefinition } from '@kku/shared';

import { buildFooterHtml } from '../../components/footer-template';
import { baseCss } from '../../styles/base-css';
import { renderTemplateToHtml } from '../../render';
import {
  ProgramDetailDataSchema,
  type ProgramDetailData,
} from './schema';

const VERSION = '1.0.0';

// ---------------------------------------------------------------------------
// Extra CSS — extends the base CSS with rules specific to the tabular
// detail report (cover band, section spacing, severity pills, dense
// tables with their own type scale so 12+ tables fit on one page).
// ---------------------------------------------------------------------------

const EXTRA_CSS = `
  /* Tighten the body type scale a notch — 16pt is the Cabinet body
     size, but a tabular detail report packs more rows per page at
     14pt with the same legibility. Keep base 16pt for paragraphs. */
  table { font-size: 14pt; }
  table th, table td { padding: 3pt 5pt; }
  table th {
    background: #f3eee2;
    font-size: 13pt;
    text-transform: uppercase;
    letter-spacing: 0.5pt;
    color: #2b2b2b;
    border-bottom: 1pt solid #4a4a4a;
  }
  table.compact th, table.compact td { padding: 2pt 4pt; font-size: 12pt; }
  table tbody tr:nth-child(even) td { background: #fbf8f1; }
  table caption {
    text-align: left;
    font-size: 12pt;
    font-weight: 600;
    color: #555;
    padding: 0 0 4pt 0;
    caption-side: top;
  }
  td.numeric, th.numeric { font-variant-numeric: tabular-nums; }

  /* Cover banner. Stays inside the page margins (negative margins
     get clipped by Chromium's print pipeline at the very top of
     page 1) — the strong KKU-cardinal top rule + gradient gives it
     enough visual weight without needing to bleed off the edge. */
  .cover-banner {
    background: linear-gradient(180deg, #fbf8f1 0%, #ffffff 100%);
    border-top: 4pt solid #9c1d2e;
    border-radius: 2pt;
    padding: 12pt 14pt;
    margin: 0 0 12pt 0;
    page-break-after: avoid;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .cover-banner .doc-kicker {
    font-size: 10pt;
    text-transform: uppercase;
    letter-spacing: 1.2pt;
    color: #555;
    margin-bottom: 4pt;
  }
  .cover-banner .name-th {
    font-size: 22pt;
    font-weight: 700;
    color: #1a1a1a;
    margin: 0;
    line-height: 1.25;
  }
  .cover-banner .name-en {
    font-size: 13pt;
    color: #444;
    margin: 0;
  }
  .cover-banner .meta-row {
    margin-top: 6pt;
    font-size: 12pt;
    color: #444;
  }
  .cover-banner .meta-row .pill { margin-right: 6pt; }

  /* Status pills (program status + severity tags reused inside tables). */
  .pill {
    display: inline-block;
    padding: 1pt 6pt;
    border-radius: 4pt;
    font-size: 11pt;
    font-weight: 600;
    background: #e9e2c9;
    color: #2b2b2b;
    text-transform: uppercase;
    letter-spacing: 0.5pt;
  }
  .pill.success { background: #d1f3e4; color: #045c3f; }
  .pill.warning { background: #fdf2d8; color: #8a4a00; }
  .pill.danger  { background: #fee4e2; color: #91231c; }
  .pill.info    { background: #dde6f7; color: #2b4ba4; }
  .pill.neutral { background: #ebe7d8; color: #555; }

  /* Section headers — denser than the base h2 spec because we have
     ~16 sections in this document. */
  section.detail-section { margin: 10pt 0 8pt 0; page-break-inside: auto; }
  section.detail-section > h2 {
    margin: 0 0 4pt 0;
    font-size: 16pt;
    color: #9c1d2e;
    border-bottom: 1pt solid #9c1d2e;
    padding-bottom: 2pt;
  }
  section.detail-section > .section-sub {
    margin: 0 0 4pt 0;
    font-size: 11pt;
    color: #555;
  }
  section.detail-section > h3 {
    margin: 8pt 0 2pt 0;
    font-size: 13pt;
    text-transform: uppercase;
    letter-spacing: 0.5pt;
    color: #444;
    border-bottom: 0.25pt solid #ccc;
    page-break-after: avoid;
  }

  /* Strategic narrative — markdown content; keep on a fresh page so
     the prose doesn't compete with tables. */
  .narrative-prose h1 { font-size: 16pt; margin: 8pt 0 4pt 0; }
  .narrative-prose h2 { font-size: 14pt; margin: 6pt 0 3pt 0; text-transform: uppercase; letter-spacing: 0.5pt; }
  .narrative-prose h3 { font-size: 13pt; margin: 4pt 0 2pt 0; }
  .narrative-prose p  { margin: 0 0 5pt 0; }
  .narrative-prose ul,
  .narrative-prose ol { margin: 0 0 5pt 18pt; padding: 0; }
  .narrative-prose li { margin: 0 0 2pt 0; }

  /* Inline note paragraph used between tables (caveats, sensitivity
     callout). Light surface so it's visually a footnote, not a row. */
  .inline-note {
    background: #f9f6ec;
    border-left: 2pt solid #9c1d2e;
    padding: 4pt 8pt;
    margin: 4pt 0 8pt 0;
    font-size: 12pt;
    color: #444;
  }

  /* Empty-state row inside a table. */
  .empty-row td {
    text-align: center;
    color: #888;
    font-style: italic;
    padding: 8pt 0;
  }

  /* ── Inline visualizations (CSS-only, PDF-safe) ───────────────── */

  /* Wrapper used to keep a chart on the same page as its caption. */
  .viz {
    page-break-inside: avoid;
    break-inside: avoid;
    margin: 4pt 0 8pt 0;
  }
  .viz-caption {
    font-size: 11pt;
    color: #666;
    margin-bottom: 3pt;
  }

  /* Horizontal bar list — one row per item. Used for health dims,
     faculty ranks, financial waterfall, demographic decline, etc. */
  .hbar {
    display: grid;
    grid-template-columns: 26% 1fr 14%;
    column-gap: 8pt;
    align-items: center;
    font-size: 11pt;
    margin: 1pt 0;
    line-height: 1.2;
  }
  .hbar .hbar-label { color: #333; }
  .hbar .hbar-track {
    position: relative;
    height: 11pt;
    background: #efe9da;
    border-radius: 2pt;
    overflow: hidden;
  }
  .hbar .hbar-fill {
    height: 100%;
    background: #2b4ba4;
  }
  .hbar .hbar-fill.success  { background: #069c6a; }
  .hbar .hbar-fill.info     { background: #2b4ba4; }
  .hbar .hbar-fill.warning  { background: #d49000; }
  .hbar .hbar-fill.danger   { background: #c93b30; }
  .hbar .hbar-fill.neutral  { background: #888; }
  .hbar .hbar-fill.muted    { background: #c4bfa9; }
  .hbar .hbar-value {
    text-align: right;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    color: #222;
  }

  /* Vertical bar chart — one bar per period. Used for cohort entry
     years, salary trajectory, demographic projection. */
  .vbar-wrap { padding: 4pt 0 2pt 0; }
  .vbar-row {
    display: flex;
    align-items: flex-end;
    gap: 4pt;
    height: 70pt;
    border-bottom: 0.5pt solid #ccc;
    padding: 0 2pt;
  }
  .vbar-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    gap: 1pt;
    min-width: 0;
  }
  .vbar-val {
    font-size: 9pt;
    color: #555;
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }
  .vbar-bar {
    width: 100%;
    background: #2b4ba4;
    min-height: 1pt;
    border-radius: 1pt 1pt 0 0;
  }
  .vbar-bar.success { background: #069c6a; }
  .vbar-bar.warning { background: #d49000; }
  .vbar-bar.muted   { background: #c4bfa9; }
  .vbar-axis-row {
    display: flex;
    gap: 4pt;
    padding: 2pt 2pt 0 2pt;
    font-size: 9pt;
    color: #666;
  }
  .vbar-axis-label {
    flex: 1;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  /* Stacked horizontal bar — used for skill composition vs AI. */
  .stack-bar {
    display: flex;
    height: 14pt;
    border-radius: 2pt;
    overflow: hidden;
    margin: 2pt 0;
  }
  .stack-seg {
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 9pt;
    color: #fff;
    font-weight: 600;
  }
  .stack-seg.s1 { background: #069c6a; }
  .stack-seg.s2 { background: #2b4ba4; }
  .stack-seg.s3 { background: #999; }
  .stack-seg.s4 { background: #d49000; }
  .stack-legend {
    font-size: 10pt;
    color: #555;
    display: flex;
    flex-wrap: wrap;
    gap: 8pt;
    margin-top: 3pt;
  }
  .stack-legend .swatch {
    display: inline-block;
    width: 8pt;
    height: 8pt;
    margin-right: 3pt;
    vertical-align: middle;
    border-radius: 1pt;
  }

  /* Lifecycle trajectory spectrum — 4 bands + position marker. */
  .spectrum {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr 1fr;
    height: 14pt;
    border-radius: 2pt;
    overflow: hidden;
    margin: 4pt 0 2pt 0;
  }
  .spectrum-band {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 9pt;
    text-transform: uppercase;
    letter-spacing: 0.3pt;
    color: #555;
  }
  .spectrum-band.sunset   { background: #fbe5d9; color: #8a3500; }
  .spectrum-band.stable   { background: #ece5cf; color: #555; }
  .spectrum-band.rising   { background: #cfe1ff; color: #1a3d99; }
  .spectrum-band.frontier { background: #cfeede; color: #045c3f; }
  .spectrum-band.active   { font-weight: 700; }
  .spectrum-marker-row {
    position: relative;
    height: 8pt;
    margin-bottom: 4pt;
  }
  .spectrum-marker {
    position: absolute;
    top: -1pt;
    transform: translateX(-50%);
    color: #9c1d2e;
    font-size: 12pt;
    line-height: 1;
  }
  .spectrum-axis {
    display: flex;
    justify-content: space-between;
    font-size: 9pt;
    color: #888;
    font-variant-numeric: tabular-nums;
  }

  /* Big-number gauge — one headline number with a status-coloured
     progress bar underneath. Used for AI readiness overall. */
  .gauge {
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: 14pt;
    align-items: center;
    padding: 6pt 10pt;
    background: #f9f6ec;
    border-left: 3pt solid #9c1d2e;
    border-radius: 2pt;
    margin: 4pt 0 6pt 0;
  }
  .gauge-num {
    font-size: 28pt;
    font-weight: 700;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }
  .gauge-num.success { color: #045c3f; }
  .gauge-num.info    { color: #1a3d99; }
  .gauge-num.warning { color: #8a4a00; }
  .gauge-num.danger  { color: #91231c; }
  .gauge-meta { display: flex; flex-direction: column; gap: 3pt; }
  .gauge-track {
    height: 8pt;
    background: #ece5cf;
    border-radius: 2pt;
    overflow: hidden;
  }
  .gauge-fill { height: 100%; }
  .gauge-fill.success { background: #069c6a; }
  .gauge-fill.info    { background: #2b4ba4; }
  .gauge-fill.warning { background: #d49000; }
  .gauge-fill.danger  { background: #c93b30; }
  .gauge-label {
    font-size: 11pt;
    color: #444;
  }
`;

// ---------------------------------------------------------------------------
// Helpers — minimal markdown renderer (paragraphs, headings, lists,
// bold, italic). Avoids pulling react-markdown into the SSR pipeline.
// ---------------------------------------------------------------------------

interface MdNode {
  tag: 'p' | 'h2' | 'h3' | 'ul' | 'ol' | 'li';
  html: string;
  children?: MdNode[];
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function inlineFmt(text: string): string {
  // Bold (**x**) → <strong>; italic (*x*) → <em>. Run on already
  // HTML-escaped input so these markers survive.
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(?:^|\s)\*([^*\n]+?)\*(?=\s|$|[.,;:!?])/g, (m, g) =>
      m.startsWith(' ') ? ` <em>${g}</em>` : `<em>${g}</em>`,
    );
}

function renderMarkdownInline(md: string): string {
  // Block parse — split on blank lines, classify each block.
  const blocks = md.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const parts: string[] = [];
  for (const block of blocks) {
    if (/^#{1,3}\s/.test(block)) {
      const m = /^(#{1,3})\s+(.*)$/m.exec(block);
      if (m) {
        const level = m[1]!.length;
        const tag = level === 1 ? 'h2' : level === 2 ? 'h2' : 'h3';
        parts.push(`<${tag}>${inlineFmt(m[2]!.trim())}</${tag}>`);
        continue;
      }
    }
    if (/^\s*[-*]\s/.test(block)) {
      const items = block
        .split(/\n/)
        .map((l) => l.trim())
        .filter((l) => /^[-*]\s/.test(l))
        .map((l) => `<li>${inlineFmt(l.replace(/^[-*]\s+/, ''))}</li>`)
        .join('');
      parts.push(`<ul>${items}</ul>`);
      continue;
    }
    if (/^\d+\.\s/.test(block)) {
      const items = block
        .split(/\n/)
        .map((l) => l.trim())
        .filter((l) => /^\d+\.\s/.test(l))
        .map((l) => `<li>${inlineFmt(l.replace(/^\d+\.\s+/, ''))}</li>`)
        .join('');
      parts.push(`<ol>${items}</ol>`);
      continue;
    }
    parts.push(`<p>${inlineFmt(block)}</p>`);
  }
  return parts.join('\n');
}

// Empty-row helper — used when a section is non-null but has no rows.
function emptyRow(colSpan: number, label: string) {
  return (
    <tr className="empty-row">
      <td colSpan={colSpan}>{label}</td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Inline visualisations.
//   - All CSS-only (no JS, no canvas).
//   - All width/height in absolute units so Chromium's print pipeline
//     reproduces them exactly.
//   - Tone classes match severityClass: success / info / warning /
//     danger / neutral.
// ---------------------------------------------------------------------------

interface HBarRow {
  label: string;
  /** 0..1 fraction of bar fill. */
  pct: number;
  value: string;
  tone?: 'success' | 'info' | 'warning' | 'danger' | 'neutral' | 'muted';
}

function HBars({ rows, caption }: { rows: HBarRow[]; caption?: string }) {
  if (rows.length === 0) return null;
  return (
    <div className="viz">
      {caption && <div className="viz-caption">{caption}</div>}
      {rows.map((r, i) => (
        <div className="hbar" key={i}>
          <span className="hbar-label">{r.label}</span>
          <div className="hbar-track">
            <div
              className={`hbar-fill ${r.tone ?? 'info'}`}
              style={{
                width: `${Math.max(0, Math.min(100, r.pct * 100))}%`,
              }}
            />
          </div>
          <span className="hbar-value">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

interface VBarRow {
  /** Axis label below each bar. */
  axis: string;
  /** Headline number above each bar. */
  value: string;
  /** 0..1 fraction of bar fill. */
  pct: number;
  tone?: 'info' | 'success' | 'warning' | 'muted';
}

function VBars({ rows, caption }: { rows: VBarRow[]; caption?: string }) {
  if (rows.length === 0) return null;
  return (
    <div className="viz vbar-wrap">
      {caption && <div className="viz-caption">{caption}</div>}
      <div className="vbar-row">
        {rows.map((r, i) => (
          <div className="vbar-col" key={i}>
            <span className="vbar-val">{r.value}</span>
            <div
              className={`vbar-bar ${r.tone ?? 'info'}`}
              style={{
                height: `${Math.max(2, Math.min(100, r.pct * 100))}%`,
              }}
            />
          </div>
        ))}
      </div>
      <div className="vbar-axis-row">
        {rows.map((r, i) => (
          <span key={i} className="vbar-axis-label">
            {r.axis}
          </span>
        ))}
      </div>
    </div>
  );
}

interface StackSeg {
  label: string;
  count: number;
  variant: 's1' | 's2' | 's3' | 's4';
  color: string;
}

function StackBar({ segments }: { segments: StackSeg[] }) {
  const total = segments.reduce((s, x) => s + x.count, 0);
  if (total === 0) return null;
  return (
    <div className="viz">
      <div className="stack-bar">
        {segments.map((s, i) => {
          const pct = (s.count / total) * 100;
          return pct > 0 ? (
            <div
              key={i}
              className={`stack-seg ${s.variant}`}
              style={{ flexBasis: `${pct}%` }}
            >
              {pct >= 8 ? `${pct.toFixed(0)}%` : ''}
            </div>
          ) : null;
        })}
      </div>
      <div className="stack-legend">
        {segments.map((s, i) => (
          <span key={i}>
            <span className="swatch" style={{ background: s.color }} />
            {s.label} · {s.count} (
            {((s.count / total) * 100).toFixed(0)}%)
          </span>
        ))}
      </div>
    </div>
  );
}

function LifecycleSpectrum({
  verdict,
  trajectoryScore,
}: {
  verdict: string;
  trajectoryScore: number;
}) {
  const v = verdict.toUpperCase();
  const markerPct = Math.max(0, Math.min(100, trajectoryScore));
  return (
    <div className="viz">
      <div className="spectrum-marker-row">
        <span
          className="spectrum-marker"
          style={{ left: `${markerPct}%` }}
        >
          ▼
        </span>
      </div>
      <div className="spectrum">
        <div
          className={`spectrum-band sunset${v === 'SUNSET' ? ' active' : ''}`}
        >
          Sunset
        </div>
        <div
          className={`spectrum-band stable${v === 'STABLE' ? ' active' : ''}`}
        >
          Stable
        </div>
        <div
          className={`spectrum-band rising${v === 'RISING' ? ' active' : ''}`}
        >
          Rising
        </div>
        <div
          className={`spectrum-band frontier${v === 'FRONTIER' ? ' active' : ''}`}
        >
          Frontier
        </div>
      </div>
      <div className="spectrum-axis">
        <span>0</span>
        <span>45</span>
        <span>65</span>
        <span>80</span>
        <span>100</span>
      </div>
    </div>
  );
}

function Gauge({
  score,
  label,
  tone,
}: {
  score: number;
  label: string;
  tone: 'success' | 'info' | 'warning' | 'danger';
}) {
  const pct = Math.max(0, Math.min(100, score));
  return (
    <div className="gauge">
      <div className={`gauge-num ${tone}`}>{Math.round(score)}</div>
      <div className="gauge-meta">
        <div className="gauge-label">{label} · score out of 100</div>
        <div className="gauge-track">
          <div
            className={`gauge-fill ${tone}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function scoreTone(score: number): 'success' | 'info' | 'warning' | 'danger' {
  if (score >= 70) return 'success';
  if (score >= 45) return 'info';
  if (score >= 20) return 'warning';
  return 'danger';
}

function parseScoreLike(s: string): number | null {
  // "65", "65 / 100", "—", "65.5%", "2,500,000", "−123,456 THB" → number.
  // Accepts ASCII hyphen and Unicode minus (U+2212) as the sign so values
  // formatted via toLocaleString round-trip correctly.
  if (!s) return null;
  const m = /[-−]?\d[\d,]*(?:\.\d+)?/.exec(s);
  if (!m) return null;
  const cleaned = m[0].replace(/−/, '-').replace(/,/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// Severity pill class lookup.
function severityClass(severity: string): string {
  const s = severity.toLowerCase();
  if (s === 'major' || s === 'high' || s === 'take action' || s === 'high impact') {
    return 'pill danger';
  }
  if (s === 'moderate' || s === 'medium' || s === 'monitor') return 'pill warning';
  if (s === 'low' || s === 'minor' || s === 'ignore for now') return 'pill neutral';
  return 'pill';
}

function statusPillClass(status: string): string {
  const s = status.toLowerCase();
  if (s === 'active' || s === 'frontier' || s === 'rising') return 'pill success';
  if (s === 'paused' || s === 'stable') return 'pill neutral';
  if (s === 'sunset') return 'pill danger';
  return 'pill';
}

// ---------------------------------------------------------------------------
// Cover banner.
// ---------------------------------------------------------------------------

function CoverBanner({ data }: { data: ProgramDetailData }) {
  return (
    <header className="cover-banner avoid-break">
      <div className="doc-kicker">
        KKU Curriculum Compass · ทักษทัศน์ — Program detail report (internal)
      </div>
      <h1 className="name-th">{data.nameTh}</h1>
      <p className="name-en" lang="en">
        {data.nameEn} · {data.programCode}
      </p>
      <div className="meta-row">
        <span className={`pill ${statusPillClass(data.status)}`}>{data.status}</span>
        <span className="pill neutral">{data.level}</span>
        {data.yearEstablished && (
          <span style={{ color: '#666' }}>est. {data.yearEstablished} · </span>
        )}
        <span>
          {data.facultyTh} ({data.facultyEn})
          {data.departmentTh && (
            <>
              {' '}
              · {data.departmentTh} ({data.departmentEn})
            </>
          )}
        </span>
      </div>
      <div className="meta-row" style={{ fontSize: '10pt', color: '#666' }}>
        Report generated: {data.generatedAtLabel} · Methodology {data.methodologyVersion} ·{' '}
        Reference date: {data.dateLabel}
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Detail section shell.
// ---------------------------------------------------------------------------

function DetailSection({
  num,
  title,
  subtitle,
  children,
  breakBefore = false,
}: {
  num: number;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  breakBefore?: boolean;
}) {
  return (
    <section
      className={`detail-section${breakBefore ? ' page-break-before' : ''}`}
    >
      <h2>
        {num}. {title}
      </h2>
      {subtitle && <p className="section-sub">{subtitle}</p>}
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Table primitives. Every section uses these so the layout stays uniform.
// ---------------------------------------------------------------------------

function KvTable({
  headers = ['Metric', 'Value', 'Notes'],
  rows,
  emptyLabel = 'No data',
}: {
  headers?: [string, string, string];
  rows: Array<{ metric: string; value: string; notes: string }>;
  emptyLabel?: string;
}) {
  return (
    <table>
      <thead>
        <tr>
          <th style={{ width: '32%' }}>{headers[0]}</th>
          <th style={{ width: '28%' }}>{headers[1]}</th>
          <th>{headers[2]}</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0
          ? emptyRow(3, emptyLabel)
          : rows.map((r, i) => (
              <tr key={i}>
                <td>{r.metric}</td>
                <td className="numeric">{r.value}</td>
                <td>{r.notes}</td>
              </tr>
            ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// The full document.
// ---------------------------------------------------------------------------

function ProgramDetailDoc({ data }: { data: ProgramDetailData }) {
  return (
    <>
      <CoverBanner data={data} />

      {/* 1. Executive snapshot */}
      <DetailSection num={1} title="Executive snapshot">
        <KvTable rows={data.executiveSnapshot} />
      </DetailSection>

      {/* 2. Health score */}
      <DetailSection
        num={2}
        title="Health score"
        subtitle={
          data.healthMethodologyVersion
            ? `Methodology ${data.healthMethodologyVersion}. Equal-weight composite. Missing data is excluded — never substituted with zero.`
            : undefined
        }
      >
        <h3>2.1 Score by dimension</h3>
        <HBars
          rows={data.healthDimensions.map((d) => {
            const n = parseScoreLike(d.score);
            return {
              label: d.dimension,
              pct: n === null ? 0 : n / 100,
              value: d.score === '—' ? '—' : `${d.score} / 100`,
              tone:
                n === null
                  ? 'muted'
                  : n >= 65
                    ? 'success'
                    : n >= 40
                      ? 'info'
                      : 'warning',
            };
          })}
        />
        <table>
          <thead>
            <tr>
              <th>Dimension</th>
              <th className="numeric">Score</th>
              <th className="numeric">Data completeness</th>
              <th>Top driver</th>
            </tr>
          </thead>
          <tbody>
            {data.healthDimensions.length === 0
              ? emptyRow(4, 'No health data')
              : data.healthDimensions.map((d, i) => (
                  <tr key={i}>
                    <td>{d.dimension}</td>
                    <td className="numeric">{d.score}</td>
                    <td className="numeric">{d.dataCompleteness}</td>
                    <td>{d.topDriver}</td>
                  </tr>
                ))}
          </tbody>
        </table>

        <h3>2.2 Driver detail</h3>
        <table className="compact">
          <thead>
            <tr>
              <th style={{ width: '24%' }}>Dimension</th>
              <th>Driver</th>
              <th className="numeric">Score</th>
            </tr>
          </thead>
          <tbody>
            {data.healthDrivers.length === 0
              ? emptyRow(3, 'No driver data')
              : data.healthDrivers.map((d, i) => (
                  <tr key={i}>
                    <td>{d.dimension}</td>
                    <td>{d.driver}</td>
                    <td className="numeric">{d.value}</td>
                  </tr>
                ))}
          </tbody>
        </table>
      </DetailSection>

      {/* 3. Lifecycle verdict */}
      {data.lifecycle && (
        <DetailSection
          num={3}
          title="Lifecycle verdict"
          subtitle={`Methodology ${data.lifecycle.methodologyVersion}. Trajectory score is a weighted blend of overall health, growth signals, and demographic resilience.`}
        >
          <LifecycleSpectrum
            verdict={data.lifecycle.verdict}
            trajectoryScore={parseScoreLike(data.lifecycle.trajectoryScore) ?? 0}
          />
          <KvTable
            headers={['Field', 'Value', 'Notes']}
            rows={[
              { metric: 'Verdict', value: data.lifecycle.verdict, notes: '' },
              {
                metric: 'Trajectory score',
                value: `${data.lifecycle.trajectoryScore} / 100`,
                notes: '',
              },
              {
                metric: 'Methodology version',
                value: data.lifecycle.methodologyVersion,
                notes: '',
              },
              {
                metric: 'Generated',
                value: data.lifecycle.generatedAt,
                notes: '',
              },
            ]}
          />

          {data.lifecycle.narrative && (
            <p className="inline-note">{data.lifecycle.narrative}</p>
          )}

          <h3>3.1 Lifting and drag forces</h3>
          <table>
            <thead>
              <tr>
                <th>Direction</th>
                <th>Driver</th>
                <th className="numeric">Contribution</th>
              </tr>
            </thead>
            <tbody>
              {data.lifecycle.drivers.length === 0
                ? emptyRow(3, 'No drivers reported')
                : data.lifecycle.drivers.map((d, i) => (
                    <tr key={i}>
                      <td>
                        <span
                          className={
                            d.direction === 'lifting'
                              ? 'pill success'
                              : 'pill warning'
                          }
                        >
                          {d.direction}
                        </span>
                      </td>
                      <td>{d.label}</td>
                      <td className="numeric">{d.contribution}</td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </DetailSection>
      )}

      {/* 4. Strategic narrative */}
      {data.strategicNarrative && (
        <DetailSection
          num={4}
          title="Strategic narrative"
          subtitle={`AI-authored · ${data.strategicNarrative.methodVersion} · confidence ${data.strategicNarrative.confidencePct} · generated ${data.strategicNarrative.generatedAt}`}
        >
          <article
            className="narrative-prose"
            dangerouslySetInnerHTML={{
              __html: renderMarkdownInline(
                data.strategicNarrative.contentMarkdown,
              ),
            }}
          />
        </DetailSection>
      )}

      {/* 5. AI readiness */}
      {data.aiReadiness && (
        <DetailSection
          num={5}
          title="AI readiness"
          subtitle={`Methodology ${data.aiReadiness.methodologyVersion}. Composite of curriculum integration, skill resilience, AI research presence, and pedagogical readiness.`}
          breakBefore
        >
          <Gauge
            score={parseScoreLike(data.aiReadiness.overallScore) ?? 0}
            label={data.aiReadiness.verdict}
            tone={scoreTone(parseScoreLike(data.aiReadiness.overallScore) ?? 0)}
          />

          {data.aiReadiness.summary && (
            <p className="inline-note">{data.aiReadiness.summary}</p>
          )}

          <h3>5.1 Sub-scores</h3>
          <HBars
            rows={data.aiReadiness.subScores.map((s) => {
              const n = parseScoreLike(s.value);
              return {
                label: s.metric,
                pct: n === null ? 0 : n / 100,
                value: n === null ? 'no data' : `${Math.round(n)} / 100`,
                tone:
                  n === null
                    ? 'muted'
                    : n >= 65
                      ? 'success'
                      : n >= 40
                        ? 'info'
                        : 'warning',
              };
            })}
          />

          <h3>5.2 Skill composition (vs AI exposure)</h3>
          {data.aiReadiness.skillBreakdown.length > 0 && (() => {
            const SEG_TONE: Record<string, { v: 's1' | 's2' | 's3' | 's4'; color: string }> = {
              'AI-native':       { v: 's1', color: '#069c6a' },
              'AI-augmented':    { v: 's2', color: '#2b4ba4' },
              'Neutral':         { v: 's3', color: '#999' },
              'AI-displaceable': { v: 's4', color: '#d49000' },
            };
            return (
              <StackBar
                segments={data.aiReadiness.skillBreakdown.map((r) => {
                  const tone = SEG_TONE[r.category] ?? { v: 's3' as const, color: '#999' };
                  return {
                    label: r.category,
                    count: Number((r.count ?? '0').replace(/[^\d]/g, '')) || 0,
                    variant: tone.v,
                    color: tone.color,
                  };
                })}
              />
            );
          })()}
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th className="numeric">Skills</th>
                <th className="numeric">Share</th>
              </tr>
            </thead>
            <tbody>
              {data.aiReadiness.skillBreakdown.length === 0
                ? emptyRow(3, 'No skills classified')
                : data.aiReadiness.skillBreakdown.map((r, i) => (
                    <tr key={i}>
                      <td>{r.category}</td>
                      <td className="numeric">{r.count}</td>
                      <td className="numeric">{r.share}</td>
                    </tr>
                  ))}
            </tbody>
          </table>

          <h3>5.3 AI-readiness gaps</h3>
          <table>
            <thead>
              <tr>
                <th style={{ width: '24%' }}>Topic</th>
                <th style={{ width: '12%' }}>Severity</th>
                <th>Observation</th>
                <th style={{ width: '20%' }}>Peer reference</th>
              </tr>
            </thead>
            <tbody>
              {data.aiReadiness.gaps.length === 0
                ? emptyRow(4, 'No gaps reported')
                : data.aiReadiness.gaps.map((g, i) => (
                    <tr key={i}>
                      <td>{g.topic}</td>
                      <td>
                        <span className={severityClass(g.severity)}>
                          {g.severity}
                        </span>
                      </td>
                      <td>{g.observation}</td>
                      <td>{g.peerReference}</td>
                    </tr>
                  ))}
            </tbody>
          </table>

          <h3>5.4 Recommendations</h3>
          <table>
            <thead>
              <tr>
                <th style={{ width: '10%' }}>Priority</th>
                <th style={{ width: '24%' }}>Title</th>
                <th>Detail</th>
                <th style={{ width: '16%' }}>Effort horizon</th>
              </tr>
            </thead>
            <tbody>
              {data.aiReadiness.recommendations.length === 0
                ? emptyRow(4, 'No recommendations reported')
                : data.aiReadiness.recommendations.map((r, i) => (
                    <tr key={i}>
                      <td>
                        <span className={severityClass(r.priority)}>
                          {r.priority}
                        </span>
                      </td>
                      <td>{r.title}</td>
                      <td>{r.detail}</td>
                      <td>{r.effortHorizon}</td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </DetailSection>
      )}

      {/* 6. Demand funnel — cohort lifecycle */}
      {data.demandFunnel && (
        <DetailSection
          num={6}
          title="Demand funnel — cohort lifecycle (admit → graduate → exit)"
          subtitle={`Anchor cohort: ${data.demandFunnel.anchorEntryYearLabel} · ${data.demandFunnel.cohortStatus} · ${data.demandFunnel.programDurationYears}-year program · methodology ${data.demandFunnel.methodologyVersion}`}
        >
          <h3>6.1 Funnel stages</h3>
          {(() => {
            const nums = data.demandFunnel.stages.map((s) => parseScoreLike(s.value) ?? 0);
            const max = Math.max(...nums, 1);
            return (
              <HBars
                rows={data.demandFunnel.stages.map((s, i) => ({
                  label: s.stage,
                  pct: (nums[i] ?? 0) / max,
                  value: s.value,
                  tone: 'info',
                }))}
              />
            );
          })()}
          <table>
            <thead>
              <tr>
                <th>Stage</th>
                <th className="numeric">Value</th>
              </tr>
            </thead>
            <tbody>
              {data.demandFunnel.stages.length === 0
                ? emptyRow(2, 'No stage data')
                : data.demandFunnel.stages.map((s, i) => (
                    <tr key={i}>
                      <td>{s.stage}</td>
                      <td className="numeric">{s.value}</td>
                    </tr>
                  ))}
            </tbody>
          </table>

          <h3>6.2 Stage conversion rates</h3>
          <table>
            <thead>
              <tr>
                <th>From</th>
                <th>To</th>
                <th className="numeric">Conversion rate</th>
              </tr>
            </thead>
            <tbody>
              {data.demandFunnel.conversions.length === 0
                ? emptyRow(3, 'No conversion data')
                : data.demandFunnel.conversions.map((c, i) => (
                    <tr key={i}>
                      <td>{c.from}</td>
                      <td>{c.to}</td>
                      <td className="numeric">{c.rate}</td>
                    </tr>
                  ))}
            </tbody>
          </table>

          {data.demandFunnel.alumniBreakdown.length > 0 && (
            <>
              <h3>6.3 Alumni outcome buckets</h3>
              <table>
                <thead>
                  <tr>
                    <th>Bucket</th>
                    <th className="numeric">Count</th>
                    <th className="numeric">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {data.demandFunnel.alumniBreakdown.map((b, i) => (
                    <tr key={i}>
                      <td>{b.bucket}</td>
                      <td className="numeric">{b.count}</td>
                      <td className="numeric">{b.share}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {data.demandFunnel.cohortTrend.length > 0 && (
            <>
              <h3>6.4 Cohort trend</h3>
              <table>
                <thead>
                  <tr>
                    <th>Cohort BE</th>
                    <th className="numeric">Admitted</th>
                    <th className="numeric">Enrolled</th>
                    <th className="numeric">Graduated</th>
                    <th className="numeric">Dropped</th>
                    <th>Lifecycle</th>
                  </tr>
                </thead>
                <tbody>
                  {data.demandFunnel.cohortTrend.map((c, i) => (
                    <tr key={i}>
                      <td>{c.cohortBE}</td>
                      <td className="numeric">{c.admitted}</td>
                      <td className="numeric">{c.enrolled}</td>
                      <td className="numeric">{c.graduated}</td>
                      <td className="numeric">{c.dropped}</td>
                      <td>{c.completed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </DetailSection>
      )}

      {/* 7. Recruitment funnel — TCAS rounds 1–4 */}
      {data.recruitment && data.recruitment.byYear.length > 0 && (
        <DetailSection
          num={7}
          title="Recruitment funnel — TCAS rounds 1–4"
          subtitle={`POWERBI.ADMISSION_STAT_CURRID via kku-tcas-funnel · ${data.recruitment.methodologyVersion}${
            data.recruitment.inProgressNote ? ` · ${data.recruitment.inProgressNote}` : ''
          }`}
        >
          <h3>7.1 Year-over-year intake</h3>
          <table>
            <thead>
              <tr>
                <th>Year</th>
                <th>Status</th>
                <th className="numeric">Plan/yr</th>
                <th className="numeric">Allocated</th>
                <th className="numeric">Over-alloc</th>
                <th className="numeric">Applicants</th>
                <th className="numeric">Comp.</th>
                <th className="numeric">Passed</th>
                <th className="numeric">Confirm CH</th>
                <th className="numeric">Reported</th>
                <th className="numeric">vs Plan</th>
              </tr>
            </thead>
            <tbody>
              {data.recruitment.byYear.map((y, i) => (
                <tr key={i}>
                  <td>{y.yearBE}</td>
                  <td>{y.status}</td>
                  <td className="numeric">{y.planPerYear}</td>
                  <td className="numeric">{y.seats}</td>
                  <td className="numeric">{y.overAllocation}</td>
                  <td className="numeric">{y.applicants}</td>
                  <td className="numeric">{y.competition}</td>
                  <td className="numeric">{y.passed}</td>
                  <td className="numeric">{y.confirmCh}</td>
                  <td className="numeric">{y.reported}</td>
                  <td className="numeric">{y.vsPlan}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {data.recruitment.latestRounds.length > 0 && (
            <>
              <h3>7.2 Per-round breakdown · {data.recruitment.latestRoundsYear}</h3>
              <table className="compact">
                <thead>
                  <tr>
                    <th>Round</th>
                    <th className="numeric">Allocated</th>
                    <th className="numeric">Applicants</th>
                    <th className="numeric">Passed</th>
                    <th className="numeric">Confirm CH</th>
                    <th className="numeric">Reported</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recruitment.latestRounds.map((r, i) => (
                    <tr key={i}>
                      <td>{r.round}</td>
                      <td className="numeric">{r.seats}</td>
                      <td className="numeric">{r.applicants}</td>
                      <td className="numeric">{r.passed}</td>
                      <td className="numeric">{r.confirmCh}</td>
                      <td className="numeric">{r.reported}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </DetailSection>
      )}

      {/* 8. TCAS3 round-3 score detail & peer comparison */}
      {data.tcas && (
        <DetailSection
          num={8}
          title="TCAS3 round-3 score detail & peer comparison"
          subtitle={
            data.tcas.peerMatchKey
              ? `Peer match key: ${data.tcas.peerMatchKey}`
              : undefined
          }
        >
          <h3>8.1 Year-over-year history</h3>
          <table>
            <thead>
              <tr>
                <th>Year · Round</th>
                <th className="numeric">Quota</th>
                <th className="numeric">Applicants</th>
                <th className="numeric">Competition</th>
                <th className="numeric">Fill rate</th>
                <th className="numeric">Min score</th>
                <th className="numeric">Max score</th>
              </tr>
            </thead>
            <tbody>
              {data.tcas.history.length === 0
                ? emptyRow(7, 'No TCAS3 history')
                : data.tcas.history.map((h, i) => (
                    <tr key={i}>
                      <td>{h.yearRound}</td>
                      <td className="numeric">{h.quota}</td>
                      <td className="numeric">{h.applicants}</td>
                      <td className="numeric">{h.competition}</td>
                      <td className="numeric">{h.fillRate}</td>
                      <td className="numeric">{h.minScore}</td>
                      <td className="numeric">{h.maxScore}</td>
                    </tr>
                  ))}
            </tbody>
          </table>

          {data.tcas.peers.length > 0 && (
            <>
              <h3>8.2 Peer programs · same subject</h3>
              <table className="compact">
                <thead>
                  <tr>
                    <th>Match</th>
                    <th>Institution</th>
                    <th>Programme</th>
                    <th className="numeric">Quota</th>
                    <th className="numeric">Applicants</th>
                    <th className="numeric">Competition</th>
                    <th className="numeric">Min score</th>
                  </tr>
                </thead>
                <tbody>
                  {data.tcas.peers.map((p, i) => (
                    <tr key={i}>
                      <td>
                        <span
                          className={
                            p.match === 'exact' ? 'pill success' : 'pill info'
                          }
                        >
                          {p.match}
                        </span>
                      </td>
                      <td>{p.institution}</td>
                      <td>{p.programme}</td>
                      <td className="numeric">{p.quota}</td>
                      <td className="numeric">{p.applicants}</td>
                      <td className="numeric">{p.competition}</td>
                      <td className="numeric">{p.minScore}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </DetailSection>
      )}

      {/* 9. Cohort distribution */}
      {data.cohortDistribution && (
        <DetailSection
          num={9}
          title="Cohort distribution"
          subtitle={`${data.cohortDistribution.totalActive} active students · anchored to BE ${data.cohortDistribution.currentAcademicYearBE} · ${data.cohortDistribution.programDurationYears}-year program`}
        >
          {data.cohortDistribution.summary.length > 0 && (
            <>
              <h3>9.1 Status summary</h3>
              <KvTable
                headers={['Status', 'Students', 'Notes']}
                rows={data.cohortDistribution.summary}
              />
            </>
          )}
          <h3>9.2 By entry cohort</h3>
          {(() => {
            const sorted = [...data.cohortDistribution.rows].sort((a, b) =>
              a.cohort.localeCompare(b.cohort),
            );
            const counts = sorted.map((r) => parseScoreLike(r.students) ?? 0);
            const max = Math.max(...counts, 1);
            return (
              <VBars
                rows={sorted.map((r, i) => ({
                  axis: r.cohort.replace(/^BE\s*/, '').replace(/\s*\(CE.*\)$/, ''),
                  value: r.students,
                  pct: (counts[i] ?? 0) / max,
                  tone:
                    r.status === 'Delayed'
                      ? 'warning'
                      : r.status === 'Incoming'
                        ? 'muted'
                        : 'success',
                }))}
              />
            );
          })()}
          <table>
            <thead>
              <tr>
                <th>Cohort</th>
                <th>Year in programme</th>
                <th>Status</th>
                <th className="numeric">Students</th>
                <th className="numeric">Share</th>
              </tr>
            </thead>
            <tbody>
              {data.cohortDistribution.rows.length === 0
                ? emptyRow(5, 'No cohort rows')
                : data.cohortDistribution.rows.map((r, i) => (
                    <tr key={i}>
                      <td>{r.cohort}</td>
                      <td>{r.yearInProgram}</td>
                      <td>
                        <span
                          className={
                            r.status === 'Delayed'
                              ? 'pill warning'
                              : r.status === 'Incoming'
                                ? 'pill info'
                                : 'pill success'
                          }
                        >
                          {r.status}
                        </span>
                      </td>
                      <td className="numeric">{r.students}</td>
                      <td className="numeric">{r.share}</td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </DetailSection>
      )}

      {/* 10. Demographic outlook */}
      {data.demographic && (
        <DetailSection
          num={10}
          title="Demographic outlook"
          subtitle={`Catchment ${data.demographic.catchment} · age cohort ${data.demographic.ageCohort} · source ${data.demographic.source}`}
        >
          <KvTable
            headers={['Metric', 'Value', 'Notes']}
            rows={[
              {
                metric: "Today's Year-1 intake",
                value: data.demographic.baselineYearOneIntake,
                notes: 'latest complete academic year',
              },
              {
                metric: '+15y cohort contraction',
                value: data.demographic.fifteenYearContraction,
                notes: `${data.demographic.catchment} ${data.demographic.ageCohort} cohort`,
              },
              {
                metric: 'Demographic ceiling',
                value: data.demographic.riskLevel,
                notes: 'risk verdict',
              },
            ]}
          />

          <h3>10.1 Cohort projection — share to maintain today&apos;s intake</h3>
          {(() => {
            const pops = data.demographic.projections.map(
              (p) => parseScoreLike(p.cohortPopulation) ?? 0,
            );
            const max = Math.max(...pops, 1);
            return (
              <HBars
                rows={data.demographic.projections.map((p, i) => ({
                  label: p.year,
                  pct: (pops[i] ?? 0) / max,
                  value: p.cohortPopulation,
                  tone: i === 0 ? 'info' : 'muted',
                }))}
                caption="Population trend (relative to today's cohort)"
              />
            );
          })()}
          <table>
            <thead>
              <tr>
                <th>Year</th>
                <th className="numeric">Cohort population</th>
                <th className="numeric">Decline vs today</th>
                <th className="numeric">Share needed</th>
              </tr>
            </thead>
            <tbody>
              {data.demographic.projections.length === 0
                ? emptyRow(4, 'No projection data')
                : data.demographic.projections.map((p, i) => (
                    <tr key={i}>
                      <td>{p.year}</td>
                      <td className="numeric">{p.cohortPopulation}</td>
                      <td className="numeric">{p.decline}</td>
                      <td className="numeric">{p.shareNeeded}</td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </DetailSection>
      )}

      {/* 11. Outcomes */}
      {data.outcomes && (
        <DetailSection
          num={11}
          title="Outcomes"
          subtitle={`Survey year ${data.outcomes.surveyYear} · ${data.outcomes.sampleSize} graduates surveyed · methodology ${data.outcomes.methodologyVersion} · ${data.outcomes.freshnessDate}`}
          breakBefore
        >
          <h3>11.1 Headline outcomes</h3>
          <KvTable rows={data.outcomes.summary} />

          {data.outcomes.salaryTrajectory.length > 0 && (
            <>
              <h3>11.2 Average starting salary by graduation year</h3>
              {(() => {
                const sorted = [...data.outcomes.salaryTrajectory].sort(
                  (a, b) => Number(a.year) - Number(b.year),
                );
                const sals = sorted.map((r) => parseScoreLike(r.salary) ?? 0);
                const max = Math.max(...sals, 1);
                return (
                  <VBars
                    rows={sorted.map((r, i) => ({
                      axis: r.year,
                      value: `${((sals[i] ?? 0) / 1000).toFixed(0)}k`,
                      pct: (sals[i] ?? 0) / max,
                      tone: 'success',
                    }))}
                  />
                );
              })()}
              <table className="compact">
                <thead>
                  <tr>
                    <th>Graduation year</th>
                    <th className="numeric">Average salary (THB / month)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.outcomes.salaryTrajectory.map((r, i) => (
                    <tr key={i}>
                      <td>{r.year}</td>
                      <td className="numeric">{r.salary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {data.outcomes.topEmployers.length > 0 && (
            <>
              <h3>11.3 Top employers</h3>
              <table className="compact">
                <thead>
                  <tr>
                    <th>Employer</th>
                    <th>Survey year</th>
                    <th className="numeric">Employer satisfaction</th>
                  </tr>
                </thead>
                <tbody>
                  {data.outcomes.topEmployers.map((e, i) => (
                    <tr key={i}>
                      <td>{e.employer}</td>
                      <td>{e.year}</td>
                      <td className="numeric">{e.satisfaction}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </DetailSection>
      )}

      {/* 12. Skills coverage */}
      {data.skills && (
        <DetailSection
          num={12}
          title="Skills coverage"
          subtitle={`${data.skills.totalTaught} skills taught (${data.skills.ploCount} from PLOs) · demand match ${data.skills.matchScore} · source ${data.skills.demandSource} (${data.skills.demandTier}) · ${data.skills.careerFilterCount} careers in scope`}
        >
          <h3>12.1 Major contributors (PLO and/or compulsory)</h3>
          <table className="compact">
            <thead>
              <tr>
                <th>Skill</th>
                <th>PLO</th>
                <th className="numeric">Compulsory weight</th>
                <th className="numeric">Elective weight</th>
                <th>Evidence</th>
              </tr>
            </thead>
            <tbody>
              {data.skills.major.length === 0
                ? emptyRow(5, 'No major contributors')
                : data.skills.major.map((s, i) => (
                    <tr key={i}>
                      <td>{s.skill}</td>
                      <td>{s.plo}</td>
                      <td className="numeric">{s.compulsoryWeight}</td>
                      <td className="numeric">{s.electiveWeight}</td>
                      <td>{s.evidence}</td>
                    </tr>
                  ))}
            </tbody>
          </table>

          <h3>12.2 Minor contributors (elective only)</h3>
          <table className="compact">
            <thead>
              <tr>
                <th>Skill</th>
                <th className="numeric">Elective weight</th>
              </tr>
            </thead>
            <tbody>
              {data.skills.minor.length === 0
                ? emptyRow(2, 'No minor contributors')
                : data.skills.minor.map((s, i) => (
                    <tr key={i}>
                      <td>{s.skill}</td>
                      <td className="numeric">{s.electiveWeight}</td>
                    </tr>
                  ))}
            </tbody>
          </table>

          <h3>12.3 Top demanded skills (labour market)</h3>
          <table className="compact">
            <thead>
              <tr>
                <th>Skill</th>
                <th className="numeric">Peak demand</th>
                <th className="numeric">Careers</th>
                <th>Curriculum match</th>
              </tr>
            </thead>
            <tbody>
              {data.skills.demanded.length === 0
                ? emptyRow(4, 'No demanded skills')
                : data.skills.demanded.map((s, i) => (
                    <tr key={i}>
                      <td>{s.skill}</td>
                      <td className="numeric">{s.peakDemand}</td>
                      <td className="numeric">{s.careerCount}</td>
                      <td>{s.match}</td>
                    </tr>
                  ))}
            </tbody>
          </table>

          {data.skills.gaps.length > 0 && (
            <>
              <h3>12.4 Top gap candidates (demanded but not taught)</h3>
              <table className="compact">
                <thead>
                  <tr>
                    <th>Skill</th>
                    <th className="numeric">Peak demand</th>
                    <th className="numeric">Careers</th>
                  </tr>
                </thead>
                <tbody>
                  {data.skills.gaps.map((g, i) => (
                    <tr key={i}>
                      <td>{g.skill}</td>
                      <td className="numeric">{g.peakDemand}</td>
                      <td className="numeric">{g.careerCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </DetailSection>
      )}

      {/* 13. Faculty capability */}
      {data.faculty && (
        <DetailSection
          num={13}
          title="Faculty capability"
          subtitle={`Source: ${data.faculty.rosterScope} · ${data.faculty.visibility}`}
        >
          <h3>13.1 Headline numbers</h3>
          <KvTable rows={data.faculty.kpis} />

          <h3>13.2 Academic rank distribution</h3>
          {(() => {
            const counts = data.faculty.rankDistribution.map(
              (r) => parseScoreLike(r.count) ?? 0,
            );
            const max = Math.max(...counts, 1);
            const SENIOR = ['Professor', 'Associate Professor'];
            return (
              <HBars
                rows={data.faculty.rankDistribution.map((r, i) => ({
                  label: r.rank,
                  pct: (counts[i] ?? 0) / max,
                  value: `${r.count} · ${r.share}`,
                  tone: SENIOR.includes(r.rank) ? 'success' : 'info',
                }))}
              />
            );
          })()}
          <table>
            <thead>
              <tr>
                <th>Rank</th>
                <th className="numeric">Count</th>
                <th className="numeric">Share</th>
              </tr>
            </thead>
            <tbody>
              {data.faculty.rankDistribution.length === 0
                ? emptyRow(3, 'No rank data')
                : data.faculty.rankDistribution.map((r, i) => (
                    <tr key={i}>
                      <td>{r.rank}</td>
                      <td className="numeric">{r.count}</td>
                      <td className="numeric">{r.share}</td>
                    </tr>
                  ))}
            </tbody>
          </table>

          {data.faculty.roster.length > 0 && (
            <>
              <h3>13.3 Roster</h3>
              <table className="compact">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Name</th>
                    <th>Specialisation</th>
                    <th>Retires</th>
                  </tr>
                </thead>
                <tbody>
                  {data.faculty.roster.map((m, i) => (
                    <tr key={i}>
                      <td>{m.rank}</td>
                      <td>{m.name}</td>
                      <td>{m.specialization}</td>
                      <td>{m.retires}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </DetailSection>
      )}

      {/* 14. Financials */}
      {data.financials && (
        <DetailSection
          num={14}
          title="Financials"
          subtitle={`Cost methodology ${data.financials.methodologyVersion} · headline FY ${data.financials.headlineFiscalYear}${data.financials.partialCurrentYearNote ? ` · ${data.financials.partialCurrentYearNote}` : ''}`}
        >
          <h3>14.1 Headline numbers</h3>
          <KvTable rows={data.financials.kpis} />

          <h3>14.2 Tuition flow waterfall</h3>
          {(() => {
            const abs = data.financials.waterfall.map(
              (s) => Math.abs(parseScoreLike(s.value) ?? 0),
            );
            const max = Math.max(...abs, 1);
            return (
              <HBars
                rows={data.financials.waterfall.map((s, i) => ({
                  label: s.step,
                  pct: (abs[i] ?? 0) / max,
                  value: `${s.value} THB`,
                  tone:
                    s.kind === 'negative'
                      ? 'warning'
                      : s.kind === 'total'
                        ? 'info'
                        : 'success',
                }))}
              />
            );
          })()}
          <table>
            <thead>
              <tr>
                <th>Step</th>
                <th>Kind</th>
                <th className="numeric">Value (THB)</th>
              </tr>
            </thead>
            <tbody>
              {data.financials.waterfall.length === 0
                ? emptyRow(3, 'No waterfall data')
                : data.financials.waterfall.map((s, i) => (
                    <tr key={i}>
                      <td>{s.step}</td>
                      <td>
                        <span
                          className={
                            s.kind === 'negative'
                              ? 'pill warning'
                              : s.kind === 'total'
                                ? 'pill info'
                                : 'pill success'
                          }
                        >
                          {s.kind}
                        </span>
                      </td>
                      <td className="numeric">{s.value}</td>
                    </tr>
                  ))}
            </tbody>
          </table>

          {data.financials.sensitivity && (
            <p className="inline-note">{data.financials.sensitivity}</p>
          )}

          {data.financials.trend.length > 0 && (
            <>
              <h3>14.3 Year-over-year trend</h3>
              <table>
                <thead>
                  <tr>
                    <th>Fiscal year</th>
                    <th className="numeric">Tuition revenue</th>
                    <th className="numeric">Faculty subsidy</th>
                    <th className="numeric">Net contribution</th>
                  </tr>
                </thead>
                <tbody>
                  {data.financials.trend.map((t, i) => (
                    <tr key={i}>
                      <td>{t.year}</td>
                      <td className="numeric">{t.tuition}</td>
                      <td className="numeric">{t.subsidy}</td>
                      <td className="numeric">{t.net}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </DetailSection>
      )}

      {/* 15. Peer comparison */}
      {data.peers && (
        <DetailSection
          num={15}
          title="Peer comparison"
          subtitle={
            data.peers.subjectSignature
              ? `Subject signature: ${data.peers.subjectSignature}${data.peers.rankingYear ? ` · ${data.peers.rankingYear} rankings` : ''}`
              : undefined
          }
          breakBefore
        >
          {data.peers.tiers.map((tier, ti) => (
            <div key={ti}>
              <h3>
                14.{ti + 1} {tier.tier}
              </h3>
              <table className="compact">
                <thead>
                  <tr>
                    <th className="numeric" style={{ width: '8%' }}>
                      #
                    </th>
                    <th>Institution</th>
                    <th>Country</th>
                    <th className="numeric">QS World</th>
                    <th>Programme</th>
                  </tr>
                </thead>
                <tbody>
                  {tier.entries.length === 0
                    ? emptyRow(5, 'No peers selected for this tier')
                    : tier.entries.map((p, i) => (
                        <tr key={i}>
                          <td className="numeric">{p.rank}</td>
                          <td>{p.institution}</td>
                          <td>{p.country}</td>
                          <td className="numeric">{p.qsWorld}</td>
                          <td>{p.programme}</td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>
          ))}

          {data.peers.aiReview && (
            <>
              <h3>
                14.{data.peers.tiers.length + 1} AI peer review (confidence{' '}
                {data.peers.aiReview.confidencePct})
              </h3>
              {data.peers.aiReview.strengths.length > 0 && (
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: '14%' }}>Strengths</th>
                      <th>Claim</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.peers.aiReview.strengths.map((s, i) => (
                      <tr key={i}>
                        <td>
                          <span className="pill success">strength</span>
                        </td>
                        <td>{s.claim}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {data.peers.aiReview.weaknesses.length > 0 && (
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: '14%' }}>Weaknesses</th>
                      <th>Claim</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.peers.aiReview.weaknesses.map((w, i) => (
                      <tr key={i}>
                        <td>
                          <span className="pill warning">weakness</span>
                        </td>
                        <td>{w.claim}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {data.peers.aiReview.contentModernity && (
                <p className="inline-note">
                  <strong>
                    Curriculum modernity:{' '}
                    {data.peers.aiReview.contentModernity.verdict}
                  </strong>{' '}
                  — {data.peers.aiReview.contentModernity.narrative}
                </p>
              )}
              {data.peers.aiReview.summary && (
                <p className="inline-note">{data.peers.aiReview.summary}</p>
              )}
            </>
          )}

          {data.peers.curatedPeers.length > 0 && (
            <>
              <h3>
                14.{data.peers.tiers.length + (data.peers.aiReview ? 2 : 1)}{' '}
                Curated peer set
              </h3>
              <table className="compact">
                <thead>
                  <tr>
                    <th>Institution</th>
                    <th>Country</th>
                    <th>Programme</th>
                    <th className="numeric">Ranking</th>
                  </tr>
                </thead>
                <tbody>
                  {data.peers.curatedPeers.map((p, i) => (
                    <tr key={i}>
                      <td>{p.institution}</td>
                      <td>{p.country}</td>
                      <td>{p.programName}</td>
                      <td className="numeric">{p.ranking}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </DetailSection>
      )}

      {/* 16. Trend exposure */}
      {data.trends.length > 0 && (
        <DetailSection
          num={16}
          title="Trend exposure"
          subtitle={`${data.trends.length} signal${data.trends.length === 1 ? '' : 's'} surfaced — sorted by detection date.`}
        >
          <table className="compact">
            <thead>
              <tr>
                <th>Title</th>
                <th>Type</th>
                <th>Targeted</th>
                <th className="numeric">Impact</th>
                <th>Recommendation</th>
                <th>Detected</th>
              </tr>
            </thead>
            <tbody>
              {data.trends.map((t, i) => (
                <tr key={i}>
                  <td>{t.title}</td>
                  <td>{t.type}</td>
                  <td>{t.targeted}</td>
                  <td className="numeric">{t.impact}</td>
                  <td>
                    <span className={severityClass(t.recommendation)}>
                      {t.recommendation}
                    </span>
                  </td>
                  <td>{t.detected}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3>16.1 Why each signal matters</h3>
          <table>
            <thead>
              <tr>
                <th style={{ width: '32%' }}>Title</th>
                <th>Rationale</th>
              </tr>
            </thead>
            <tbody>
              {data.trends.map((t, i) => (
                <tr key={i}>
                  <td>
                    <strong>{t.title}</strong>
                    {t.summary && (
                      <>
                        <br />
                        <span style={{ color: '#666', fontSize: '12pt' }}>
                          {t.summary}
                        </span>
                      </>
                    )}
                  </td>
                  <td>{t.rationale}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </DetailSection>
      )}

      {/* 17. Decisions */}
      {data.decisions.length > 0 && (
        <DetailSection
          num={17}
          title="Council decision history"
          subtitle={`${data.decisions.length} decision${data.decisions.length === 1 ? '' : 's'} on file`}
        >
          <table>
            <thead>
              <tr>
                <th>Decision</th>
                <th>Status</th>
                <th>Decided by</th>
                <th>Created</th>
                <th>Effective</th>
                <th>Rationale</th>
              </tr>
            </thead>
            <tbody>
              {data.decisions.map((d, i) => (
                <tr key={i}>
                  <td>{d.decisionType}</td>
                  <td>
                    <span className="pill">{d.status}</span>
                  </td>
                  <td>{d.decidedBy}</td>
                  <td>{d.createdAt}</td>
                  <td>{d.effectiveDate}</td>
                  <td>{d.rationale}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </DetailSection>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Template export.
// ---------------------------------------------------------------------------

export const programDetailTemplate: TemplateDefinition<ProgramDetailData> = {
  name: 'program-detail',
  version: VERSION,
  schema: ProgramDetailDataSchema,
  render(data) {
    return {
      html: renderTemplateToHtml(<ProgramDetailDoc data={data} />),
      css: `${baseCss}\n${EXTRA_CSS}`,
      footerHtml: buildFooterHtml({
        leftLabel: `KKU Curriculum Compass · ${data.nameTh} · ${data.programCode}`,
        rightLabel: 'Internal — analyst working document',
      }),
    };
  },
};
