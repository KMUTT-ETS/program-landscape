import { z } from 'zod';
import { DEFAULT_DEMAND_BASIS, DEFAULT_PUBLIC_WINDOW_MONTHS, DEMAND_BASES, type DemandBasis } from '@kku/shared';
import { JOBTHAI_MIN_POSTINGS_FOR_SIGNAL } from './jobthai-bridge';

// ─────────────────────────────────────────────────────────────────────────────
// Gap-map rules — pure functions behind `gap-map.v2` (docs/methodologies/
// gap-map.md). No database, no Date.now: every input is explicit so the
// verdict on a row is reproducible from the numbers shown beside it.
// ─────────────────────────────────────────────────────────────────────────────

export const GAP_MAP_VERSION = 'gap-map.v2';

export type GapVerdict =
  | 'white-space'
  | 'under-served'
  | 'served'
  | 'over-served'
  | 'supply-unknown'
  | 'too-few-postings';
export const GAP_VERDICTS: readonly GapVerdict[] = [
  'white-space',
  'under-served',
  'served',
  'over-served',
  'supply-unknown',
  'too-few-postings',
];

export interface GapThresholds {
  /** ratio strictly below this → under-served */
  under: number;
  /** ratio strictly above this → over-served */
  over: number;
}
export const DEFAULT_GAP_THRESHOLDS: GapThresholds = { under: 0.5, over: 2 };

export const ThresholdsSchema = z
  .object({
    under: z.coerce.number().positive().default(DEFAULT_GAP_THRESHOLDS.under),
    over: z.coerce.number().positive().default(DEFAULT_GAP_THRESHOLDS.over),
  })
  .refine((t) => t.under < t.over, { message: 'under must be less than over' });

/** From URL / query strings. Throws on 0 < under < over violations. */
export function parseThresholds(q: { under?: string | number; over?: string | number }): GapThresholds {
  return ThresholdsSchema.parse(q);
}

export interface DemandBasisOptions {
  /** Which source(s) form the demand denominator. See `@kku/shared/demand/sources`. */
  basis: DemandBasis;
  /** How many months back a `public` (job-108) posting counts. Ignored under
   *  `private` — JobThai postings carry no real date to window against. */
  publicWindowMonths: number;
}

export const DemandBasisSchema = z.object({
  basis: z.enum(DEMAND_BASES).default(DEFAULT_DEMAND_BASIS),
  publicWindowMonths: z.coerce.number().int().positive().default(DEFAULT_PUBLIC_WINDOW_MONTHS),
});

/** Same shape as `DemandBasisSchema`, but `publicWindowMonths` carries NO
 *  default — it stays `undefined` when the caller's query string doesn't
 *  specify one. Route query schemas that `.and()` this (instead of
 *  `DemandBasisSchema`) let `parseDemandBasis`'s own
 *  `defaultPublicWindowMonths` option (the operator-configured
 *  `job108.defaultWindowMonths` setting) supply the fallback — composing
 *  `DemandBasisSchema` directly would apply Zod's built-in default first,
 *  so the field would never reach `parseDemandBasis` as `undefined` and
 *  the stored setting could never win. See gap.controller.ts's `MapQuery`. */
export const DemandBasisQuerySchema = DemandBasisSchema.extend({
  publicWindowMonths: z.coerce.number().int().positive().optional(),
});

/**
 * From URL / query strings. Throws on an unrecognised basis rather than
 * falling back to the default — a shared link carrying a typo (e.g.
 * `?basis=government`) should fail visibly rather than quietly render a
 * different denominator under the same `gap-map.v2` methodology stamp.
 *
 * Precedence on `publicWindowMonths`: explicit `q.publicWindowMonths` →
 * `opts.defaultPublicWindowMonths` (the operator-configured stored
 * setting, when the caller supplies one) → `DEFAULT_PUBLIC_WINDOW_MONTHS`
 * (Zod's `.default()` on `DemandBasisSchema`, applied last). Every
 * existing caller that doesn't pass `opts` keeps exactly its old
 * behaviour — this only changes what happens when `q.publicWindowMonths`
 * is `undefined` AND a caller opts in to a different fallback.
 */
export function parseDemandBasis(
  q: { basis?: string; publicWindowMonths?: string | number },
  opts?: { defaultPublicWindowMonths?: number },
): DemandBasisOptions {
  const withStoredDefault =
    q.publicWindowMonths === undefined && opts?.defaultPublicWindowMonths !== undefined
      ? { ...q, publicWindowMonths: opts.defaultPublicWindowMonths }
      : q;
  return DemandBasisSchema.parse(withStoredDefault);
}

/** The earliest `posted_date` that counts under a public-basis window of
 *  `months`, measured back from `now`. Calendar-month arithmetic (not a
 *  fixed day count) so "12 months" means "this date last year" whatever the
 *  month lengths in between. */
export function publicWindowStart(now: Date, months: number): Date {
  const d = new Date(now.getTime());
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
}

/** Share-vs-share rule (spec §2 decision 3). Shares are fractions (0..1).
 *
 * `scoredWithSupply` is the count of SCORED programmes that carry a supply
 * figure (alumni or enrolment-proxy) — distinct from `programmes`, which
 * counts scored programmes whether or not any of them have a number. A
 * field with programmes but none of them measured is not a "measured
 * zero" ratio; it is a data gap, and gets no ratio at all (health-score's
 * null-handling rule: missing metrics are excluded, never read as 0). */
export function verdictFor(args: {
  postings: number;
  programmes: number;
  scoredWithSupply: number;
  demandShare: number;
  supplyShare: number;
  thresholds: GapThresholds;
}): { ratio: number | null; verdict: GapVerdict } {
  if (args.programmes === 0) return { ratio: null, verdict: 'white-space' };
  if (args.scoredWithSupply === 0) return { ratio: null, verdict: 'supply-unknown' };
  const raw = args.demandShare > 0 ? args.supplyShare / args.demandShare : null;
  const ratio = raw == null ? null : Math.round(raw * 100) / 100;
  if (args.postings < JOBTHAI_MIN_POSTINGS_FOR_SIGNAL) return { ratio, verdict: 'too-few-postings' };
  if (raw == null) return { ratio, verdict: 'too-few-postings' };
  if (raw < args.thresholds.under) return { ratio, verdict: 'under-served' };
  if (raw > args.thresholds.over) return { ratio, verdict: 'over-served' };
  return { ratio, verdict: 'served' };
}

export type PipelineArrow = 'up' | 'down' | 'flat';

/** Nominal length of study, per level, when `Program.durationYears` is null.
 *
 *  Each value is the modal observed duration at that level on the KKU record
 *  (bachelor 96 of 102 at 4 years, master 107 of 110 at 2, doctoral 52 of 63
 *  at 3, higher graduate diploma 8 of 11 at 2). A four-year default for every
 *  level was wrong in one direction for all three postgraduate ones: all 16
 *  programmes with a null duration on dev are Master's, Doctoral or Higher
 *  Graduate Diploma, and reading a two-year Master's as four halves its
 *  annualised intake and throws its cohort window two years out. */
export const NOMINAL_DURATION_YEARS: Readonly<Record<string, number>> = {
  BACHELOR: 4,
  MASTER: 2,
  DOCTORAL: 3,
  HIGHER_GRAD_DIPLOMA: 2,
};
/** For a level outside the enum — four years, the commonest degree here. */
export const NOMINAL_DURATION_FALLBACK = 4;

/** The length of study a programme is read as having: its own if recorded,
 *  otherwise the nominal figure for its level. Never a global constant. */
export function durationYearsFor(level: string, durationYears: number | null): number {
  if (durationYears != null && durationYears > 0) return durationYears;
  return NOMINAL_DURATION_YEARS[level] ?? NOMINAL_DURATION_FALLBACK;
}

/** Annualised intake: Σ over programmes of enrolled students ÷ THAT
 *  programme's own length of study.
 *
 *  A programme holds one cohort per year of study at once, so the yearly
 *  intake behind a pipeline figure is `enrolled ÷ duration`. Dividing a
 *  field's summed pipeline by a nominal four overstates a six-year
 *  programme's intake by half — which is exactly how Pharmacy and
 *  Veterinary Medicine came to read "rising" against a steady intake.
 *
 *  Null when no programme carries a pipeline figure at all: an absent
 *  measurement, never a zero intake. */
export function annualisedIntake(
  programmes: ReadonlyArray<{ pipeline: number | null; durationYears: number | null; level: string }>,
): number | null {
  let total = 0;
  let measured = 0;
  for (const p of programmes) {
    if (p.pipeline == null) continue;
    measured += 1;
    total += p.pipeline / durationYearsFor(p.level, p.durationYears);
  }
  return measured === 0 ? null : total;
}

/** Annualised intake against graduates per year, at ±25 %. Both sides are
 *  per-year quantities, so the comparison is like for like whatever the
 *  programmes' lengths — see `annualisedIntake` for the divisor. */
export function pipelineArrow(gradsPerYear: number | null, annualIntake: number | null): PipelineArrow | null {
  if (gradsPerYear == null || annualIntake == null || gradsPerYear <= 0) return null;
  if (annualIntake > 1.25 * gradsPerYear) return 'up';
  if (annualIntake < 0.75 * gradsPerYear) return 'down';
  return 'flat';
}

export interface Reconciliation {
  demandShareSum: number;
  supplyShareSum: number;
  multiFieldProgrammes: number;
  /** Σ_f grads_f over SCORED programmes — the supply denominator. Named
   *  for what it sums over (fields, not distinct programmes): a
   *  two-field programme's graduates are counted twice, once per field
   *  it is assigned to, matching `fieldMentions` on the demand side. */
  fieldGraduatesTotal: number;
}

/** The line under the table. Both sides are normalised by the sum over
 *  fields of their own numerators — `fieldMentions` = Σ_f postings_f (a
 *  posting naming k fields counts k times) and `fieldGraduates` = Σ_f grads_f
 *  (a programme in two fields counts in both) — so each share set sums to 1
 *  and the ratio carries no bias. The sums are recomputed here from the rows
 *  as a check that the per-row numerators and the denominators agree. */
export function reconcile(
  rows: Array<{ postings: number; programmeIds: string[]; gradsPerYear: number }>,
  totals: { fieldMentions: number; fieldGraduates: number },
): Reconciliation {
  const seen = new Map<string, number>();
  for (const r of rows) for (const id of r.programmeIds) seen.set(id, (seen.get(id) ?? 0) + 1);
  return {
    demandShareSum: totals.fieldMentions > 0 ? rows.reduce((a, r) => a + r.postings, 0) / totals.fieldMentions : 0,
    supplyShareSum: totals.fieldGraduates > 0 ? rows.reduce((a, r) => a + r.gradsPerYear, 0) / totals.fieldGraduates : 0,
    multiFieldProgrammes: [...seen.values()].filter((n) => n > 1).length,
    fieldGraduatesTotal: totals.fieldGraduates,
  };
}
