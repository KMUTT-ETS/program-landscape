// ─────────────────────────────────────────────────────────────────────────────
// Phase OV body for programs-pipeline (program-overlap.v1).
//
// Prep runs FIRST, every time. Phase 2b (program-courses-extract) replaces a
// programme's program_courses rows wholesale, which drops descriptionTh,
// learningOutcomesTh and every course embedding. Scoring straight after it
// would read those programmes as undescribed and unembedded — a degraded
// content layer, published as if it were real. runOverlapPrep is idempotent
// and portfolio-wide: it refills descriptions from the approved digests and
// re-embeds only rows whose text hash is null or stale. When nothing changed
// it makes no model call and costs about a second of reads.
// ─────────────────────────────────────────────────────────────────────────────
import type { AiService } from '@kku/shared';
import { runOverlapPrep } from './prep';
import { runOverlapRecommendations, runProgramOverlap } from './run';

export interface OverlapPhaseResult {
  ok: boolean;
  costUsd: number;
  notes: string;
}

/**
 * `programIds` scopes the run (the pairs touching those programmes); omitted,
 * it is a full-portfolio run. Never throws.
 */
export async function runOverlapPhase(ai: AiService, programIds: string[] | undefined): Promise<OverlapPhaseResult> {
  try {
    const prep = await runOverlapPrep(ai, { apply: true });
    const e = prep.embeddings;
    const reEmbedded = e.plos.written + e.courses.written + e.profiles.written;
    const res = await runProgramOverlap({ programIds, apply: true });
    const rec = await runOverlapRecommendations({
      ai,
      runIds: res.map((x) => x.runId).filter((x): x is string => x !== null),
    });
    const prepNote =
      `prep: ${prep.courseDescriptions.coursesUpdated} description(s) refilled, ${reEmbedded} vector(s) re-embedded`;
    const notes =
      res.length === 0
        ? `${prepNote} · skipped: no canonical programme to compare`
        : `${prepNote} · ${res.length} run(s) · ${res.reduce((n, x) => n + x.scored, 0)} pairs scored, ` +
          `${res.reduce((n, x) => n + x.stored, 0)} stored · recommendations ${rec.written} written / ` +
          `${rec.skipped} skipped / ${rec.failed} failed`;
    return { ok: true, costUsd: e.costUsd + rec.costUsd, notes };
  } catch (err) {
    return { ok: false, costUsd: 0, notes: `failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}
