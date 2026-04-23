import { z } from 'zod';

// Council Pack — the master export format. A Council Pack is a bundle
// of analytical sections curated for a particular Council agenda item.
// Structure:
//   1. Cover (title, scope, date)
//   2. Executive summary (AI-generated Thai prose + key takeaways)
//   3. Body sections (caller-supplied)
//   4. Methodology & provenance appendix
//
// The body sections are intentionally typed as `{ title, html }` rather
// than module-specific shapes — each module builds its own body HTML and
// drops it into this outer template. Keeps the template stable even as
// module internals change.

export const CouncilPackSectionSchema = z.object({
  title: z.string(),
  // Raw HTML. The calling module is responsible for producing it; this
  // template renders it unescaped via dangerouslySetInnerHTML. A small
  // denormalisation, but the alternative — passing React elements
  // through the Zod parser — doesn't work because Zod erases the
  // element type at the schema boundary.
  html: z.string(),
});
export type CouncilPackSection = z.infer<typeof CouncilPackSectionSchema>;

export const CouncilPackProvenanceSchema = z.object({
  id: z.string(),
  label: z.string(),
  source: z.string(),
  freshnessDate: z.string().optional(),
  url: z.string().url().optional(),
  methodologyVersion: z.string().optional(),
  note: z.string().optional(),
});
export type CouncilPackProvenance = z.infer<typeof CouncilPackProvenanceSchema>;

export const CouncilPackDataSchema = z.object({
  titleTh: z.string(),
  titleEn: z.string().optional(),
  scopeLabel: z.string().optional(),    // "คณะวิศวกรรมศาสตร์" etc.
  dateLabel: z.string(),                // "22 เมษายน 2569"
  author: z.string().optional(),
  version: z.string().optional(),
  executiveSummary: z.object({
    paragraphs: z.array(z.string()).min(1),
    keyTakeaways: z.array(z.string()).default([]),
    confidence: z.number().min(0).max(1).optional(),
  }),
  sections: z.array(CouncilPackSectionSchema),
  provenance: z.array(CouncilPackProvenanceSchema).default([]),
  confidentialityLabel: z.string().default('ลับ — สำหรับการประชุมสภาเท่านั้น'),
});
export type CouncilPackData = z.infer<typeof CouncilPackDataSchema>;
