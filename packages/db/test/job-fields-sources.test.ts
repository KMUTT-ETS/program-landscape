import { describe, expect, it } from 'vitest';
import { demandSourcesFor } from '@kku/shared';
import { collectRawFieldStrings, latestDemandRunId, refreshMentionCounts } from '../src/job-fields';

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
