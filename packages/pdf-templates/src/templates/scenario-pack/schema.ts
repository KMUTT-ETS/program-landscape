import { z } from 'zod';
import { MethodologyBundleSchema } from '../../components/methodology-appendix';

// Scenario Pack — output of the Scenario Planner (prompt 09). Each
// scenario captures an assumption set, simulated outcomes, and the
// narrative explanation. Fleshed out when module 09 lands.
export const ScenarioPackDataSchema = z.object({
  titleTh: z.string(),
  dateLabel: z.string(),
  scopeLabel: z.string().optional(),
  author: z.string().optional(),
  /** Methodology bundle stamp (gap #4) — optional for legacy callers. */
  methodologyBundle: MethodologyBundleSchema.optional(),
  scenarios: z.array(
    z.object({
      id: z.string(),
      nameTh: z.string(),
      assumptions: z.array(z.object({
        label: z.string(),
        value: z.string(),
      })),
      projections: z.array(z.object({
        label: z.string(),
        baseline: z.string(),
        scenario: z.string(),
        delta: z.string().optional(),
      })),
      narrative: z.string(),
    }),
  ),
  caveats: z.array(z.string()).default([]),
});
export type ScenarioPackData = z.infer<typeof ScenarioPackDataSchema>;
