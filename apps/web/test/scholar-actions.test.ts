import { beforeEach, describe, expect, it, vi } from 'vitest';

// ────────────────────────────────────────────────────────────────────────────
// The server actions behind the profile panel.
//
// Two properties are load-bearing and nothing else guards them:
//
//   1. A refusal from the API reaches the UI VERBATIM. On a name mismatch that
//      sentence quotes both the Scholar profile's name and the staff record's
//      name, and that pairing is the only thing that tells a person which of
//      the two is wrong. Any "friendlier" rewrite destroys it.
//   2. The machine-readable `needs-binding:` prefix is stripped before the
//      text is shown, so an internal code never reaches a sentence a person is
//      meant to act on. The BOOLEAN is what the UI branches on.
//
// Also asserted: a malformed URL is refused HERE, before the API is called at
// all, because a bind fetches a Google page (~15 credits) before it can decide
// anything — a server action is a public endpoint, so this is a guard, not a
// duplicate of the client's check.
// ────────────────────────────────────────────────────────────────────────────

const apiFetch = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api-client', () => ({ apiFetch }));
vi.mock('@kku/db', () => ({ SCHOLAR_NEEDS_BINDING: 'needs-binding' }));

import {
  bindScholarProfileAction,
  getScholarStatusAction,
  startScholarFetchAction,
} from '../src/lib/actions/scholar';

const VALID_URL = 'https://scholar.google.com/citations?user=ABC123';

function statusPayload(overrides: Record<string, unknown> = {}) {
  return {
    userId: 'u1',
    staffRecord: { linked: true, facultyMemberId: 'fm-1', nameEn: 'Somchai', nameTh: 'สมชาย' },
    profile: { bound: false },
    lastRun: null,
    nextEligibleAt: null,
    quotaReason: null,
    needsBinding: false,
    fetchQueued: false,
    bind: { attemptsToday: 0, maxPerDay: 5, retryAt: null },
    ...overrides,
  };
}

beforeEach(() => {
  apiFetch.mockReset();
});

describe('bindScholarProfileAction', () => {
  it('passes the API refusal through word for word, keeping both names', () => {
    const refusal =
      'That Scholar profile does not appear to belong to this person. ' +
      'The profile is named "S. Example"; the staff record says "Somchai Example". ' +
      'Refusing to link them.';
    apiFetch.mockRejectedValue(Object.assign(new Error(refusal), { code: 'VALIDATION_FAILED' }));

    return expect(bindScholarProfileAction(VALID_URL)).resolves.toEqual({
      ok: false,
      message: refusal,
      rateLimited: false,
    });
  });

  it('flags the daily cap separately from a wrong URL', async () => {
    // The two need different things from the user — waiting versus pasting a
    // different link — so the panel must be able to tell them apart without
    // reading the prose.
    apiFetch.mockRejectedValue(
      Object.assign(new Error('Too many bind attempts today.'), { code: 'RATE_LIMITED' }),
    );
    const result = await bindScholarProfileAction(VALID_URL);
    expect(result).toMatchObject({ ok: false, rateLimited: true });
  });

  it('refuses a non-Scholar URL without calling the API — a bind spends before it decides', async () => {
    const result = await bindScholarProfileAction('Somchai Example');
    expect(result.ok).toBe(false);
    expect(apiFetch).not.toHaveBeenCalled();
    if (!result.ok) expect(result.message).toMatch(/Paste your Google Scholar profile link/);
  });

  it('returns the bound id and the profile name on success', async () => {
    apiFetch.mockResolvedValue({ scholarProfileId: 'ABC123', profileName: 'Somchai Example' });
    await expect(bindScholarProfileAction(VALID_URL)).resolves.toEqual({
      ok: true,
      scholarProfileId: 'ABC123',
      profileName: 'Somchai Example',
    });
  });
});

describe('getScholarStatusAction', () => {
  it('strips the needs-binding code and leaves the actionable sentence', async () => {
    apiFetch.mockResolvedValue(
      statusPayload({
        needsBinding: true,
        lastRun: {
          id: 'run-1',
          status: 'REFUSED',
          trigger: 'SELF',
          startedAt: '2026-09-01T00:00:00.000Z',
          finishedAt: '2026-09-01T00:00:01.000Z',
          papersFound: 0,
          papersInserted: 0,
          citationsUpdated: 0,
          creditsUsed: 0,
          errorText: 'needs-binding: No Google Scholar profile is linked to this staff record yet.',
          needsBinding: true,
        },
      }),
    );
    const result = await getScholarStatusAction();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status.lastRun?.errorText).toBe(
      'No Google Scholar profile is linked to this staff record yet.',
    );
    // The boolean survives — it is what the UI branches on.
    expect(result.status.lastRun?.needsBinding).toBe(true);
  });

  it('leaves an unprefixed error alone', async () => {
    apiFetch.mockResolvedValue(
      statusPayload({
        lastRun: {
          id: 'run-2',
          status: 'FAILED',
          trigger: 'SELF',
          startedAt: '2026-09-01T00:00:00.000Z',
          finishedAt: null,
          papersFound: 0,
          papersInserted: 0,
          citationsUpdated: 0,
          creditsUsed: 15,
          errorText: 'Google returned a sign-in wall on page 1.',
          needsBinding: false,
        },
      }),
    );
    const result = await getScholarStatusAction();
    expect(result.ok && result.status.lastRun?.errorText).toBe(
      'Google returned a sign-in wall on page 1.',
    );
  });

  it('reports an unrecognised response shape instead of throwing into the render', async () => {
    apiFetch.mockResolvedValue({ nonsense: true });
    const result = await getScholarStatusAction();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/shape this page does not understand/);
  });

  it('carries an API failure back as a message, never as a throw', async () => {
    apiFetch.mockRejectedValue(new Error('Network error talking to API: ECONNREFUSED'));
    await expect(getScholarStatusAction()).resolves.toEqual({
      ok: false,
      message: 'Network error talking to API: ECONNREFUSED',
    });
  });
});

describe('startScholarFetchAction', () => {
  it('returns the job reference the panel then polls against', async () => {
    apiFetch.mockResolvedValue({ jobId: 'job-1', userId: 'u1', trigger: 'SELF' });
    await expect(startScholarFetchAction()).resolves.toEqual({ ok: true, jobId: 'job-1' });
  });

  it('reports a refusal rather than throwing an opaque digest at the client', async () => {
    apiFetch.mockRejectedValue(new Error('Already fetched on 2026-09-01.'));
    await expect(startScholarFetchAction()).resolves.toEqual({
      ok: false,
      message: 'Already fetched on 2026-09-01.',
    });
  });
});
