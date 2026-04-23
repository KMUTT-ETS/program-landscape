import { z } from 'zod';

// Quarterly Review Council Pack — a standing agenda item for Council
// sessions. Portfolio health + key trends + scenario pipeline + decision
// pipeline in a consistent quarterly shape. Prompt 12 deliverable.
export const QuarterlyReviewDataSchema = z.object({
  quarterLabel: z.string(), // e.g. "Q2 2569"
  dateLabel: z.string(),
  author: z.string().optional(),
  // 3-5 headline stats for the cover strip.
  headlineMetrics: z.array(
    z.object({ labelTh: z.string(), value: z.string(), changeFromLastQuarter: z.string().optional() }),
  ),
  portfolioSummary: z.object({
    narrativeTh: z.string(),
    programsAtRisk: z.array(
      z.object({
        code: z.string(),
        nameTh: z.string(),
        overallScore: z.number().nullable(),
        reason: z.string(),
      }),
    ),
    programsStrong: z.array(
      z.object({
        code: z.string(),
        nameTh: z.string(),
        overallScore: z.number().nullable(),
        highlight: z.string(),
      }),
    ),
  }),
  trendsDigest: z.array(
    z.object({
      signalType: z.string(),
      title: z.string(),
      summaryTh: z.string(),
      impactScore: z.number().min(0).max(1),
      detectedDate: z.string(),
    }),
  ),
  scenarioPipeline: z.array(
    z.object({
      name: z.string(),
      type: z.string(),
      workflowStatus: z.string(),
      affectedProgramsCount: z.number().int(),
    }),
  ),
  decisionPipeline: z.array(
    z.object({
      title: z.string(),
      decisionType: z.string(),
      status: z.string(),
      effectiveDate: z.string().nullable(),
    }),
  ),
  caveats: z.array(z.string()).default([]),
});
export type QuarterlyReviewData = z.infer<typeof QuarterlyReviewDataSchema>;
