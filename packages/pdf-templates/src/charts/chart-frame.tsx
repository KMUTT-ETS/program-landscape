import * as React from 'react';

import { INK } from './palette';
import { pt } from './scale';
import type { ChartFrameProps } from './types';

/** Full A4 text measure with the standard 15mm side margins. */
export const DEFAULT_WIDTH_MM = 180;

export function ChartFrame({
  title,
  ledeTh,
  provenance,
  widthMm = DEFAULT_WIDTH_MM,
  heightMm,
  empty = false,
  emptyNote,
  children,
}: ChartFrameProps): React.ReactElement {
  return (
    <figure className="chart-frame avoid-break" style={{ margin: '6pt 0 12pt 0' }}>
      <div className="chart-title">{title}</div>
      {/* `.chart-lede` has no rule in base-css.ts yet — magazine-css.ts adds one
          in plan 2. Inline style keeps it correct standalone until then. */}
      {ledeTh ? (
        <div className="chart-lede" style={{ fontSize: '14pt', lineHeight: 1.5, margin: '2pt 0 4pt' }}>
          {ledeTh}
        </div>
      ) : null}

      {empty ? (
        <div
          className="chart-empty"
          style={{
            height: `${heightMm}mm`,
            background: INK.surface,
            border: `0.5pt solid ${INK.rule}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: INK.muted,
            fontSize: '13pt',
            textAlign: 'center',
            padding: '0 10mm',
          }}
        >
          {emptyNote ?? 'No data available for this section.'}
        </div>
      ) : (
        <svg
          width={`${widthMm}mm`}
          height={`${heightMm}mm`}
          viewBox={`0 0 ${widthMm} ${heightMm}`}
          role="img"
          aria-label={title}
          xmlns="http://www.w3.org/2000/svg"
        >
          {children}
        </svg>
      )}

      <figcaption className="chart-caption" style={{ fontSize: '12pt', color: INK.muted }}>
        <strong>Source</strong> {provenance.source} · {provenance.runDate}
        {provenance.table ? ` · ${provenance.table}` : ''}
        {' · '}
        <strong>Method</strong> {provenance.method}
      </figcaption>
    </figure>
  );
}

/**
 * Shared text style for in-chart labels. Sizes are pt, converted to mm units.
 *
 * TH Sarabun New is the only Thai body face actually installed in the
 * Gotenberg image (a spike ruled out 'Sarabun' as a fallback — it isn't
 * present there and silently resolves to a larger, bolder face, wrecking
 * layouts sized for TH Sarabun New's metrics). That same spike found TH
 * Sarabun New is optically small — low x-height — so an 8pt label reads
 * noticeably smaller than 8pt would in a Latin face. Sizes below are bumped
 * up accordingly; do not "correct" them back down to Latin-typography
 * instinct.
 */
export const LABEL = {
  fontFamily: "'TH Sarabun New','Noto Sans Thai',sans-serif",
  value: pt(9),
  axis: pt(8.5),
  legend: pt(8.5),
} as const;
