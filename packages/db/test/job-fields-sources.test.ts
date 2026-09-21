import { describe, expect, it } from 'vitest';
import { demandSourcesFor } from '@kku/shared';
import { collectRawFieldStrings, latestDemandRunId, latestJobThaiScopedRunId, refreshMentionCounts } from '../src/job-fields';

describe('taxonomy source coverage', () => {
  it('collectRawFieldStrings reads both demand sources', () => {
    const sql = collectRawFieldStrings.toString();
    expect(sql).not.toMatch(/jp\.source = 'jobthai'/);
  });

  it('refreshMentionCounts reads both demand sources', () => {
    expect(refreshMentionCounts.toString()).not.toMatch(/jp\.source = 'jobthai'/);
  });

  it('the run anchor is not bound to a single source', () => {
    expect(latestDemandRunId.toString()).not.toMatch(/slug: 'jobthai'/);
  });

  it('both slugs are in the shared vocabulary', () => {
    expect(demandSourcesFor('all')).toEqual(['jobthai', 'job-108']);
  });
});

// Regression for the 2026-09-20 defect: program_jobthai_links (the
// programme <-> occupation bridge) was stamped with a run from an unrelated
// demand source because the caller used the broadened latestDemandRunId()
// instead of a jobthai-scoped lookup. latestJobThaiScopedRunId exists
// specifically so bridge-link callers cannot make that mistake again — pin
// what each function's name actually means so a future reader can trust the
// name instead of re-discovering the defect.
describe('latestJobThaiScopedRunId', () => {
  it('IS bound to the jobthai source specifically — the opposite of latestDemandRunId', () => {
    // Quote-agnostic: the vitest/vite SSR transform re-serializes string
    // literals with double quotes at runtime, unlike the source file's
    // single quotes.
    expect(latestJobThaiScopedRunId.toString()).toMatch(/slug:\s*['"]jobthai['"]/);
  });

  it('is a distinct function from latestDemandRunId, not an alias of it', () => {
    expect(latestJobThaiScopedRunId).not.toBe(latestDemandRunId);
  });
});
