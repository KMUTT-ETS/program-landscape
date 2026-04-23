import { z } from 'zod';

// Faculty-Level Review — scoped Council Pack for a single faculty.
// Used for deans + faculty councils. Narrower than the university-wide
// pack; focused on the faculty's own programs, trends, and risks.
// Prompt 12 deliverable.
export const FacultyLevelReviewDataSchema = z.object({
  facultyNameEn: z.string(),
  facultyNameTh: z.string(),
  dateLabel: z.string(),
  author: z.string().optional(),
  summaryTh: z.string(),
  programSnapshot: z.array(
    z.object({
      code: z.string(),
      nameTh: z.string(),
      level: z.string(),
      healthScore: z.number().nullable(),
      dataCompletenessPct: z.number().nullable(),
      latestGraduates: z.number().int().nullable(),
      trendCount: z.number().int(),
    }),
  ),
  trendHighlights: z.array(
    z.object({
      signalType: z.string(),
      title: z.string(),
      summaryTh: z.string(),
      impactScore: z.number(),
    }),
  ),
  risksTh: z.array(z.string()),
  opportunitiesTh: z.array(z.string()),
  recommendedActionsTh: z.array(z.string()),
  caveats: z.array(z.string()).default([]),
});
export type FacultyLevelReviewData = z.infer<typeof FacultyLevelReviewDataSchema>;
