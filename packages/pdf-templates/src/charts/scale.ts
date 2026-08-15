// Pure scale maths for print-first SVG charts. No React, no DOM.
//
// Charts author geometry in MILLIMETRES: <svg width="180mm" viewBox="0 0 180 60">
// means one user unit is one millimetre. Font sizes are the one thing that
// must be converted, because `fontSize={8}` in that space means 8mm, not 8pt.

const MM_PER_POINT = 25.4 / 72;

/** Points → millimetres. Use for every fontSize and stroke-width in a chart. */
export function pt(points: number): number {
  return points * MM_PER_POINT;
}

/**
 * Linear scale from a data domain to a pixel/mm range.
 * A zero-width domain returns the range start rather than NaN — a NaN in an
 * SVG coordinate makes the element vanish with no error.
 */
export function linear(
  domain: readonly [number, number],
  range: readonly [number, number],
): (value: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  if (span === 0) return () => r0;
  return (value: number) => r0 + ((value - d0) / span) * (r1 - r0);
}

/**
 * Round, human-readable tick values covering [min, max].
 * Steps are constrained to 1, 2, 5 × 10^n — the standard nice-number rule.
 */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) return [min];
  if (min > max) return niceTicks(max, min, count);
  if (!Number.isFinite(count) || count <= 0) return [];

  const rawStep = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalised = rawStep / magnitude;
  const niceStep =
    (normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10) * magnitude;

  // Each tick is computed independently from `first` rather than accumulated,
  // so float error cannot compound across iterations. That in turn means the
  // loop bound is an integer count instead of a float comparison needing a
  // hand-tuned epsilon. toPrecision trims the residue of `first + i * step`.
  const first = Math.ceil(min / niceStep) * niceStep;
  const steps = Math.floor((max - first) / niceStep + 1e-9);

  const ticks: number[] = [];
  for (let i = 0; i <= steps; i += 1) {
    ticks.push(Number((first + i * niceStep).toPrecision(12)));
  }
  return ticks;
}
