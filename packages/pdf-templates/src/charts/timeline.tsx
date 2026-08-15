import * as React from 'react';

import { ChartFrame, DEFAULT_WIDTH_MM, LABEL } from './chart-frame';
import { fitLabel } from './fit-label';
import { EMPTY_HEIGHT_MM, MARGIN_MM } from './layout';
import { INK, seriesColour } from './palette';
import { linear, pt } from './scale';
import type { ChartCommonProps } from './types';

export interface TimelineEvent {
  /** ISO date, e.g. '2026-04-23'. */
  date: string;
  label: string;
  /** Optional category, drives colour. */
  kind?: string;
}

export interface TimelineProps extends Omit<ChartCommonProps, 'heightMm'> {
  events: readonly TimelineEvent[];
  /** Height in mm of each stacked slot, used when same-date events fan out. */
  rowHeightMm?: number;
  /** Width in mm reserved for each event's date+label text. */
  labelWidthMm?: number;
}

const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

const MARKER_RADIUS_MM = 1.4;
/** Gap between the axis and the top of the first stacked label row. */
const STEM_MM = 3;
const STEM_DASH = `${pt(1)},${pt(0.8)}`;

interface ParsedDate {
  ts: number;
  year: number;
  month0: number;
  day: number;
}

/**
 * Strict `YYYY-MM-DD` parse. `Date.UTC` silently rolls an impossible
 * day/month combination (e.g. Feb 30) into the *next* valid calendar date
 * rather than erroring — rendering that would put the marker at a
 * confidently wrong position with no visible sign anything was off, the
 * same "reads as something it isn't" failure this library's other RangeError
 * guards exist to prevent. So the parsed date is round-tripped back through
 * `Date` and checked against the original fields before being trusted.
 */
function parseIsoDate(dateStr: string): ParsedDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  const yearStr = match?.[1];
  const monthStr = match?.[2];
  const dayStr = match?.[3];
  if (yearStr === undefined || monthStr === undefined || dayStr === undefined) {
    throw new RangeError(`Timeline: "${dateStr}" is not a valid ISO date — expected YYYY-MM-DD.`);
  }
  const year = Number(yearStr);
  const month0 = Number(monthStr) - 1;
  const day = Number(dayStr);
  const ts = Date.UTC(year, month0, day);
  const roundTrip = new Date(ts);
  if (roundTrip.getUTCFullYear() !== year || roundTrip.getUTCMonth() !== month0 || roundTrip.getUTCDate() !== day) {
    throw new RangeError(`Timeline: "${dateStr}" is not a valid calendar date.`);
  }
  return { ts, year, month0, day };
}

function formatDisplayDate(p: ParsedDate): string {
  const month = MONTH_ABBR[p.month0];
  // Unreachable given parseIsoDate's round-trip check already bounds month0
  // to 0–11, but this keeps the lookup safe without an `as` cast.
  if (month === undefined) throw new RangeError(`Timeline: month index ${p.month0} out of range.`);
  return `${p.day} ${month} ${p.year}`;
}

/**
 * Colour index by `kind`, in first-seen order across the (already-sorted)
 * events — the same "order of first appearance" contract BarsStacked's
 * legend uses. An event with no `kind` falls back to index 0, same as
 * every other primitive's `series ?? 0` default; it can coincide with the
 * first real kind's colour, which is an accepted, existing tradeoff in
 * this library rather than one specific to Timeline.
 */
function buildKindIndex(events: readonly TimelineEvent[]): ReadonlyMap<string, number> {
  const index = new Map<string, number>();
  for (const event of events) {
    if (event.kind !== undefined && !index.has(event.kind)) index.set(event.kind, index.size);
  }
  return index;
}

export function Timeline({
  events,
  provenance,
  title,
  ledeTh,
  widthMm = DEFAULT_WIDTH_MM,
  rowHeightMm = 10,
  labelWidthMm = 60,
  emptyNote,
}: TimelineProps): React.ReactElement {
  if (events.length === 0) {
    return (
      <ChartFrame title={title} ledeTh={ledeTh} provenance={provenance}
                  widthMm={widthMm} heightMm={EMPTY_HEIGHT_MM} empty emptyNote={emptyNote} />
    );
  }

  const plotWidth = widthMm - 2 * MARGIN_MM;
  if (plotWidth <= 0) {
    // Same posture as LineTrend's plotWidth guard: a non-positive width
    // would map every date to the same (or a negative) pixel with no error.
    throw new RangeError(`Timeline: no room to plot — widthMm ${widthMm} leaves ${plotWidth}mm inside the ${2 * MARGIN_MM}mm margin.`);
  }

  // Unlike Funnel — where input order is semantically meaningful and must
  // never be reordered — a timeline's order IS its date, so sorting here is
  // correct rather than a distortion. Every date is parsed (and, on failure,
  // thrown) up front, before sorting, so an unparseable date fails loudly
  // instead of comparing as NaN and silently sorting to one end of the axis.
  const parsed = events.map((event) => ({ event, date: parseIsoDate(event.date) }));
  const sorted = [...parsed].sort((a, b) => a.date.ts - b.date.ts);

  const kindIndex = buildKindIndex(events);

  const firstDate = sorted[0]?.date;
  const lastDate = sorted[sorted.length - 1]?.date;
  if (!firstDate || !lastDate) throw new Error('unreachable: sorted is non-empty because events.length > 0 was checked above');
  const x = linear([firstDate.ts, lastDate.ts], [MARGIN_MM, MARGIN_MM + plotWidth]);

  // Same-date events stack vertically. `sorted` is chronological, so
  // repeats of the same date are adjacent — a running "reset on date
  // change" counter is enough to fan them apart without a separate
  // grouping pass.
  let stackIndex = 0;
  let previousTs: number | null = null;
  const laidOut = sorted.map(({ event, date }) => {
    stackIndex = date.ts === previousTs ? stackIndex + 1 : 0;
    previousTs = date.ts;
    return { event, date, stackIndex };
  });
  const maxStack = Math.max(...laidOut.map((e) => e.stackIndex), 0);

  const axisY = MARGIN_MM;
  const heightMm = axisY + STEM_MM + (maxStack + 1) * rowHeightMm + MARGIN_MM;

  return (
    <ChartFrame title={title} ledeTh={ledeTh} provenance={provenance} widthMm={widthMm} heightMm={heightMm}>
      <line x1={MARGIN_MM} y1={axisY} x2={widthMm - MARGIN_MM} y2={axisY}
            stroke={INK.rule} strokeWidth={pt(0.6)} />
      {laidOut.map(({ event, date, stackIndex }, i) => {
        const cx = x(date.ts);
        const labelY = axisY + STEM_MM + stackIndex * rowHeightMm + rowHeightMm * 0.7;
        const stemBottomY = labelY - LABEL.axis * 0.9;
        const colour = seriesColour(event.kind !== undefined ? kindIndex.get(event.kind) ?? 0 : 0);
        const text = `${formatDisplayDate(date)} · ${event.label}`;
        const labelFit = fitLabel(text, labelWidthMm, LABEL.axis);
        // A late-timeline event's label would otherwise run off the right
        // edge of the canvas — flip the anchor so it extends back toward
        // the marker instead. Same "don't spill off the canvas" posture as
        // Radar's per-axis label anchor.
        const overflowsRight = cx + labelWidthMm > widthMm - MARGIN_MM;
        const textAnchor = overflowsRight ? 'end' : 'start';

        return (
          <g key={i} data-kind={event.kind ?? 'default'}>
            <line className="timeline-stem" x1={cx} y1={axisY} x2={cx} y2={stemBottomY}
                  stroke={INK.muted} strokeWidth={pt(0.4)} strokeDasharray={STEM_DASH} />
            <circle className="timeline-marker" cx={cx} cy={axisY} r={MARKER_RADIUS_MM}
                    fill={colour} stroke={INK.surface} strokeWidth={pt(0.6)} />
            <text className="timeline-label" x={cx} y={labelY} textAnchor={textAnchor}
                  fontSize={LABEL.axis} fontFamily={LABEL.fontFamily} fill={INK.axis} {...labelFit}>
              {text}
            </text>
          </g>
        );
      })}
    </ChartFrame>
  );
}
