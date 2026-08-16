/**
 * Cohort-change formatting for the demographic surfaces.
 *
 * `cohortDeclinePct` is `((anchor - population) / anchor) * 100`, so it is
 * POSITIVE when the cohort shrinks and NEGATIVE when it grows. Both are
 * reachable: the anchor is the current year, and a later year can exceed it.
 *
 * Every site that formatted this by hand got it wrong in one of three ways —
 * collapsing growth to '0.0%', prefixing '−' unconditionally (rendering
 * '−-2.3%'), or hiding growth entirely behind a `> 0` guard. Route all of
 * them through here.
 *
 * NOTE: this duplicates `formatCohortChangePct` in
 * `apps/api/src/programs/program-detail-data.ts`. It is deliberate, not an
 * oversight: `@kku/shared` has no exports map, so any import of it resolves
 * through a barrel that pulls in `node:crypto` and breaks client components
 * (see the `kku-shared-barrel-client` project memory). Sharing twelve lines
 * is not worth adding an exports map to a package the whole monorepo depends
 * on. If these two ever diverge, that is a bug.
 */
export function formatCohortChangePct(declinePct: number): string {
  if (!Number.isFinite(declinePct)) return '—';
  // Round first, so a value like -0.04 does not render as '+0.0%'.
  const rounded = Number(declinePct.toFixed(1));
  if (rounded === 0) return '0.0%';
  return rounded > 0
    ? `−${rounded.toFixed(1)}%` // shrinking
    : `+${Math.abs(rounded).toFixed(1)}%`; // growing
}

/**
 * Width for a contraction meter, as a percentage string.
 *
 * Clamped to [0, 100]: a growing cohort yields a negative contraction, and a
 * negative CSS width is invalid — the bar silently collapses rather than
 * reading as "no contraction". Growth is genuinely zero contraction, so an
 * empty bar is the honest rendering.
 */
export function contractionMeterWidth(declinePct: number): string {
  if (!Number.isFinite(declinePct)) return '0%';
  return `${Math.max(0, Math.min(100, declinePct))}%`;
}
