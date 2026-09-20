import { describe, expect, it } from 'vitest';

import { SOURCE_CATALOG } from '../../src/ingestion/catalog';

describe('jobthai catalog entry', () => {
  const entry = SOURCE_CATALOG.find((s) => s.slug === 'jobthai');

  it('exists', () => {
    expect(entry).toBeDefined();
  });

  it('is no longer deprecated — the 2026-05-01 supersession assumed a paid API we never bought', () => {
    expect(entry!.deprecated).toBeUndefined();
  });

  it('is a real XLSX file source, with status and mocked flipped together', () => {
    // prisma/seed.ts writes BOTH `status` and `mocked` from this field on
    // every seed, so a stale `mocked: true` would make realDataWhere()
    // silently discard every row the connector ever loaded. They must never
    // diverge — see the data_sources drift audit.
    expect(entry!.mocked).toBe(false);
    expect(entry!.kind).toBe('CSV');
    expect(entry!.inputFormat).toBe('XLSX');
  });

  it('is not scheduled — files arrive by hand', () => {
    // A six-hourly cron would wake a connector with nothing to do.
    expect(entry!.scheduleEnabled).toBe(false);
  });

  it('states the geography and postgraduate caveats in its notes', () => {
    // These numbers travel with the source everywhere it is documented, so
    // nobody reads a Bangkok-weighted national dataset as a picture of Isan.
    expect(entry!.notes).toMatch(/3\.3%/);
    expect(entry!.notes).toMatch(/0\.8%/);
  });

  it('leaves jobsdb deprecated', () => {
    const jobsdb = SOURCE_CATALOG.find((s) => s.slug === 'jobsdb');
    expect(jobsdb!.deprecated).toBe(true);
  });
});

describe('job-108 catalog entry', () => {
  const entry = SOURCE_CATALOG.find((s) => s.slug === 'job-108');

  // mocked must be false now that the connector is registered: realDataWhere()
  // excludes every row whose ingestion run traces to a mocked source, so a
  // mocked job-108 would write postings the Gap Analyzer cannot see — no
  // error, just an empty page. That failure has happened three times here.
  it('is real and scheduled, now that the connector is registered', () => {
    expect(entry?.mocked).toBe(false);
    expect(entry?.scheduleEnabled).toBe(true);
    expect(entry?.cadenceCron).toBe('0 3 * * 1');
  });

  // The connector reads HTML pages it fetches itself, not a file drop. If
  // either of these changes, the connector's shape changed and the catalog
  // was not updated with it.
  it('is a scraped HTML source', () => {
    expect(entry?.kind).toBe('SCRAPE');
    expect(entry?.inputFormat).toBe('HTML');
  });
});
