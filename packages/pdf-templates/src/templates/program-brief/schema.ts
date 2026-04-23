import { z } from 'zod';

// One-pager-to-four-pager brief for a single program. Filled in by
// prompt 06 (Program Deep-Dive). This schema captures the minimum a
// Council member needs: identity, current health, trajectory, risks.
export const ProgramBriefDataSchema = z.object({
  programCode: z.string(),
  programNameTh: z.string(),
  programNameEn: z.string(),
  facultyNameTh: z.string(),
  departmentNameTh: z.string().optional(),
  level: z.enum(['BACHELOR', 'MASTER', 'DOCTORAL']),
  dateLabel: z.string(),
  // A single paragraph — Thai — summarising the program's current
  // strategic position. AI-authored with human review.
  summary: z.string(),
  keyMetrics: z.array(
    z.object({
      label: z.string(),
      value: z.string(),
      delta: z.string().optional(),
      sentiment: z.enum(['positive', 'neutral', 'negative']).optional(),
    }),
  ),
  risks: z.array(z.string()).default([]),
  recommendations: z.array(z.string()).default([]),
  sources: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      freshnessDate: z.string().optional(),
    }),
  ).default([]),
});
export type ProgramBriefData = z.infer<typeof ProgramBriefDataSchema>;
