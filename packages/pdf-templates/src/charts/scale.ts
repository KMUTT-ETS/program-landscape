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

  const rawStep = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalised = rawStep / magnitude;
  const niceStep =
    (normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10) * magnitude;

  const ticks: number[] = [];
  const first = Math.ceil(min / niceStep) * niceStep;
  // Epsilon guards against float drift dropping the final tick.
  for (let v = first; v <= max + niceStep * 1e-9; v += niceStep) {
    ticks.push(Number(v.toPrecision(12)));
  }
  return ticks;
}
