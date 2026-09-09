import { describe, expect, it, vi, beforeEach } from 'vitest';

// ────────────────────────────────────────────────────────────────────────────
// The SCHOLAR_FETCH queue handler.
//
// The rule under test is the one that is easy to get wrong and invisible when
// wrong: `runScholarFetch` RETURNS its refusals ("no staff record", "quota
// exhausted", "needs binding") rather than throwing them. A handler that
// simply awaits it and returns SUCCEEDED would leave a completed, green job
// whose only evidence that nothing happened is a ledger row nobody reads.
// ────────────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  runScholarFetch: vi.fn(),
  fetchScrapingBeePage: vi.fn(),
  scholarFetchRunCreate: vi.fn(),
}));

vi.mock('@kku/db', () => ({
  prisma: {
    scholarFetchRun: { create: mocks.scholarFetchRunCreate },
  },
  Prisma: {},
  refreshAiModelCatalog: vi.fn(),
  runScholarFetch: mocks.runScholarFetch,
}));

// The transport lives on its own subpath, NOT the barrel — mocking
// '@kku/shared' alone leaves the real HTTP client in place, which then makes a
// live ScrapingBee call (it 401s on the test key, but with a valid key it would
// spend real credits). See packages/shared/test/scholar-barrel-graph.test.ts.
vi.mock('@kku/shared/src/scholar/scrapingbee', async () => {
  // Only the network call is stubbed. `configFromEnv` stays REAL because
  // several tests exercise the misconfiguration path and rely on it throwing
  // ScrapingBeeConfigError when the key is absent.
  const actual = await vi.importActual<typeof import('@kku/shared/src/scholar/scrapingbee')>('@kku/shared/src/scholar/scrapingbee');
  return { ...actual, fetchScrapingBeePage: mocks.fetchScrapingBeePage };
});

vi.mock('@kku/shared', async () => {
  const actual = await vi.importActual<typeof import('@kku/shared')>('@kku/shared');
  return { ...actual, fetchScrapingBeePage: mocks.fetchScrapingBeePage };
});

import { buildHandlers } from '../src/ai-jobs/handlers';
import type { AiService } from '@kku/shared';

const handlers = buildHandlers({
  ai: {} as AiService,
  autoApproveThreshold: 0,
});

const BASE_RESULT = {
  runId: 'run-1',
  reason: null as string | null,
  retryAt: null,
  papersFound: 0,
  papersInserted: 0,
  citationsUpdated: 0,
  papersSkippedNoYear: 0,
  creditsUsed: 0,
  searchQuery: 'Somchai Example',
};

const JOB = {
  entityId: 'target-user',
  trigger: 'MANUAL' as const,
  triggeredByUserId: 'actor-user',
  scholarTrigger: 'SELF' as const,
  scholarActorRole: 'FACULTY_USER' as const,
};

beforeEach(() => {
  mocks.runScholarFetch.mockReset();
  mocks.fetchScrapingBeePage.mockReset();
  mocks.scholarFetchRunCreate.mockReset();
  mocks.scholarFetchRunCreate.mockResolvedValue({ id: 'run-cfg' });
  process.env.SCRAPINGBEE_API_KEY = 'test-key';
});

describe('SCHOLAR_FETCH handler — refusals are distinguishable', () => {
  it('reports a needs-binding refusal as SKIPPED, carrying the machine code through', async () => {
    mocks.runScholarFetch.mockResolvedValue({
      ...BASE_RESULT,
      status: 'REFUSED',
      reason: 'needs-binding',
    });

    const outcome = await handlers.SCHOLAR_FETCH(JOB);

    expect(outcome.status).toBe('SKIPPED');
    expect(outcome.status).not.toBe('SUCCEEDED');
    expect(outcome.message).toContain('needs-binding');
    expect(outcome.message).toContain('run-1');
  });

  it('reports a quota refusal as SKIPPED with the reason a person can act on', async () => {
    mocks.runScholarFetch.mockResolvedValue({
      ...BASE_RESULT,
      status: 'REFUSED',
      reason: 'Already fetched on 2026-09-01. One fetch per 30 days.',
    });
    const outcome = await handlers.SCHOLAR_FETCH(JOB);
    expect(outcome.status).toBe('SKIPPED');
    expect(outcome.message).toContain('One fetch per 30 days');
  });

  it('reports a failure as FAILED — and returns it rather than throwing', async () => {
    mocks.runScholarFetch.mockResolvedValue({
      ...BASE_RESULT,
      status: 'FAILED',
      reason: 'Error: consent interstitial',
      creditsUsed: 15,
    });
    // Throwing would hand the job back to BullMQ, which re-walks the profile
    // at ~15 credits a page against a condition a retry cannot change.
    const outcome = await handlers.SCHOLAR_FETCH(JOB);
    expect(outcome.status).toBe('FAILED');
    expect(outcome.message).toContain('credits=15');
  });

  it('reports a clean import as SUCCEEDED with the counts in the message', async () => {
    mocks.runScholarFetch.mockResolvedValue({
      ...BASE_RESULT,
      status: 'SUCCEEDED',
      papersFound: 42,
      papersInserted: 12,
      citationsUpdated: 30,
      creditsUsed: 30,
    });
    const outcome = await handlers.SCHOLAR_FETCH(JOB);
    expect(outcome.status).toBe('SUCCEEDED');
    expect(outcome.message).toContain('found=42 inserted=12 citations=30 credits=30');
  });

  it('keeps PARTIAL greppable in the message even though the job succeeded', async () => {
    mocks.runScholarFetch.mockResolvedValue({
      ...BASE_RESULT,
      status: 'PARTIAL',
      reason: '3 paper(s) had no usable year and were not imported.',
      papersFound: 40,
    });
    const outcome = await handlers.SCHOLAR_FETCH(JOB);
    expect(outcome.status).toBe('SUCCEEDED');
    expect(outcome.message).toContain('PARTIAL');
    expect(outcome.message).toContain('no usable year');
  });
});

describe('SCHOLAR_FETCH handler — job payload and wiring', () => {
  it('passes the target as userId, the actor as triggeredById, and the scholar trigger through', async () => {
    mocks.runScholarFetch.mockResolvedValue({ ...BASE_RESULT, status: 'SUCCEEDED' });
    await handlers.SCHOLAR_FETCH({ ...JOB, scholarTrigger: 'ADMIN_BULK', scholarActorRole: 'SUPER_ADMIN' });

    const input = mocks.runScholarFetch.mock.calls[0]?.[0];
    expect(input).toMatchObject({
      userId: 'target-user',
      triggeredById: 'actor-user',
      trigger: 'ADMIN_BULK',
      actorRole: 'SUPER_ADMIN',
    });
    expect(typeof input.fetchPage).toBe('function');
  });

  it('hands the runner a fetcher that returns html plus the billed credits', async () => {
    mocks.runScholarFetch.mockResolvedValue({ ...BASE_RESULT, status: 'SUCCEEDED' });
    mocks.fetchScrapingBeePage.mockResolvedValue({ html: '<html/>', status: 200, creditsUsed: 15 });

    await handlers.SCHOLAR_FETCH(JOB);
    const input = mocks.runScholarFetch.mock.calls[0]?.[0];
    await expect(input.fetchPage('https://scholar.google.com/citations?user=abc')).resolves.toEqual({
      html: '<html/>',
      creditsUsed: 15,
    });
  });

  it('rejects a job missing the scholar fields instead of guessing an allowance', async () => {
    // A job enqueued by an older build. Defaulting scholarTrigger would draw
    // down the wrong 30-day counter.
    const outcome = await handlers.SCHOLAR_FETCH({
      entityId: 'target-user',
      trigger: 'MANUAL',
      triggeredByUserId: 'actor-user',
    });
    expect(outcome.status).toBe('FAILED');
    expect(outcome.message).toContain('missing required fields');
    expect(mocks.runScholarFetch).not.toHaveBeenCalled();
    // No run row on this path: `trigger` is NOT NULL on the ledger and is
    // among the fields that are missing, so there is no honest row to write.
    expect(mocks.scholarFetchRunCreate).not.toHaveBeenCalled();
  });

  it('asserts the target user id — it decides whose library gets written', async () => {
    const outcome = await handlers.SCHOLAR_FETCH({ ...JOB, entityId: '' });
    expect(outcome.status).toBe('FAILED');
    expect(outcome.message).toContain('entityId');
    expect(mocks.runScholarFetch).not.toHaveBeenCalled();
  });

  it('fails fast when ScrapingBee is not configured — and leaves a ledger row', async () => {
    delete process.env.SCRAPINGBEE_API_KEY;

    const outcome = await handlers.SCHOLAR_FETCH(JOB);

    expect(outcome.status).toBe('FAILED');
    expect(outcome.message).toContain('SCRAPINGBEE_API_KEY');
    expect(mocks.runScholarFetch).not.toHaveBeenCalled();

    // Without the row the click leaves NO trace: the runner never opens one,
    // so status/me keeps showing the previous run and the button reads as a
    // silent no-op — for every user at once on a deploy with a missing key.
    expect(mocks.scholarFetchRunCreate).toHaveBeenCalledTimes(1);
    const row = mocks.scholarFetchRunCreate.mock.calls[0][0].data;
    expect(row).toMatchObject({
      userId: 'target-user',
      triggeredById: 'actor-user',
      trigger: 'SELF',
      // Quota-safe by construction: only SUCCEEDED and PARTIAL count toward
      // the 30-day allowance, so this costs the user nothing.
      status: 'FAILED',
    });
    expect(row.finishedAt).toBeInstanceOf(Date);
  });

  it('still reports the config error when the ledger write itself fails', async () => {
    delete process.env.SCRAPINGBEE_API_KEY;
    mocks.scholarFetchRunCreate.mockRejectedValue(new Error('FK violation'));

    const outcome = await handlers.SCHOLAR_FETCH(JOB);

    // Replacing a legible config error with a database error would be worse
    // than losing the row.
    expect(outcome.status).toBe('FAILED');
    expect(outcome.message).toContain('SCRAPINGBEE_API_KEY');
  });
});
