// Provenance on program_demand_matches.
//
// WHY THIS EXISTS: all 6,224 rows in this table carried
// ingestion_run_id = NULL, so none passed realDataWhere() and the
// `demand_match_filled` relevance driver read null on all 301 programmes
// despite 285 of them having real AI match analysis behind them.
//
// These rows are AI-derived, not connector-derived, so there is no run of
// "their own" connector to point at — which is why nobody noticed the
// column was never filled. Their real provenance is the demand source
// that supplied the skill set they were matched against.
//
// Third occurrence of this class in the codebase after `tcas` and Google
// Scholar, hence a test rather than a note.

import { describe, expect, it, vi } from 'vitest';

import { resolveDemandProvenanceRunId } from '../../src/program-demand-match/run';

describe('resolveDemandProvenanceRunId', () => {
  it('returns the run id of the demand source that supplied the skill set', async () => {
    const runId = await resolveDemandProvenanceRunId({
      findLatestSucceededRun: (slug) =>
        Promise.resolve(slug === 'kmitl-skill-mapping' ? 'run-kmitl-1' : null),
      demandSourceSlug: 'kmitl-skill-mapping',
    });
    expect(runId).toBe('run-kmitl-1');
  });

  it('returns null rather than inventing a run when the source has none', async () => {
    // A wrong provenance is worse than an absent one: realDataWhere()
    // already treats null as "not real", whereas a fabricated FK would
    // make unreal rows count as real.
    const runId = await resolveDemandProvenanceRunId({
      findLatestSucceededRun: () => Promise.resolve(null),
      demandSourceSlug: 'kmitl-skill-mapping',
    });
    expect(runId).toBeNull();
  });

  it('asks for exactly the slug it was given', async () => {
    const findLatestSucceededRun = vi.fn().mockResolvedValue('run-1');
    await resolveDemandProvenanceRunId({
      findLatestSucceededRun,
      demandSourceSlug: 'jobthai',
    });
    // toHaveBeenCalledExactlyOnceWith is not available in this vitest
    // version; the two assertions together say the same thing.
    expect(findLatestSucceededRun).toHaveBeenCalledTimes(1);
    expect(findLatestSucceededRun).toHaveBeenCalledWith('jobthai');
  });
});
