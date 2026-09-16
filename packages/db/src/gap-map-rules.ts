import { z } from 'zod';
import { JOBTHAI_MIN_POSTINGS_FOR_SIGNAL } from './jobthai-bridge';

// ─────────────────────────────────────────────────────────────────────────────
// Gap-map rules — pure functions behind `gap-map.v1` (docs/methodologies/
// gap-map.md). No database, no Date.now: every input is explicit so the
// verdict on a row is reproducible from the numbers shown beside it.
// ─────────────────────────────────────────────────────────────────────────────

export const GAP_MAP_VERSION = 'gap-map.v1';

export type GapVerdict = 'white-space' | 'under-served' | 'served' | 'over-served' | 'too-few-postings';
export const GAP_VERDICTS: readonly GapVerdict[] = ['white-space', 'under-served', 'served', 'over-served', 'too-few-postings'];

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

/** Share-vs-share rule (spec §2 decision 3). Shares are fractions (0..1). */
export function verdictFor(args: {
  postings: number;
  programmes: number;
  demandShare: number;
  supplyShare: number;
  thresholds: GapThresholds;
}): { ratio: number | null; verdict: GapVerdict } {
  if (args.programmes === 0) return { ratio: null, verdict: 'white-space' };
  const raw = args.demandShare > 0 ? args.supplyShare / args.demandShare : null;
  const ratio = raw == null ? null : Math.round(raw * 100) / 100;
  if (args.postings < JOBTHAI_MIN_POSTINGS_FOR_SIGNAL) return { ratio, verdict: 'too-few-postings' };
  if (raw == null) return { ratio, verdict: 'too-few-postings' };
  if (raw < args.thresholds.under) return { ratio, verdict: 'under-served' };
  if (raw > args.thresholds.over) return { ratio, verdict: 'over-served' };
  return { ratio, verdict: 'served' };
}

export type PipelineArrow = 'up' | 'down' | 'flat';

/** Pipeline ÷ 4 (a nominal four-year intake) against graduates per year. */
export function pipelineArrow(gradsPerYear: number | null, pipeline: number | null): PipelineArrow | null {
  if (gradsPerYear == null || pipeline == null || gradsPerYear <= 0) return null;
  const perYear = pipeline / 4;
  if (perYear > 1.25 * gradsPerYear) return 'up';
  if (perYear < 0.75 * gradsPerYear) return 'down';
  return 'flat';
}

export interface Reconciliation {
  demandShareSum: number;
  supplyShareSum: number;
  multiFieldProgrammes: number;
  gradsTotal: number;
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
    gradsTotal: totals.fieldGraduates,
  };
}
