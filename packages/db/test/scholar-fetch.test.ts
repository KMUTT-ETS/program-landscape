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
  runFindFirst: vi.fn(),
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
      findFirst: mocks.runFindFirst,
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
  inMemoryScholarRoster,
  resolveScholarFacultyMember,
  resolveScholarMember,
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
  mocks.runFindFirst.mockResolvedValue(null); // no fetch already in flight
  mocks.runCreate.mockResolvedValue({ id: 'run-1' });
  mocks.runUpdate.mockResolvedValue({ id: 'run-1' });
  mocks.archiveCreate.mockResolvedValue({ id: 'arch-1' });
  mocks.researchOutputFindMany.mockResolvedValue([]);
  mocks.cacheUpdateMany.mockResolvedValue({ count: 1 });
  // The mocked $transaction resolves whatever the mocked query builders
  // returned, preserving order — enough to assert WHAT was applied.
  //
  // It does NOT prove atomicity, and no test here does. Real Prisma is handed
  // lazy PrismaPromises and executes them sequentially inside one database
  // transaction; this fake has already executed them, eagerly and in
  // parallel, by the time it is called. So "the writes are all-or-nothing"
  // rests on the shape of the code (one `$transaction` call, every
  // ResearchOutput write inside it) rather than on this assertion — read
  // `expect(mocks.transaction).toHaveBeenCalledTimes(1)` below as "the writes
  // went through the transaction path", nothing stronger.
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

// ── The in-memory roster: same rule, different source of candidates ─────────
//
// The admin Scholar console resolves the whole user table at once and cannot
// afford the per-person full scan the database path takes. `inMemoryScholarRoster`
// buckets the roster on the only key that can narrow a name match without
// changing its verdict, so what matters is that it AGREES with the database
// path on every case above — a console that disagreed with the runner about
// who resolves would offer buttons that refuse, or hide people the runner
// would happily have fetched.

describe('inMemoryScholarRoster agrees with the database path', () => {
  const resolveInMemory = (
    account: { id: string; name: string | null; employeeId: string | null },
    roster: ScholarFacultyMember[],
  ) => resolveScholarMember(account, inMemoryScholarRoster(roster));

  it('matches on the HR employee id without consulting names', async () => {
    const r = await resolveInMemory(
      { id: USER_ID, name: 'Someone Entirely Different', employeeId: 'HR-9' },
      [member(), member({ id: 'fm-other', nameEn: 'Someone Else', employeeId: 'HR-X' })],
    );
    expect(r.member?.id).toBe(MEMBER_ID);
  });

  it('matches names order-insensitively and across diacritics/punctuation', async () => {
    const r = await resolveInMemory(
      { id: USER_ID, name: 'JAIDEE, Sômchai', employeeId: null },
      [member({ employeeId: null })],
    );
    expect(r.member?.id).toBe(MEMBER_ID);
  });

  it('tolerates a middle initial on one side only, exactly as the matcher does', async () => {
    const r = await resolveInMemory(
      { id: USER_ID, name: 'Somchai Jaidee', employeeId: null },
      [member({ employeeId: null, nameEn: 'Somchai E Jaidee' })],
    );
    expect(r.member?.id).toBe(MEMBER_ID);
  });

  it('refuses a transliteration variant rather than guessing', async () => {
    const r = await resolveInMemory(
      { id: USER_ID, name: 'Somchai Jai-dee', employeeId: null },
      [member({ employeeId: null })],
    );
    expect(r.member).toBeNull();
    expect(r.refusal).toContain('Somchai Jai-dee');
  });

  it('refuses, naming the count, when a name matches more than one record', async () => {
    const r = await resolveInMemory({ id: USER_ID, name: 'Somchai Jaidee', employeeId: null }, [
      member({ id: 'fm-a', employeeId: null }),
      member({ id: 'fm-b', employeeId: null }),
    ]);
    expect(r.member).toBeNull();
    expect(r.refusal).toMatch(/matches 2 staff records/);
  });

  it('still reaches records whose name is nothing but initials', async () => {
    // These reduce to an EMPTY substantial-token key. An index that skipped
    // them would silently drop candidates the matcher's all-tokens-equal
    // branch would have accepted, which would make the bucketing a filter that
    // changes verdicts rather than one that only narrows.
    const r = await resolveInMemory({ id: USER_ID, name: 'B A', employeeId: null }, [
      member({ id: 'fm-initials', employeeId: null, nameEn: 'A B' }),
    ]);
    expect(r.member?.id).toBe('fm-initials');
  });

  it('reads nothing from the database', async () => {
    mocks.facultyMemberFindMany.mockClear();
    mocks.userFindUnique.mockClear();
    await resolveInMemory({ id: USER_ID, name: 'Somchai Jaidee', employeeId: null }, [
      member({ employeeId: null }),
    ]);
    expect(mocks.facultyMemberFindMany).not.toHaveBeenCalled();
    expect(mocks.userFindUnique).not.toHaveBeenCalled();
  });
});

// ── 1. Refusals that write nothing ──────────────────────────────────────────

describe('runScholarFetch — resolution refusals', () => {
  it('refuses with no run row when no staff record matches', async () => {
    mocks.facultyMemberFindMany.mockResolvedValue([]);
    mocks.userFindUnique.mockResolvedValue({ id: USER_ID, name: 'Nobody Here', employeeId: null });

    const result = await runScholarFetch(
      {
      userId: USER_ID,
      triggeredById: USER_ID,
      trigger: 'SELF',
      actorRole: 'ANALYST',
      fetchPage: unreachableFetcher(),
      },
      { now: NOW },
    );

    expect(result.status).toBe('REFUSED');
    expect(result.runId).toBeNull();
    expect(result.reason).toContain('Nobody Here');
    expect(mocks.runCreate).not.toHaveBeenCalled();
    expect(mocks.runFindMany).not.toHaveBeenCalled(); // quota never even read
    expect(mocks.researchOutputCreateMany).not.toHaveBeenCalled();
  });

  it('refuses with no run row when the match is ambiguous', async () => {
    mocks.facultyMemberFindMany.mockResolvedValue([member({ id: 'fm-a' }), member({ id: 'fm-b' })]);

    const result = await runScholarFetch(
      {
      userId: USER_ID,
      triggeredById: USER_ID,
      trigger: 'SELF',
      actorRole: 'ANALYST',
      fetchPage: unreachableFetcher(),
      },
      { now: NOW },
    );

    expect(result.status).toBe('REFUSED');
    expect(result.runId).toBeNull();
    expect(result.reason).toMatch(/2 staff records/);
    expect(mocks.runCreate).not.toHaveBeenCalled();
  });

  it('refuses with no run row when the user record does not exist', async () => {
    mocks.userFindUnique.mockResolvedValue(null);

    const result = await runScholarFetch(
      {
      userId: USER_ID,
      triggeredById: USER_ID,
      trigger: 'SELF',
      actorRole: 'ANALYST',
      fetchPage: unreachableFetcher(),
      },
      { now: NOW },
    );

    expect(result.status).toBe('REFUSED');
    expect(result.runId).toBeNull();
    expect(mocks.runCreate).not.toHaveBeenCalled();
  });

  it('refuses when neither the staff record nor the account carries a usable name', async () => {
    mocks.userFindUnique.mockResolvedValue({ id: USER_ID, name: '   ', employeeId: 'HR-9' });
    mocks.facultyMemberFindMany.mockResolvedValue([member({ nameEn: '  ' })]);

    const result = await runScholarFetch(
      {
      userId: USER_ID,
      triggeredById: USER_ID,
      trigger: 'SELF',
      actorRole: 'ANALYST',
      fetchPage: unreachableFetcher(),
      },
      { now: NOW },
    );

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

    const result = await runScholarFetch(
      {
      userId: USER_ID,
      triggeredById: USER_ID,
      trigger: 'SELF',
      actorRole: 'ANALYST',
      fetchPage,
      },
      { now: NOW },
    );

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

    const result = await runScholarFetch(
      {
      userId: USER_ID,
      triggeredById: 'admin-1',
      trigger: 'ADMIN',
      actorRole: 'ADMIN',
      fetchPage: unreachableFetcher(),
      },
      { now: NOW },
    );

    // Got past quota (refused later, for the unbound profile — a different reason).
    expect(result.reason).toBe(SCHOLAR_NEEDS_BINDING);
  });
});

// ── 3. Binding gate ─────────────────────────────────────────────────────────

describe('runScholarFetch — unbound profile', () => {
  it('refuses with needs-binding, spends no credit, and consumes no quota', async () => {
    mocks.facultyMemberFindMany.mockResolvedValue([member({ scholarProfileId: null })]);
    const fetchPage = unreachableFetcher();

    const result = await runScholarFetch(
      {
      userId: USER_ID,
      triggeredById: USER_ID,
      trigger: 'SELF',
      actorRole: 'ANALYST',
      fetchPage,
      },
      { now: NOW },
    );

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

    const result = await runScholarFetch(
      {
      userId: USER_ID,
      triggeredById: USER_ID,
      trigger: 'SELF',
      actorRole: 'ANALYST',
      fetchPage,
      },
      { now: NOW },
    );

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

    const result = await runScholarFetch(
      {
      userId: USER_ID,
      triggeredById: USER_ID,
      trigger: 'SELF',
      actorRole: 'ANALYST',
      fetchPage,
      },
      { now: NOW },
    );

    expect(result.creditsUsed).toBe(0);
  });

  it('pages until a short page', async () => {
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

    const result = await runScholarFetch(
      {
      userId: USER_ID,
      triggeredById: USER_ID,
      trigger: 'SELF',
      actorRole: 'ANALYST',
      fetchPage,
      },
      { now: NOW },
    );

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

    const result = await runScholarFetch(
      {
      userId: USER_ID,
      triggeredById: USER_ID,
      trigger: 'SELF',
      actorRole: 'ANALYST',
      fetchPage,
      },
      { now: NOW },
    );

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

    const result = await runScholarFetch(
      {
      userId: USER_ID,
      triggeredById: USER_ID,
      trigger: 'SELF',
      actorRole: 'ANALYST',
      fetchPage,
      },
      { now: NOW },
    );

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

    const result = await runScholarFetch(
      {
      userId: USER_ID,
      triggeredById: USER_ID,
      trigger: 'SELF',
      actorRole: 'ANALYST',
      fetchPage,
      },
      { now: NOW },
    );

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

    const result = await runScholarFetch(
      {
      userId: USER_ID,
      triggeredById: USER_ID,
      trigger: 'SELF',
      actorRole: 'ANALYST',
      fetchPage,
      },
      { now: NOW },
    );

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

    const result = await runScholarFetch(
      {
      userId: USER_ID,
      triggeredById: USER_ID,
      trigger: 'SELF',
      actorRole: 'ANALYST',
      fetchPage,
      },
      { parsePage, now: NOW },
    );

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

// ── 9. Not-a-profile-page guard (B1) ────────────────────────────────────────

describe('runScholarFetch — pages that are not a publication list', () => {
  // Google serves consent screens and robot interstitials with HTTP 200, so
  // the ScrapingBee client does not throw and the parser simply finds no
  // rows. Before the profile-header guard this landed as SUCCEEDED with zero
  // papers: the UI said it worked, the credits were gone, and because
  // SUCCEEDED is exactly what the quota unit counts the person was locked out
  // for 30 days.
  const CONSENT_PAGE =
    '<html><body><div>Before you continue to Google</div><a>I agree</a></body></html>';

  it('FAILS on a consent/robot interstitial instead of reporting a clean empty fetch', async () => {
    const fetchPage = vi.fn(async () => pageResult(CONSENT_PAGE, 15));

    const result = await runScholarFetch(
      {
        userId: USER_ID,
        triggeredById: USER_ID,
        trigger: 'SELF',
        actorRole: 'ANALYST',
        fetchPage,
      },
      { now: NOW },
    );

    expect(result.status).toBe('FAILED');
    expect(result.reason).toMatch(/no profile header/i);
    // Credits still recorded — money was spent whether or not it worked.
    expect(result.creditsUsed).toBe(15);
    // FAILED is the status the quota unit ignores, so the month survives.
    expect(mocks.runUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED', creditsUsed: 15 }) }),
    );
    expect(mocks.researchOutputCreateMany).not.toHaveBeenCalled();
    // The raw page is still archived, so the interstitial is diagnosable.
    expect(mocks.archiveCreate).toHaveBeenCalled();
  });

  it('SUCCEEDS on a genuinely empty profile — a header with no papers is real', async () => {
    const fetchPage = vi.fn(async () => pageResult(page([]), 15));
    mocks.researchOutputCreateMany.mockResolvedValue({ count: 0 });

    const result = await runScholarFetch(
      {
        userId: USER_ID,
        triggeredById: USER_ID,
        trigger: 'SELF',
        actorRole: 'ANALYST',
        fetchPage,
      },
      { now: NOW },
    );

    expect(result.status).toBe('SUCCEEDED');
    expect(result.papersFound).toBe(0);
  });

  it('FAILS when the linked profile turns out to be someone else', async () => {
    // Re-verifies the binding on every fetch, by the same rule bind applies.
    // Catches a rebind underneath a fetch, and a staff record renamed after
    // binding.
    const fetchPage = vi.fn(async () =>
      pageResult(
        page([row({ paperId: 'x:1', title: 'Their paper', year: 2024, citations: 9 })], 'Geoffrey Hinton'),
      ),
    );

    const result = await runScholarFetch(
      {
        userId: USER_ID,
        triggeredById: USER_ID,
        trigger: 'SELF',
        actorRole: 'ANALYST',
        fetchPage,
      },
      { now: NOW },
    );

    expect(result.status).toBe('FAILED');
    expect(result.reason).toMatch(/Geoffrey Hinton[\s\S]*Somchai Jaidee/);
    expect(mocks.researchOutputCreateMany).not.toHaveBeenCalled();
  });

});

// ── 10. Finalisation never escapes (B2) ─────────────────────────────────────

describe('runScholarFetch — bookkeeping failures', () => {
  it('does not throw, and does not disown committed rows, when finalisation fails', async () => {
    const fetchPage = vi.fn(async () =>
      pageResult(page([row({ paperId: `${PROFILE_ID}:p`, title: 'P', year: 2024, citations: 1 })]), 15),
    );
    mocks.researchOutputCreateMany.mockResolvedValue({ count: 1 });
    mocks.runUpdate.mockRejectedValue(new Error('write CONN_CLOSED after commit'));

    const result = await runScholarFetch(
      {
        userId: USER_ID,
        triggeredById: USER_ID,
        trigger: 'SELF',
        actorRole: 'ANALYST',
        fetchPage,
      },
      { now: NOW },
    );

    // The merge committed, so the run succeeded — a failure to write that
    // down must not turn into a 500 that invites the operator to re-run and
    // spend another 15 credits against a quota that ignores FAILED.
    expect(result.status).toBe('SUCCEEDED');
    expect(result.papersInserted).toBe(1);
    expect(mocks.researchOutputCreateMany).toHaveBeenCalled();
  });

  it('surfaces the ORIGINAL error when the failure-path write also fails', async () => {
    const fetchPage = vi.fn(async () => {
      throw new Error('ScrapingBee request failed transiently after 1 retry (HTTP 503).');
    });
    mocks.runUpdate.mockRejectedValue(new Error('and the database is down too'));

    const result = await runScholarFetch(
      {
        userId: USER_ID,
        triggeredById: USER_ID,
        trigger: 'SELF',
        actorRole: 'ANALYST',
        fetchPage,
      },
      { now: NOW },
    );

    expect(result.status).toBe('FAILED');
    expect(result.reason).toContain('HTTP 503');
    expect(result.reason).not.toContain('database is down');
  });

  it('does not escape when the unbound-profile refusal cannot be written', async () => {
    mocks.facultyMemberFindMany.mockResolvedValue([member({ scholarProfileId: null })]);
    mocks.runUpdate.mockRejectedValue(new Error('write failed'));

    const result = await runScholarFetch(
      {
        userId: USER_ID,
        triggeredById: USER_ID,
        trigger: 'SELF',
        actorRole: 'ANALYST',
        fetchPage: unreachableFetcher(),
      },
      { now: NOW },
    );

    expect(result.status).toBe('REFUSED');
    expect(result.reason).toBe(SCHOLAR_NEEDS_BINDING);
  });

  it('reports credits and papers seen so far when the walk fails part-way', async () => {
    const fullPage = page(
      Array.from({ length: SCHOLAR_PAGE_SIZE }, (_, i) =>
        row({ paperId: `${PROFILE_ID}:p${i}`, title: `Paper ${i}`, year: 2020, citations: 1 }),
      ),
    );
    const fetchPage = vi
      .fn<(url: string) => Promise<ScholarPageResult>>()
      .mockResolvedValueOnce(pageResult(fullPage, 15))
      .mockRejectedValueOnce(new Error('ScrapingBee timed out'));

    const result = await runScholarFetch(
      {
        userId: USER_ID,
        triggeredById: USER_ID,
        trigger: 'SELF',
        actorRole: 'ANALYST',
        fetchPage,
      },
      { now: NOW },
    );

    expect(result.status).toBe('FAILED');
    // Money was spent on page 1; the ledger has to say so.
    expect(result.creditsUsed).toBe(15);
    expect(result.papersFound).toBe(SCHOLAR_PAGE_SIZE);
  });
});

// ── 11. One fetch at a time ─────────────────────────────────────────────────

describe('runScholarFetch — concurrency guard', () => {
  it('refuses a second fetch while one is unfinished, without opening a run or fetching', async () => {
    const startedAt = new Date(NOW.getTime() - 60_000);
    mocks.runFindFirst.mockResolvedValue({ id: 'run-in-flight', startedAt });
    const fetchPage = unreachableFetcher();

    const result = await runScholarFetch(
      {
        userId: USER_ID,
        triggeredById: USER_ID,
        trigger: 'SELF',
        actorRole: 'ANALYST',
        fetchPage,
      },
      { now: NOW },
    );

    expect(result.status).toBe('REFUSED');
    expect(result.runId).toBe('run-in-flight');
    expect(result.reason).toMatch(/has not finished/);
    expect(fetchPage).not.toHaveBeenCalled();
    expect(mocks.runCreate).not.toHaveBeenCalled();
  });

  it('looks only at recent unfinished runs — an old stuck row cannot block forever', async () => {
    await runScholarFetch(
      {
        userId: USER_ID,
        triggeredById: USER_ID,
        trigger: 'SELF',
        actorRole: 'ANALYST',
        fetchPage: vi.fn(async () => pageResult(page([]))),
      },
      { now: NOW },
    );

    const where = (mocks.runFindFirst.mock.calls[0]![0] as { where: Record<string, unknown> }).where;
    expect(where).toMatchObject({ userId: USER_ID, status: 'FAILED', finishedAt: null });
    expect(where.startedAt).toEqual({ gt: new Date(NOW.getTime() - 15 * 60 * 1000) });
  });
});

// ── 12. Provenance on the run row ───────────────────────────────────────────

describe('runScholarFetch — run row provenance', () => {
  it('records WHICH profile it scraped, so a later rebind cannot orphan the run', async () => {
    await runScholarFetch(
      {
        userId: USER_ID,
        triggeredById: USER_ID,
        trigger: 'SELF',
        actorRole: 'ANALYST',
        fetchPage: vi.fn(async () => pageResult(page([]))),
      },
      { now: NOW },
    );

    expect(mocks.runCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          scholarProfileId: PROFILE_ID,
          searchQuery: 'Somchai Jaidee',
          status: 'FAILED', // opened unfinished; finalised below
          errorText: 'Fetch in progress.',
        }),
      }),
    );
  });
});

// ── 13. A wall on a later page (B1, second half) ────────────────────────────

describe('runScholarFetch — an interstitial past page 1', () => {
  const CONSENT_PAGE =
    '<html><body><div>Before you continue to Google</div><a>I agree</a></body></html>';

  const fullFirstPage = () =>
    page(
      Array.from({ length: SCHOLAR_PAGE_SIZE }, (_, i) =>
        row({ paperId: `${PROFILE_ID}:p${i}`, title: `Paper ${i}`, year: 2020, citations: 1 }),
      ),
    );

  it('FAILS when page 2 is a consent wall, instead of calling it the end of the list', async () => {
    // A zero-row page is what a finished list looks like AND what a wall looks
    // like. Checking only page 1 for a profile header left this reported as a
    // clean 100-paper SUCCEEDED: 30 credits gone, the 30-day allowance burnt,
    // and everything past page 1 silently missing. It bites the most prolific
    // researchers first — they are the only ones with a second page.
    const fetchPage = vi
      .fn<(url: string) => Promise<ScholarPageResult>>()
      .mockResolvedValueOnce(pageResult(fullFirstPage(), 15))
      .mockResolvedValueOnce(pageResult(CONSENT_PAGE, 15));

    const result = await runScholarFetch(
      {
        userId: USER_ID,
        triggeredById: USER_ID,
        trigger: 'SELF',
        actorRole: 'ANALYST',
        fetchPage,
      },
      { now: NOW },
    );

    expect(result.status).toBe('FAILED');
    expect(result.reason).toMatch(/cstart=100/);
    expect(result.creditsUsed).toBe(30);
    expect(mocks.researchOutputCreateMany).not.toHaveBeenCalled();
    // Archived first, so the wall itself can be read back.
    expect(mocks.archiveCreate).toHaveBeenCalled();
  });

  it('SUCCEEDS when page 2 is a real profile page that is simply empty', async () => {
    const fetchPage = vi
      .fn<(url: string) => Promise<ScholarPageResult>>()
      .mockResolvedValueOnce(pageResult(fullFirstPage(), 15))
      .mockResolvedValueOnce(pageResult(page([]), 15));
    mocks.researchOutputCreateMany.mockResolvedValue({ count: SCHOLAR_PAGE_SIZE });

    const result = await runScholarFetch(
      {
        userId: USER_ID,
        triggeredById: USER_ID,
        trigger: 'SELF',
        actorRole: 'ANALYST',
        fetchPage,
      },
      { now: NOW },
    );

    expect(result.status).toBe('SUCCEEDED');
    expect(result.papersFound).toBe(SCHOLAR_PAGE_SIZE);
  });

  it('treats a RE-SERVED page as a benign ending, not as an incomplete list', async () => {
    // Exactly SCHOLAR_PAGE_SIZE papers: Scholar answers cstart=100 with page 1
    // again. Every paper parses, all are duplicates. The import is COMPLETE —
    // flagging "the list may be incomplete" here would put a false caveat on a
    // Council-facing provenance record, which is how operators learn to ignore
    // the flag.
    const same = fullFirstPage();
    const fetchPage = vi
      .fn<(url: string) => Promise<ScholarPageResult>>()
      .mockResolvedValueOnce(pageResult(same, 15))
      .mockResolvedValueOnce(pageResult(same, 15));
    mocks.researchOutputCreateMany.mockResolvedValue({ count: SCHOLAR_PAGE_SIZE });

    const result = await runScholarFetch(
      {
        userId: USER_ID,
        triggeredById: USER_ID,
        trigger: 'SELF',
        actorRole: 'ANALYST',
        fetchPage,
      },
      { now: NOW },
    );

    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('SUCCEEDED');
    expect(result.reason).toBeNull();
    expect(result.papersFound).toBe(SCHOLAR_PAGE_SIZE);
  });

  it('an anomaly that imported NOTHING is FAILED, so the allowance survives', async () => {
    // PARTIAL counts against the 30-day quota — correctly, since it normally
    // means data arrived. A drifted first page means nothing arrived, so
    // PARTIAL would leave the person locked out for a month having imported
    // no papers: the same outcome the interstitial defect produced, one
    // status label further along.
    const junk = page(Array.from({ length: SCHOLAR_PAGE_SIZE }, () => '<tr class="gsc_a_tr"><td>drifted</td></tr>'));
    const fetchPage = vi.fn(async () => pageResult(junk, 15));
    mocks.researchOutputCreateMany.mockResolvedValue({ count: 0 });

    const result = await runScholarFetch(
      {
        userId: USER_ID,
        triggeredById: USER_ID,
        trigger: 'SELF',
        actorRole: 'ANALYST',
        fetchPage,
      },
      { now: NOW },
    );

    expect(result.status).toBe('FAILED');
    expect(result.papersFound).toBe(0);
    expect(result.reason).toMatch(/could not read/i);
  });

  it('an anomaly that DID import stays PARTIAL', async () => {
    // Page 1 readable, page 2 drifted: papers arrived, but not all of them.
    const drifted = page(
      Array.from({ length: SCHOLAR_PAGE_SIZE }, () => '<tr class="gsc_a_tr"><td>drifted</td></tr>'),
    );
    const fetchPage = vi
      .fn<(url: string) => Promise<ScholarPageResult>>()
      .mockResolvedValueOnce(pageResult(fullFirstPage(), 15))
      .mockResolvedValueOnce(pageResult(drifted, 15));
    mocks.researchOutputCreateMany.mockResolvedValue({ count: SCHOLAR_PAGE_SIZE });

    const result = await runScholarFetch(
      {
        userId: USER_ID,
        triggeredById: USER_ID,
        trigger: 'SELF',
        actorRole: 'ANALYST',
        fetchPage,
      },
      { now: NOW },
    );

    expect(result.status).toBe('PARTIAL');
    expect(result.papersFound).toBe(SCHOLAR_PAGE_SIZE);
  });
});
