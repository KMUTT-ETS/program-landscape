import type { ReactNode } from 'react';

/**
 * Where a chart's numbers came from. Required on every chart — Council
 * readiness rule 1. Never make these optional.
 */
export interface Provenance {
  /** Connector or source slug, e.g. 'kku-registry'. */
  source: string;
  /** Human-readable ingestion date, e.g. '12 Aug 2026'. */
  runDate: string;
  /** Origin table, when one table dominates. */
  table?: string;
  /** Versioned methodology, e.g. 'health-score.v2'. */
  method: string;
}

export interface ChartFrameProps {
  title: string;
  /** One-sentence Thai lede stating what the chart shows. */
  ledeTh?: string;
  provenance: Provenance;
  /** Defaults to 180 — the full A4 text measure at 15mm side margins. */
  widthMm?: number;
  heightMm: number;
  /** When true, renders emptyNote instead of children. */
  empty?: boolean;
  /** Why there is no data. Shown when `empty` is true. */
  emptyNote?: string;
  children?: ReactNode;
}

/** Props every primitive accepts, minus its own data shape. */
export type ChartCommonProps = Omit<ChartFrameProps, 'children' | 'empty'>;
