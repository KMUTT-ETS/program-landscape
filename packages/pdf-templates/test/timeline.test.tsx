import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Timeline } from '../src/charts/timeline';
import type { TimelineEvent } from '../src/charts/timeline';

const PROV = { source: 'council-decisions', runDate: '12 Aug 2026', method: 'decision-workspace.v1' };

// Deliberately NOT in chronological order (Mar, Jan, May) — the primitive
// must sort by date itself; unlike Funnel, input order carries no meaning
// here.
const EVENTS: readonly TimelineEvent[] = [
  { date: '2026-03-10', label: 'Council reviewed', kind: 'review' },
  { date: '2026-01-15', label: 'Proposed', kind: 'milestone' },
  { date: '2026-05-02', label: 'Approved', kind: 'decision' },
];

function markerCx(html: string): number[] {
  return [...html.matchAll(/class="timeline-marker"[^>]*cx="([\d.]+)"/g)].map((m) => Number(m[1]));
}

function labelIndex(html: string, text: string): number {
  const at = html.indexOf(text);
  if (at === -1) throw new Error(`fixture bug: "${text}" not found in markup`);
  return at;
}

describe('Timeline', () => {
  it('draws one marker per event', () => {
    const html = renderToStaticMarkup(<Timeline events={EVENTS} provenance={PROV} title="Decision history" />);
    expect(html.match(/class="timeline-marker"/g) ?? []).toHaveLength(3);
  });

  it('labels every event with its date and text', () => {
    const html = renderToStaticMarkup(<Timeline events={EVENTS} provenance={PROV} title="Decision history" />);
    for (const e of EVENTS) expect(html).toContain(e.label);
    expect(html).toContain('15 Jan 2026');
    expect(html).toContain('10 Mar 2026');
    expect(html).toContain('2 May 2026');
  });

  it('positions a later event farther along the date axis', () => {
    const html = renderToStaticMarkup(<Timeline events={EVENTS} provenance={PROV} title="Decision history" />);
    const cx = markerCx(html);
    expect(cx).toHaveLength(3);
    // Rendered in date order (Jan, Mar, May), so cx must strictly increase.
    expect(cx[0]).toBeLessThan(cx[1] ?? Number.NaN);
    expect(cx[1]).toBeLessThan(cx[2] ?? Number.NaN);
  });

  it('renders the empty state for an empty event list rather than a bare axis', () => {
    const html = renderToStaticMarkup(
      <Timeline events={[]} provenance={PROV} title="Decision history" emptyNote="No decisions recorded yet" />,
    );
    expect(html).toContain('No decisions recorded yet');
    expect(html).not.toContain('class="timeline-marker"');
  });

  // A single event is a degenerate (zero-width) date domain — must not
  // divide by zero and produce a NaN coordinate.
  it('survives a single event', () => {
    const html = renderToStaticMarkup(
      <Timeline events={[{ date: '2026-01-01', label: 'Only event' }]} provenance={PROV} title="Decision history" />,
    );
    expect(html).not.toContain('NaN');
    expect(html.match(/class="timeline-marker"/g) ?? []).toHaveLength(1);
  });

  it('matches the golden snapshot', () => {
    expect(
      renderToStaticMarkup(<Timeline events={EVENTS} provenance={PROV} title="Decision history" />),
    ).toMatchSnapshot();
  });

  // The primitive must reorder its OWN rendering, not just accept
  // pre-sorted input — checked by the actual rendered label sequence, not
  // merely that all three labels are present somewhere.
  it('renders events in date order regardless of input order', () => {
    const html = renderToStaticMarkup(<Timeline events={EVENTS} provenance={PROV} title="Decision history" />);
    const proposedAt = labelIndex(html, 'Proposed'); // 2026-01-15, earliest
    const reviewedAt = labelIndex(html, 'Council reviewed'); // 2026-03-10
    const approvedAt = labelIndex(html, 'Approved'); // 2026-05-02, latest
    expect(proposedAt).toBeLessThan(reviewedAt);
    expect(reviewedAt).toBeLessThan(approvedAt);
  });

  // Two council decisions landing on the same calendar day are entirely
  // realistic and must not overdraw — they need distinguishable positions.
  it('offsets two events that share the same date rather than overdrawing them', () => {
    const sameDayEvents: readonly TimelineEvent[] = [
      { date: '2026-04-23', label: 'Morning session decision' },
      { date: '2026-04-23', label: 'Afternoon session decision' },
    ];
    const html = renderToStaticMarkup(<Timeline events={sameDayEvents} provenance={PROV} title="Decision history" />);

    // Both markers stay pinned exactly on the date axis (same date = same
    // point on the axis, which is chronologically honest) — the collision
    // is instead resolved by fanning the attached labels below the axis.
    const markers = [...html.matchAll(/class="timeline-marker"[^>]*cx="([\d.]+)" cy="([\d.]+)"/g)].map((m) => ({
      cx: Number(m[1]),
      cy: Number(m[2]),
    }));
    expect(markers).toHaveLength(2);
    const [firstMarker, secondMarker] = markers;
    if (!firstMarker || !secondMarker) throw new Error('fixture bug: missing marker');
    expect(firstMarker.cx).toBeCloseTo(secondMarker.cx, 6);
    expect(firstMarker.cy).toBeCloseTo(secondMarker.cy, 6);

    // The labels are what must not overdraw — same x (attached to the same
    // date), but staggered to a different y so both remain readable.
    const labels = [...html.matchAll(/class="timeline-label" x="([\d.]+)" y="([\d.]+)"/g)].map((m) => ({
      x: Number(m[1]),
      y: Number(m[2]),
    }));
    expect(labels).toHaveLength(2);
    const [firstLabel, secondLabel] = labels;
    if (!firstLabel || !secondLabel) throw new Error('fixture bug: missing label');
    expect(firstLabel.x).toBeCloseTo(secondLabel.x, 6);
    expect(firstLabel.y).not.toBeCloseTo(secondLabel.y, 6);
  });

  // An unparseable date must fail loudly, naming the offending value —
  // never silently sort to a NaN timestamp, which Array.sort would push to
  // one end of the axis with no visible error.
  it('throws when a date is not parseable, naming the offending value', () => {
    const badEvents = [{ date: 'not-a-date', label: 'Broken' }];
    expect(() =>
      renderToStaticMarkup(<Timeline events={badEvents} provenance={PROV} title="Decision history" />),
    ).toThrow(/not-a-date/);
  });

  // Date.UTC silently rolls an impossible day (Feb 30) into the next valid
  // date instead of erroring — that must be caught explicitly, not allowed
  // to render at a quietly wrong (rolled-over) position.
  it('throws on a syntactically-valid but impossible calendar date', () => {
    const badEvents = [{ date: '2026-02-30', label: 'Impossible date' }];
    expect(() =>
      renderToStaticMarkup(<Timeline events={badEvents} provenance={PROV} title="Decision history" />),
    ).toThrow(RangeError);
  });
});
