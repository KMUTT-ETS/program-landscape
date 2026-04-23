import { z } from 'zod';

// Gap Report — per-region or per-sector narrative with top gap rows,
// forecast bands, and a Thai brief. Generated from the Gap Analyzer
// (prompt 08). The PDF is NOT a replacement for the live Analyzer; it's
// a snapshot that Council can cite in meetings.

export const GapReportDataSchema = z.object({
  dateLabel: z.string(),
  // What this report is scoped to.
  reportKind: z.enum(['region', 'sector', 'university']),
  scopeLabel: z.string(),
  region: z.string().optional(),
  sectorCode: z.string().optional(),
  author: z.string().optional(),

  // Summary narrative (Thai primary).
  narrativeTh: z.string(),
  narrativeEn: z.string().optional(),

  // Headline stats shown at the top as a 3-column strip.
  headlineMetrics: z.array(
    z.object({
      labelTh: z.string(),
      value: z.string(),
    }),
  ).default([]),

  // Top skill-gap rows.
  topSkillGaps: z.array(
    z.object({
      nameEn: z.string(),
      nameTh: z.string(),
      demand: z.number(),
      supply: z.number(),
      gap: z.number(),
      notes: z.string().optional(),
    }),
  ).default([]),

  // Top sector rows (if sector-level or university-level).
  topSectors: z.array(
    z.object({
      sectorCode: z.string(),
      nameEn: z.string(),
      nameTh: z.string(),
      family: z.string(),
      demand: z.number(),
      supply: z.number(),
      gap: z.number(),
      trend: z.enum(['growing', 'shrinking', 'flat']),
    }),
  ).default([]),

  // Forecast snapshot — up to 6 forecast runs to show alongside the gap tables.
  forecastSnapshots: z.array(
    z.object({
      subjectLabel: z.string(),
      kind: z.enum(['DEMAND', 'SUPPLY']),
      targetYear: z.number().int(),
      projected: z.number(),
      ci80Low: z.number(),
      ci80High: z.number(),
    }),
  ).default([]),

  // Provenance footer — mandatory per Council-readiness rules.
  provenance: z.object({
    methodologyVersion: z.string(),
    sources: z.array(z.string()),
    confidence: z.number().min(0).max(1),
    caveats: z.array(z.string()).default([]),
  }),
});
export type GapReportData = z.infer<typeof GapReportDataSchema>;
