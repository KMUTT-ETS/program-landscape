// Render-time formatting helpers for the program-detail template.
//
// `formatCohortChangePct` used to live in
// `apps/api/src/programs/program-detail-data.ts` and was called from the
// data builder to pre-format `demographic.fifteenYearContraction` and
// `demographic.projections[].decline` into display strings before they
// reached the schema. Once those two fields became raw numbers
// (`z.number().finite().nullable()`), formatting moved to render time —
// the template calls this directly against the raw signed number instead.
//
// NOTE: `apps/web/src/lib/format-cohort.ts` carries an intentional
// duplicate of this same function for the interactive deep-dive + print
// view. That duplication is deliberate (see that file's comment —
// `@kku/shared` has no exports map, and importing it from a client
// component pulls in `node:crypto` via the barrel). If these two ever
// diverge, that is a bug — keep them in sync by hand.
export function formatCohortChangePct(declinePct: number): string {
  if (!Number.isFinite(declinePct)) return '—';
  // Round first, so a value like -0.04 does not render as '+0.0%'.
  const rounded = Number(declinePct.toFixed(1));
  if (rounded === 0) return '0.0%';
  return rounded > 0
    ? `−${rounded.toFixed(1)}%` // shrinking
    : `+${Math.abs(rounded).toFixed(1)}%`; // growing
}
