import { z } from 'zod';
import { MethodologyBundleSchema } from '../../components/methodology-appendix';

// Annual Strategic Review Council Pack — once a year. Longer form; covers
// BCG + S-curve alignment, major decisions concluded this year, outcome
// reviews, and forward-looking priorities. Prompt 12 deliverable.
export const AnnualStrategicReviewDataSchema = z.object({
  yearLabel: z.string(), // e.g. "2569"
  dateLabel: z.string(),
  author: z.string().optional(),
  /** Methodology bundle stamp (gap #4) — optional for legacy callers. */
  methodologyBundle: MethodologyBundleSchema.optional(),
  executiveSummaryTh: z.string(),
  sectorAlignment: z.array(
    z.object({
      sectorCode: z.string(),
      nameTh: z.string(),
      family: z.string(),
      demandIndex: z.number(),
      supplyIndex: z.number(),
      gap: z.number(),
      narrativeTh: z.string(),
    }),
  ),
  majorDecisions: z.array(
    z.object({
      title: z.string(),
      decisionType: z.string(),
      status: z.string(),
      effectiveDate: z.string().nullable(),
      councilSessionRef: z.string().nullable(),
      rationaleTh: z.string().nullable(),
    }),
  ),
  outcomeReviews: z.array(
    z.object({
      decisionTitle: z.string(),
      horizon: z.string(),
      narrativeTh: z.string(),
      whatWorkedTh: z.array(z.string()),
      whatDidntWorkTh: z.array(z.string()),
      lessonsTh: z.array(z.string()),
    }),
  ),
  forwardPrioritiesTh: z.array(z.string()),
  caveats: z.array(z.string()).default([]),
});
export type AnnualStrategicReviewData = z.infer<typeof AnnualStrategicReviewDataSchema>;
