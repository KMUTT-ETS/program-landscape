// Landscape atlas — the Executive Landscape's five chapters.
// Spec: docs/superpowers/specs/2026-10-05-landscape-atlas-design.md
// Methodology: docs/methodologies/landscape-atlas.md

import { HEALTH_DANGER_BELOW as SHARED_HEALTH_DANGER_BELOW, HEALTH_HEALTHY_FROM } from '@kku/shared';

export const LANDSCAPE_ATLAS_VERSION = 'landscape-atlas.v1';

/** Split lines (spec D6) — each reuses a threshold the methodology already uses. */
export const APPLICATIONS_PER_SEAT_SPLIT = 1;
export const ENROLMENT_CHANGE_SPLIT_PCT = 0;
/** "Healthy" band of the health score starts here (shared health zones). */
export const HEALTH_SPLIT = HEALTH_HEALTHY_FROM;
/** KKU ERM: a matrix score of 10 or more is HIGH. */
export const RISK_MATRIX_SPLIT = 10;
/** Health score bands: < 40 danger, 40–65 needs attention, ≥ 65 healthy
 *  (shared health zones, @kku/shared/health/zones). */
export const HEALTH_DANGER_BELOW = SHARED_HEALTH_DANGER_BELOW;

/** Answer-line thresholds. */
export const SMALL_PROGRAMME_STUDENTS = 15;
export const GRANT_ANSWER_THRESHOLD_THB = 1_000_000;
export const SECTOR_THIN_PROGRAMMES = 15;

export type Tone = 'positive' | 'warning' | 'negative' | 'neutral';

/** One mark on a bubble chart, already in 0–100 plot space. */
export interface AtlasPoint {
  id: string;
  label: string;
  sublabel?: string;
  x: number;
  y: number;
  size: number;
  tone: Tone;
  href?: string;
  /** Raw values for the "show data" table, in display order. */
  values: Record<string, number | string | null>;
}

/** Something a chart could not place, and why. Never drawn as 0. */
export interface Unplotted {
  id: string;
  label: string;
  reason: string;
}

/** The one-line answer under a chapter heading. */
export interface ChapterAnswer {
  figure: string | null;
  sentence: string;
}

export const NO_ANSWER: ChapterAnswer = {
  figure: null,
  sentence: 'Not enough data to summarise this chapter.',
};

export interface PlotTick {
  at: number;
  label: string;
}

/** Guides for a bubble chart, in 0–100 plot space. */
export interface PlotFrame {
  split: { x: number; y: number } | null;
  diagonal: boolean;
  xTicks: PlotTick[];
  yTicks: PlotTick[];
}
