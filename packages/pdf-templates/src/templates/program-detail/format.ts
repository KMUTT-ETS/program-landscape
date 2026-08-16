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

// The em dash used everywhere in this template for "no data". Never '0',
// never the literal string 'null' — see the null-handling rule at the top
// of schema.ts: a null score means the methodology deliberately excluded
// a dimension from the average (or a section's data hasn't arrived yet),
// and this document is used to close programs, so a substituted `0` would
// assert a measured value that was never taken.
const EM_DASH = '—';

// Cover, and every section after it, renders a 0-100 methodology score
// (health dimension score, lifecycle trajectory score, AI-readiness
// score, ...). One helper, used everywhere a raw score becomes cover/
// stat-block/appendix text, so the null convention can't drift section
// to section.
export function formatScore(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return EM_DASH;
  return String(Math.round(value));
}

// A 0-100 scale percentage (data completeness, fill rate, employment
// rate, ...). `decimals` defaults to whole points — most percentages in
// this report are integer-rounded upstream already; pass 1 for the rarer
// case (e.g. a competition ratio) that wants one decimal place.
export function formatPct(value: number | null, decimals = 0): string {
  if (value === null || !Number.isFinite(value)) return EM_DASH;
  return `${value.toFixed(decimals)}%`;
}

// A plain count (headcount, applicants, students) with thousands
// separators. Deliberately NOT used for years (`yearEstablished`,
// cohort years) — `toLocaleString` would insert a comma into "2005".
export function formatCount(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return EM_DASH;
  return Math.round(value).toLocaleString('en-US');
}
