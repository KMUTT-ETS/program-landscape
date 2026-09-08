import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ScholarPaper } from '@kku/shared';

// ─────────────────────────────────────────────────────────────────────────────
// Mocks prisma via '../src/index' — the pattern used by sign-in-lockout.test.ts
// and program-curriculum-revision-run.test.ts. No `importActual` spread: index
// re-exports the module under test, so loading the real graph would bind the
// real `prisma` and every "no write happened" assertion below would be
// asserting against the dev database instead of a fake.
//
// The runner takes its ScrapingBee fetcher and its parser as injected
// functions, so nothing here touches the network.
// ─────────────────────────────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  userFindFirst: vi.fn(),
  facultyMemberFindMany: vi.fn(),
  facultyMemberFindFirst: vi.fn(),
  facultyMemberFindUnique: vi.fn(),
  facultyMemberUpdate: vi.fn(),
  runFindMany: vi.fn(),
  runCreate: vi.fn(),
  runUpdate: vi.fn(),
  archiveCreate: vi.fn(),
  researchOutputFindMany: vi.fn(),
  researchOutputCreateMany: vi.fn(),
  researchOutputUpdateMany: vi.fn(),
  cacheUpdateMany: vi.fn(),
  auditLogCreate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../src/index', () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique, findFirst: mocks.userFindFirst },
    facultyMember: {
      findMany: mocks.facultyMemberFindMany,
      findFirst: mocks.facultyMemberFindFirst,
      findUnique: mocks.facultyMemberFindUnique,
      update: mocks.facultyMemberUpdate,
    },
    scholarFetchRun: {
      findMany: mocks.runFindMany,
      create: mocks.runCreate,
      update: mocks.runUpdate,
    },
    scholarFetchArchive: { create: mocks.archiveCreate },
    researchOutput: {
      findMany: mocks.researchOutputFindMany,
      createMany: mocks.researchOutputCreateMany,
      updateMany: mocks.researchOutputUpdateMany,
    },
    userPublicationsCache: { updateMany: mocks.cacheUpdateMany },
    auditLog: { create: mocks.auditLogCreate },
    $transaction: mocks.transaction,
  },
}));

import {
  SCHOLAR_MAX_PAGES,
  SCHOLAR_NEEDS_BINDING,
  SCHOLAR_PAGE_SIZE,
  bindScholarProfile,
  buildScholarProfilePageUrl,
  resolveScholarFacultyMember,
  runScholarFetch,
  toResearchOutputType,
  type ScholarFacultyMember,
  type ScholarPageResult,
} from '../src/scholar-fetch';

const NOW = new Date('2026-09-08T10:00:00.000Z');
const USER_ID = 'user-1';
const MEMBER_ID = 'fm-1';
const PROFILE_ID = 'SCHOLAR123';

// ── Fixtures ────────────────────────────────────────────────────────────────
// Real Scholar list-page markup shape (see the verified structure documented
// in packages/shared/src/scholar/parse.ts). Test fixture, not seeded data.

function row(opts: {
  paperId: string;
  title: string;
  year: number | '';
  citations: number | '';
  venue?: string;
}): string {
  const venue = opts.venue ?? 'Journal of Testing';
  return (
    '<tr class="gsc_a_tr">' +
    '<td class="gsc_a_t">' +
    `<a href="/citations?view_op=view_citation&hl=en&user=${PROFILE_ID}&citation_for_view=${opts.paperId}" class="gsc_a_at">${opts.title}</a>` +
    '<div class="gs_gray">A Author, B Author</div>' +
    `<div class="gs_gray">${venue}<span class="gs_oph">, ${opts.year}</span></div>` +
    '</td>' +
    `<td class="gsc_a_c"><a href="#" class="gsc_a_ac gs_ibl">${opts.citations}</a></td>` +
    `<td class="gsc_a_y"><span class="gsc_a_h gsc_a_hc gs_ibl">${opts.year}</span></td>` +
    '</tr>'
  );
}

function page(rows: string[], profileName = 'Somchai Jaidee'): string {
  return (
    '<html><body>' +
    `<div id="gsc_prf_i"><div id="gsc_prf_inw"><div id="gsc_prf_in">${profileName}</div></div></div>` +
    `<table id="gsc_a_t"><tbody>${rows.join('')}</tbody></table>` +
    '</body></html>'
  );
}

function pageResult(html: string, creditsUsed: number | null = 1): ScholarPageResult {
  return { html, creditsUsed };
}

/** A fetcher that must never be called — turns "no fetch happened" into an assertion. */
function unreachableFetcher(): (url: string) => Promise<ScholarPageResult> {
  return vi.fn(async () => {
    throw new Error('ScrapingBee must not be called on this path');
  });
}

function member(overrides: Partial<ScholarFacultyMember> = {}): ScholarFacultyMember {
  return {
    id: MEMBER_ID,
    nameEn: 'Somchai Jaidee',
    nameTh: 'สมชาย ใจดี',
    employeeId: 'HR-9',
    isActive: true,
    scholarProfileId: PROFILE_ID,
    ...overrides,
  };
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  // Defaults for the common path; individual tests override.
  mocks.userFindUnique.mockResolvedValue({ id: USER_ID, name: 'ผศ.ดร. สมชาย ใจดี', employeeId: 'HR-9' });
  mocks.facultyMemberFindMany.mockResolvedValue([member()]);
  mocks.runFindMany.mockResolvedValue([]);
  mocks.runCreate.mockResolvedValue({ id: 'run-1' });
  mocks.runUpdate.mockResolvedValue({ id: 'run-1' });
  mocks.archiveCreate.mockResolvedValue({ id: 'arch-1' });
  mocks.researchOutputFindMany.mockResolvedValue([]);
  mocks.cacheUpdateMany.mockResolvedValue({ count: 1 });
  // The mocked $transaction just resolves whatever the mocked query builders
  // returned, preserving order — enough to assert what was applied.
  mocks.transaction.mockImplementation((ops: unknown[]) => Promise.all(ops));
});

// ── Resolution ──────────────────────────────────────────────────────────────

describe('resolveScholarFacultyMember', () => {
  it('prefers the HR employee id, and never scans names when it hits', async () => {
    const r = await resolveScholarFacultyMember(USER_ID);
    expect(r.member?.id).toBe(MEMBER_ID);
    expect(mocks.facultyMemberFindMany).toHaveBeenCalledTimes(1);
    expect(mocks.facultyMemberFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { employeeId: 'HR-9' } }),
    );
  });

  it('does NOT require HR linkage — an employeeCode-less record still resolves by name', async () => {
    mocks.userFindUnique.mockResolvedValue({ id: USER_ID, name: 'Somchai Jaidee', employeeId: null });
    mocks.facultyMemberFindMany.mockResolvedValue([
      member({ employeeId: null, isActive: false }),
      member({ id: 'fm-other', nameEn: 'Someone Else' }),
    ]);

    const r = await resolveScholarFacultyMember(USER_ID);
    expect(r.member?.id).toBe(MEMBER_ID);
    // Inactive is not a filter: a retired researcher's publication history is
    // still legitimate data.
    expect(r.member?.isActive).toBe(false);
  });

  it('matches names order-insensitively and across diacritics/punctuation', async () => {
    mocks.userFindUnique.mockResolvedValue({ id: USER_ID, name: 'JAIDEE, Sômchai', employeeId: null });
    mocks.facultyMemberFindMany.mockResolvedValue([member()]);

    const r = await resolveScholarFacultyMember(USER_ID);
    expect(r.member?.id).toBe(MEMBER_ID);
  });

  it('refuses a transliteration variant rather than guessing — "Jai-dee" is not "Jaidee"', async () => {
    // Documenting the strict edge deliberately: a hyphen splits a token, so
    // this is a REFUSAL, not a match. The trade is stated in name-match.ts —
    // a false refusal is visible and a human fixes it in seconds; a false
    // match attaches a stranger's papers to a Council-facing record.
    mocks.userFindUnique.mockResolvedValue({ id: USER_ID, name: 'Somchai Jai-dee', employeeId: null });
    mocks.facultyMemberFindMany.mockResolvedValue([member()]);

    const r = await resolveScholarFacultyMember(USER_ID);
    expect(r.member).toBeNull();
    expect(r.refusal).toContain('Somchai Jai-dee');
  });

  it('refuses, naming the name searched, when nothing matches', async () => {
    mocks.userFindUnique.mockResolvedValue({ id: USER_ID, name: 'Nobody Here', employeeId: null });
    mocks.facultyMemberFindMany.mockResolvedValue([member()]);

    const r = await resolveScholarFacultyMember(USER_ID);
    expect(r.member).toBeNull();
    expect(r.refusal).toContain('Nobody Here');
  });

  it('refuses, naming the count, when a name matches more than one record', async () => {
    mocks.userFindUnique.mockResolvedValue({ id: USER_ID, name: 'Somchai Jaidee', employeeId: null });
    mocks.facultyMemberFindMany.mockResolvedValue([
      member({ id: 'fm-a' }),
      member({ id: 'fm-b' }),
    ]);

    const r = await resolveScholarFacultyMember(USER_ID);
    expect(r.member).toBeNull();
    expect(r.refusal).toMatch(/matches 2 staff records/);
  });

  it('breaks a tie on isActive, but only when exactly one candidate is active', async () => {
    mocks.userFindUnique.mockResolvedValue({ id: USER_ID, name: 'Somchai Jaidee', employeeId: null });
    mocks.facultyMemberFindMany.mockResolvedValue([
      member({ id: 'fm-a', isActive: false }),
      member({ id: 'fm-b', isActive: true }),
    ]);

    const r = await resolveScholarFacultyMember(USER_ID);
    expect(r.member?.id).toBe('fm-b');
  });

  it('refuses an ambiguous HR employee id rather than falling through to names', async () => {
    mocks.facultyMemberFindMany.mockResolvedValue([
      member({ id: 'fm-a', isActive: true }),
      member({ id: 'fm-b', isActive: true }),
    ]);

    const r = await resolveScholarFacultyMember(USER_ID);
    expect(r.member).toBeNull();
    expect(r.refusal).toContain('HR employee id');
    expect(mocks.facultyMemberFindMany).toHaveBeenCalledTimes(1); // no name scan
  });

  it('falls through from a missed employee id to the name path', async () => {
    mocks.facultyMemberFindMany
      .mockResolvedValueOnce([]) // employeeId query misses
      .mockResolvedValueOnce([member()]); // full scan for the name match
    mocks.userFindUnique.mockResolvedValue({ id: USER_ID, name: 'Somchai Jaidee', employeeId: 'HR-9' });

    const r = await resolveScholarFacultyMember(USER_ID);
    expect(r.member?.id).toBe(MEMBER_ID);
    expect(mocks.facultyMemberFindMany).toHaveBeenCalledTimes(2);
  });
});

// ── 1. Refusals that write nothing ──────────────────────────────────────────

describe('runScholarFetch — resolution refusals', () => {
  it('refuses with no run row when no staff record matches', async () => {
    mocks.facultyMemberFindMany.mockResolvedValue([]);
    mocks.userFindUnique.mockResolvedValue({ id: USER_ID, name: 'Nobody Here', employeeId: null });

    const result = await runScholarFetch({
      userId: USER_ID,
      triggeredById: USER_ID,
      trigger: 'SELF',
      actorRole: 'ANALYST',
      fetchPage: unreachableFetcher(),
      now: NOW,
    });

    expect(result.status).toBe('REFUSED');
    expect(result.runId).toBeNull();
    expect(result.reason).toContain('Nobody Here');
    expect(mocks.runCreate).not.toHaveBeenCalled();
    expect(mocks.runFindMany).not.toHaveBeenCalled(); // quota never even read
    expect(mocks.researchOutputCreateMany).not.toHaveBeenCalled();
  });

  it('refuses with no run row when the match is ambiguous', async () => {
    mocks.facultyMemberFindMany.mockResolvedValue([member({ id: 'fm-a' }), member({ id: 'fm-b' })]);

    const result = await runScholarFetch({
      userId: USER_ID,
      triggeredById: USER_ID,
      trigger: 'SELF',
      actorRole: 'ANALYST',
      fetchPage: unreachableFetcher(),
      now: NOW,
    });

    expect(result.status).toBe('REFUSED');
    expect(result.runId).toBeNull();
    expect(result.reason).toMatch(/2 staff records/);
    expect(mocks.runCreate).not.toHaveBeenCalled();
  });

  it('refuses with no run row when the user record does not exist', async () => {
    mocks.userFindUnique.mockResolvedValue(null);

    const result = await runScholarFetch({
      userId: USER_ID,
      triggeredById: USER_ID,
      trigger: 'SELF',
      actorRole: 'ANALYST',
      fetchPage: unreachableFetcher(),
      now: NOW,
    });

    expect(result.status).toBe('REFUSED');
    expect(result.runId).toBeNull();
    expect(mocks.runCreate).not.toHaveBeenCalled();
  });

  it('refuses when neither the staff record nor the account carries a usable name', async () => {
    mocks.userFindUnique.mockResolvedValue({ id: USER_ID, name: '   ', employeeId: 'HR-9' });
    mocks.facultyMemberFindMany.mockResolvedValue([member({ nameEn: '  ' })]);

    const result = await runScholarFetch({
      userId: USER_ID,
      triggeredById: USER_ID,
      trigger: 'SELF',
      actorRole: 'ANALYST',
      fetchPage: unreachableFetcher(),
      now: NOW,
    });

    expect(result.status).toBe('REFUSED');
    expect(result.runId).toBeNull();
    expect(result.searchQuery).toBeNull();
    expect(mocks.runCreate).not.toHaveBeenCalled();
  });
});

// ── 2. Quota ────────────────────────────────────────────────────────────────

describe('runScholarFetch — quota', () => {
  it('persists exactly one REFUSED run and never fetches when quota refuses', async () => {
    mocks.runFindMany.mockResolvedValue([
      { trigger: 'SELF', status: 'SUCCEEDED', startedAt: new Date('2026-09-01T00:00:00.000Z') },
    ]);
    const fetchPage = unreachableFetcher();

    const result = await runScholarFetch({
      userId: USER_ID,
      triggeredById: USER_ID,
      trigger: 'SELF',
      actorRole: 'ANALYST',
      fetchPage,
      now: NOW,
    });

    expect(result.status).toBe('REFUSED');
    expect(result.runId).toBe('run-1');
    expect(result.retryAt).toBeInstanceOf(Date);
    expect(fetchPage).not.toHaveBeenCalled();
    expect(mocks.runCreate).toHaveBeenCalledTimes(1);
    expect(mocks.runCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'REFUSED', searchQuery: 'Somchai Jaidee' }),
      }),
    );
    expect(mocks.researchOutputCreateMany).not.toHaveBeenCalled();
  });

  it('lets an ADMIN fetch through even when the person used their own SELF allowance', async () => {
    mocks.runFindMany.mockResolvedValue([
      { trigger: 'SELF', status: 'SUCCEEDED', startedAt: new Date('2026-09-01T00:00:00.000Z') },
    ]);
    mocks.facultyMemberFindMany.mockResolvedValue([member({ scholarProfileId: null })]);

    const result = await runScholarFetch({
      userId: USER_ID,
      triggeredById: 'admin-1',
      trigger: 'ADMIN',
      actorRole: 'ADMIN',
      fetchPage: unreachableFetcher(),
      now: NOW,
    });

    // Got past quota (refused later, for the unbound profile — a different reason).
    expect(result.reason).toBe(SCHOLAR_NEEDS_BINDING);
  });
});

// ── 3. Binding gate ─────────────────────────────────────────────────────────

describe('runScholarFetch — unbound profile', () => {
  it('refuses with needs-binding, spends no credit, and consumes no quota', async () => {
    mocks.facultyMemberFindMany.mockResolvedValue([member({ scholarProfileId: null })]);
    const fetchPage = unreachableFetcher();

    const result = await runScholarFetch({
      userId: USER_ID,
      triggeredById: USER_ID,
      trigger: 'SELF',
      actorRole: 'ANALYST',
      fetchPage,
      now: NOW,
    });

    expect(result.status).toBe('REFUSED');
    expect(result.reason).toBe(SCHOLAR_NEEDS_BINDING);
    expect(result.creditsUsed).toBe(0);
    expect(fetchPage).not.toHaveBeenCalled();
    expect(mocks.archiveCreate).not.toHaveBeenCalled();
    expect(mocks.researchOutputCreateMany).not.toHaveBeenCalled();

    // REFUSED is the status the quota unit ignores, so the month is intact.
    expect(mocks.runUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'REFUSED' }) }),
    );
  });
});

// ── 4. Happy path ───────────────────────────────────────────────────────────

describe('runScholarFetch — happy path', () => {
  it('inserts new papers, raises citations on matched rows, and records the counts', async () => {
    const html = page([
      row({ paperId: `${PROFILE_ID}:new1`, title: 'A brand new paper', year: 2025, citations: 4 }),
      row({ paperId: `${PROFILE_ID}:known`, title: 'An existing paper', year: 2020, citations: 99 }),
    ]);
    const fetchPage = vi.fn(async () => pageResult(html, 5));

    mocks.researchOutputFindMany.mockResolvedValue([
      { id: 'ro-1', title: 'An existing paper', year: 2020, doi: null, citations: 12 },
    ]);
    mocks.researchOutputCreateMany.mockResolvedValue({ count: 1 });
    mocks.researchOutputUpdateMany.mockResolvedValue({ count: 1 });

    const result = await runScholarFetch({
      userId: USER_ID,
      triggeredById: USER_ID,
      trigger: 'SELF',
      actorRole: 'ANALYST',
      fetchPage,
      now: NOW,
    });

    expect(result.status).toBe('SUCCEEDED');
    expect(result.papersFound).toBe(2);
    expect(result.papersInserted).toBe(1);
    expect(result.citationsUpdated).toBe(1);
    expect(result.creditsUsed).toBe(5);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith(buildScholarProfilePageUrl(PROFILE_ID, 0));

    // Insert carries the Scholar provenance and the additive-only shape.
    expect(mocks.researchOutputCreateMany).toHaveBeenCalledWith({
      data: [
        {
          facultyMemberId: MEMBER_ID,
          year: 2025,
          type: 'JOURNAL',
          title: 'A brand new paper',
          venue: 'Journal of Testing',
          citations: 4,
          doi: null,
          scholarPaperId: `${PROFILE_ID}:new1`,
          source: 'google-scholar',
          kkuAuthorName: 'Somchai Jaidee',
        },
      ],
      skipDuplicates: true,
    });

    // The citation update raises the count and stamps the paper id — and
    // touches nothing else, so a Scopus-sourced row keeps its provenance.
    const updateArg = mocks.researchOutputUpdateMany.mock.calls[0]![0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(updateArg.data).toEqual({ citations: 99, scholarPaperId: `${PROFILE_ID}:known` });
    expect(updateArg.where).toMatchObject({ id: 'ro-1', facultyMemberId: MEMBER_ID });

    // Writes went through one transaction.
    expect(mocks.transaction).toHaveBeenCalledTimes(1);

    // Raw payload archived under the parser version that read it.
    expect(mocks.archiveCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ fetchRunId: 'run-1', parserVersion: 'scholar-parse.v1' }),
      }),
    );

    // Publications cache expired (aged out, never removed) so the profile page
    // recomputes against the rows just added.
    expect(mocks.cacheUpdateMany).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      data: { fetchedAt: new Date(0) },
    });

    expect(mocks.runUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'run-1' },
        data: expect.objectContaining({
          status: 'SUCCEEDED',
          papersFound: 2,
          papersInserted: 1,
          citationsUpdated: 1,
          creditsUsed: 5,
          errorText: null,
        }),
      }),
    );
  });

  it('counts a null Spb-Cost as zero rather than guessing a credit price', async () => {
    const fetchPage = vi.fn(async () =>
      pageResult(page([row({ paperId: `${PROFILE_ID}:p`, title: 'P', year: 2024, citations: 0 })]), null),
    );
    mocks.researchOutputCreateMany.mockResolvedValue({ count: 1 });

    const result = await runScholarFetch({
      userId: USER_ID,
      triggeredById: USER_ID,
      trigger: 'SELF',
      actorRole: 'ANALYST',
      fetchPage,
      now: NOW,
    });

    expect(result.creditsUsed).toBe(0);
  });

  it('pages until a short page, and does not re-request after a repeated page', async () => {
    const fullPage = page(
      Array.from({ length: SCHOLAR_PAGE_SIZE }, (_, i) =>
        row({ paperId: `${PROFILE_ID}:p${i}`, title: `Paper ${i}`, year: 2020, citations: 1 }),
      ),
    );
    const shortPage = page([row({ paperId: `${PROFILE_ID}:last`, title: 'Last', year: 2019, citations: 0 })]);
    const fetchPage = vi
      .fn<(url: string) => Promise<ScholarPageResult>>()
      .mockResolvedValueOnce(pageResult(fullPage))
      .mockResolvedValueOnce(pageResult(shortPage));
    mocks.researchOutputCreateMany.mockResolvedValue({ count: SCHOLAR_PAGE_SIZE + 1 });

    const result = await runScholarFetch({
      userId: USER_ID,
      triggeredById: USER_ID,
      trigger: 'SELF',
      actorRole: 'ANALYST',
      fetchPage,
      now: NOW,
    });

    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage).toHaveBeenNthCalledWith(2, buildScholarProfilePageUrl(PROFILE_ID, SCHOLAR_PAGE_SIZE));
    expect(result.papersFound).toBe(SCHOLAR_PAGE_SIZE + 1);
    expect(result.status).toBe('SUCCEEDED');
  });

  it('stops and reports PARTIAL when the page ceiling is reached', async () => {
    // Every page is full AND every page is new, so only the ceiling stops it.
    let n = 0;
    const fetchPage = vi.fn(async () => {
      const base = n * SCHOLAR_PAGE_SIZE;
      n += 1;
      return pageResult(
        page(
          Array.from({ length: SCHOLAR_PAGE_SIZE }, (_, i) =>
            row({ paperId: `${PROFILE_ID}:p${base + i}`, title: `Paper ${base + i}`, year: 2020, citations: 1 }),
          ),
        ),
      );
    });
    mocks.researchOutputCreateMany.mockResolvedValue({ count: SCHOLAR_MAX_PAGES * SCHOLAR_PAGE_SIZE });

    const result = await runScholarFetch({
      userId: USER_ID,
      triggeredById: USER_ID,
      trigger: 'SELF',
      actorRole: 'ANALYST',
      fetchPage,
      now: NOW,
    });

    expect(fetchPage).toHaveBeenCalledTimes(SCHOLAR_MAX_PAGES);
    expect(result.status).toBe('PARTIAL');
    expect(result.reason).toMatch(/ceiling/i);
  });
});

// ── 5. Failure path ─────────────────────────────────────────────────────────

describe('runScholarFetch — failure', () => {
  it('marks the run FAILED with errorText and writes ZERO ResearchOutput rows', async () => {
    const fetchPage = vi.fn(async () => {
      throw new Error('ScrapingBee request failed transiently after 1 retry (HTTP 503).');
    });

    const result = await runScholarFetch({
      userId: USER_ID,
      triggeredById: USER_ID,
      trigger: 'SELF',
      actorRole: 'ANALYST',
      fetchPage,
      now: NOW,
    });

    expect(result.status).toBe('FAILED');
    expect(result.reason).toContain('HTTP 503');
    expect(result.papersInserted).toBe(0);
    expect(result.citationsUpdated).toBe(0);

    // The load-bearing assertion: nothing reached the publication library.
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.researchOutputCreateMany).not.toHaveBeenCalled();
    expect(mocks.researchOutputUpdateMany).not.toHaveBeenCalled();

    expect(mocks.runUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED', errorText: expect.stringContaining('HTTP 503') }),
      }),
    );
  });

  it('writes nothing to ResearchOutput when the transaction itself throws', async () => {
    const fetchPage = vi.fn(async () =>
      pageResult(page([row({ paperId: `${PROFILE_ID}:p`, title: 'P', year: 2024, citations: 1 })])),
    );
    mocks.transaction.mockRejectedValue(new Error('deadlock detected'));

    const result = await runScholarFetch({
      userId: USER_ID,
      triggeredById: USER_ID,
      trigger: 'SELF',
      actorRole: 'ANALYST',
      fetchPage,
      now: NOW,
    });

    expect(result.status).toBe('FAILED');
    expect(result.reason).toContain('deadlock');
    // Cache must NOT be expired on a failed run — the library is unchanged.
    expect(mocks.cacheUpdateMany).not.toHaveBeenCalled();
  });

  it('does not fail the run when only the cache expiry throws', async () => {
    const fetchPage = vi.fn(async () =>
      pageResult(page([row({ paperId: `${PROFILE_ID}:p`, title: 'P', year: 2024, citations: 1 })])),
    );
    mocks.researchOutputCreateMany.mockResolvedValue({ count: 1 });
    mocks.cacheUpdateMany.mockRejectedValue(new Error('redis-ish failure'));

    const result = await runScholarFetch({
      userId: USER_ID,
      triggeredById: USER_ID,
      trigger: 'SELF',
      actorRole: 'ANALYST',
      fetchPage,
      now: NOW,
    });

    // The rows are committed; a stale page is not a failed fetch.
    expect(result.status).toBe('SUCCEEDED');
    expect(result.papersInserted).toBe(1);
  });
});

// ── 6. Year guard ───────────────────────────────────────────────────────────

describe('runScholarFetch — papers with no usable year', () => {
  it('skips them, counts them, and reports PARTIAL rather than guessing a year', async () => {
    const fetchPage = vi.fn(async () => pageResult(page([])));
    // Injected parser: the shipped one already drops year-less rows, so this
    // is the only way to prove the runner's own guard actually fires.
    const parsePage = (): ScholarPaper[] => [
      { scholarPaperId: 'a', title: 'Has a year', year: 2021, doi: null, citations: 3, venue: null, type: null },
      { scholarPaperId: 'b', title: 'No year', year: 0, doi: null, citations: 1, venue: null, type: null },
      {
        scholarPaperId: 'c',
        title: 'Nonsense year',
        year: Number.NaN,
        doi: null,
        citations: 1,
        venue: null,
        type: null,
      },
    ];
    mocks.researchOutputCreateMany.mockResolvedValue({ count: 1 });

    const result = await runScholarFetch({
      userId: USER_ID,
      triggeredById: USER_ID,
      trigger: 'SELF',
      actorRole: 'ANALYST',
      fetchPage,
      parsePage,
      now: NOW,
    });

    expect(result.papersFound).toBe(3);
    expect(result.papersSkippedNoYear).toBe(2);
    expect(result.status).toBe('PARTIAL');

    const created = mocks.researchOutputCreateMany.mock.calls[0]![0] as { data: Array<{ title: string }> };
    expect(created.data.map((d) => d.title)).toEqual(['Has a year']);
  });
});

// ── 7. Type mapping ─────────────────────────────────────────────────────────

describe('toResearchOutputType', () => {
  it('maps the four cases and defaults absent/unknown to JOURNAL', () => {
    expect(toResearchOutputType('US Patent 1,234,567')).toBe('PATENT');
    expect(toResearchOutputType('Book chapter')).toBe('BOOK');
    expect(toResearchOutputType('A Book')).toBe('BOOK');
    expect(toResearchOutputType('IEEE Conference on Things')).toBe('CONFERENCE');
    expect(toResearchOutputType('Proceedings of ACM')).toBe('CONFERENCE');
    expect(toResearchOutputType('Journal of Testing')).toBe('JOURNAL');
    expect(toResearchOutputType('something entirely unknown')).toBe('JOURNAL');
    expect(toResearchOutputType(null)).toBe('JOURNAL');
    expect(toResearchOutputType('')).toBe('JOURNAL');
  });

  it('is case-insensitive, and patent wins over a venue that also says journal', () => {
    expect(toResearchOutputType('PATENT, Journal edition')).toBe('PATENT');
  });
});

// ── 8. Binding ──────────────────────────────────────────────────────────────

describe('bindScholarProfile', () => {
  const URL_OK = `https://scholar.google.com/citations?user=${PROFILE_ID}&hl=en`;

  function profilePageFetcher(profileName: string, otherNames?: string) {
    const html =
      `<div id="gsc_prf_in">${profileName}</div>` +
      (otherNames ? `<span id="gs_prf_ion_txt">${otherNames}</span>` : '');
    return vi.fn(async () => pageResult(html, 5));
  }

  beforeEach(() => {
    mocks.facultyMemberFindUnique.mockResolvedValue({
      id: MEMBER_ID,
      nameEn: 'Somchai Jaidee',
      nameTh: 'สมชาย ใจดี',
      employeeId: 'HR-9',
      scholarProfileId: null,
      scholarProfileUrl: null,
    });
    mocks.facultyMemberFindFirst.mockResolvedValue(null);
  });

  it('verifies the profile name, then sets the four columns and audit-logs the bind', async () => {
    const fetchPage = profilePageFetcher('Somchai Jaidee');

    const result = await bindScholarProfile({
      facultyMemberId: MEMBER_ID,
      url: URL_OK,
      boundById: 'admin-1',
      fetchPage,
      now: NOW,
    });

    expect(result).toEqual({ scholarProfileId: PROFILE_ID, profileName: 'Somchai Jaidee', creditsUsed: 5 });
    // Verification reuses page 1 of the publication list — no extra request.
    expect(fetchPage).toHaveBeenCalledWith(buildScholarProfilePageUrl(PROFILE_ID, 0));
    expect(mocks.facultyMemberUpdate).toHaveBeenCalledWith({
      where: { id: MEMBER_ID },
      data: {
        scholarProfileId: PROFILE_ID,
        scholarProfileUrl: URL_OK,
        scholarBoundAt: NOW,
        scholarBoundById: 'admin-1',
      },
    });
    expect(mocks.auditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'scholar.profile.bind', entityId: MEMBER_ID }),
      }),
    );
  });

  it('accepts a match against the profile’s "other names" list', async () => {
    const fetchPage = profilePageFetcher('S Jaidee', 'Somchai Jaidee, Somchai Jai-dee');

    await bindScholarProfile({
      facultyMemberId: MEMBER_ID,
      url: URL_OK,
      boundById: 'admin-1',
      fetchPage,
    });

    expect(mocks.facultyMemberUpdate).toHaveBeenCalled();
  });

  it('REFUSES and writes nothing when the profile name is someone else', async () => {
    const fetchPage = profilePageFetcher('Geoffrey Hinton');

    await expect(
      bindScholarProfile({
        facultyMemberId: MEMBER_ID,
        url: URL_OK,
        boundById: 'admin-1',
        fetchPage,
      }),
    ).rejects.toThrow(/does not appear to belong to this person/);

    // Both sides quoted so a human can see what mismatched.
    await expect(
      bindScholarProfile({
        facultyMemberId: MEMBER_ID,
        url: URL_OK,
        boundById: 'admin-1',
        fetchPage,
      }),
    ).rejects.toThrow(/Geoffrey Hinton[\s\S]*Somchai Jaidee/);

    expect(mocks.facultyMemberUpdate).not.toHaveBeenCalled();
    expect(mocks.auditLogCreate).not.toHaveBeenCalled();
  });

  it('refuses when the page carries no profile name — cannot verify is not verified', async () => {
    const fetchPage = vi.fn(async () => pageResult('<html><body>signed out</body></html>'));

    await expect(
      bindScholarProfile({
        facultyMemberId: MEMBER_ID,
        url: URL_OK,
        boundById: 'admin-1',
        fetchPage,
      }),
    ).rejects.toThrow(/Could not read a profile name/);
    expect(mocks.facultyMemberUpdate).not.toHaveBeenCalled();
  });

  it('falls back to the linked account name when the staff record has no English name', async () => {
    mocks.facultyMemberFindUnique.mockResolvedValue({
      id: MEMBER_ID,
      nameEn: '   ',
      nameTh: 'สมชาย ใจดี',
      employeeId: 'HR-9',
      scholarProfileId: null,
      scholarProfileUrl: null,
    });
    mocks.userFindFirst.mockResolvedValue({ name: 'Somchai Jaidee' });

    await bindScholarProfile({
      facultyMemberId: MEMBER_ID,
      url: URL_OK,
      boundById: 'admin-1',
      fetchPage: profilePageFetcher('Somchai Jaidee'),
    });

    expect(mocks.facultyMemberUpdate).toHaveBeenCalled();
  });

  it('is idempotent, and a rebind is audit-logged as such with the previous value', async () => {
    mocks.facultyMemberFindUnique.mockResolvedValue({
      id: MEMBER_ID,
      nameEn: 'Somchai Jaidee',
      nameTh: 'สมชาย ใจดี',
      employeeId: 'HR-9',
      scholarProfileId: 'OLDID',
      scholarProfileUrl: 'https://scholar.google.com/citations?user=OLDID',
    });

    await bindScholarProfile({
      facultyMemberId: MEMBER_ID,
      url: URL_OK,
      boundById: 'admin-1',
      fetchPage: profilePageFetcher('Somchai Jaidee'),
      now: NOW,
    });

    const audit = mocks.auditLogCreate.mock.calls[0]![0] as {
      data: { action: string; payloadJson: { previousScholarProfileId: string | null } };
    };
    expect(audit.data.action).toBe('scholar.profile.rebind');
    expect(audit.data.payloadJson.previousScholarProfileId).toBe('OLDID');
  });

  it('refuses a URL that is not a Scholar citations profile, without fetching', async () => {
    const fetchPage = unreachableFetcher();
    await expect(
      bindScholarProfile({
        facultyMemberId: MEMBER_ID,
        url: 'Somchai Jaidee',
        boundById: 'admin-1',
        fetchPage,
      }),
    ).rejects.toThrow(/Cannot link/);
    expect(fetchPage).not.toHaveBeenCalled();
    expect(mocks.facultyMemberUpdate).not.toHaveBeenCalled();
  });

  it('refuses a profile already linked to a different staff record, without fetching', async () => {
    mocks.facultyMemberFindFirst.mockResolvedValue({ id: 'fm-2', nameEn: 'Other Person', nameTh: '' });
    const fetchPage = unreachableFetcher();

    await expect(
      bindScholarProfile({
        facultyMemberId: MEMBER_ID,
        url: URL_OK,
        boundById: 'admin-1',
        fetchPage,
      }),
    ).rejects.toThrow(/already linked/);
    expect(fetchPage).not.toHaveBeenCalled();
    expect(mocks.facultyMemberUpdate).not.toHaveBeenCalled();
  });
});
