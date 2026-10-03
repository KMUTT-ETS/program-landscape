// program-overlap.v1 — defensive parse of a stored ProgramOverlapPair.evidenceJson.
// Pure (zod only, no Prisma): shared by the read models and the ingestion
// recommendation runner, which must never cast stored JSON to PairEvidence.
import { z } from 'zod';
import type { PairEvidence } from './score';

const PairEvidenceSchema = z.object({
  sharedCourses: z.array(z.object({ code: z.string(), credits: z.number(), nameTh: z.string().nullable() })),
  equivalentCourses: z.array(
    z.object({
      codeA: z.string(),
      codeB: z.string(),
      nameA: z.string().nullable(),
      nameB: z.string().nullable(),
      credits: z.number(),
      similarity: z.number(),
      basis: z.enum(['description', 'name']),
    }),
  ),
  matchedPlos: z.array(
    z.object({ ordinalA: z.number(), ordinalB: z.number(), textA: z.string(), textB: z.string(), similarity: z.number() }),
  ),
  unmatchedPlosA: z.array(z.string()),
  unmatchedPlosB: z.array(z.string()),
  coverage: z.object({
    majorCoursesA: z.number(),
    majorCoursesB: z.number(),
    embeddedA: z.number(),
    embeddedB: z.number(),
    describedA: z.number(),
    describedB: z.number(),
    descriptionMatches: z.number(),
    plosA: z.number(),
    plosB: z.number(),
    defaultedCredits: z.number(),
    // Added by D9 (2026-10-03): evidence stored by an earlier run lacks it and
    // parses as null — re-run program-overlap.
    courseLayers: z.number(),
  }),
}) satisfies z.ZodType<PairEvidence>;

/** Defensive parse of a stored evidenceJson; null when it does not match. */
export function parsePairEvidence(json: unknown): PairEvidence | null {
  const r = PairEvidenceSchema.safeParse(json);
  return r.success ? r.data : null;
}
