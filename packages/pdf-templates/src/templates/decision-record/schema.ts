import { z } from 'zod';

// Decision Record — formal document capturing a Council decision.
// Fleshed out by prompt 12 (Decision Workspace). This is the paper
// trail that links a Council resolution back to the evidence that
// justified it — critical for audit + future-self questions like
// "why did we close program X in 2026?".
export const DecisionRecordDataSchema = z.object({
  recordNumber: z.string(),           // "DR-2026-012"
  titleTh: z.string(),
  decisionType: z.enum(['CLOSE', 'MERGE', 'LAUNCH', 'RESTRUCTURE', 'KEEP_AS_IS', 'OTHER']),
  councilMeetingDate: z.string(),
  effectiveDate: z.string().optional(),
  scope: z.string(),                  // "หลักสูตรวิศวกรรมคอมพิวเตอร์"
  context: z.string(),
  rationale: z.string(),
  evidence: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      source: z.string(),
      freshnessDate: z.string().optional(),
    }),
  ),
  resolution: z.string(),
  dissentingNotes: z.array(z.string()).default([]),
  followUps: z.array(z.object({
    label: z.string(),
    ownerNameTh: z.string(),
    dueDate: z.string(),
  })).default([]),
  signatories: z.array(z.string()).default([]),
});
export type DecisionRecordData = z.infer<typeof DecisionRecordDataSchema>;
