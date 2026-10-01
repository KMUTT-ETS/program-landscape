import { describe, expect, it, vi, beforeEach } from 'vitest';
import { buildScholarCitationUrl, type ScholarPaper } from '@kku/shared';
import {
  ScrapingBeeAuthError,
  ScrapingBeeConfigError,
  ScrapingBeeQuotaError,
  ScrapingBeeTransientError,
} from '@kku/shared/src/scholar/scrapingbee';
import { Prisma } from '@prisma/client';

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
  researchOutputUpdate: vi.fn(),
  // The shortened-author-list read (its `where` filters on scholarAuthors).
  // Routed apart from researchOutputFindMany so a test that sets the merge's
  // existing rows does not also hand those rows to the detail-page phase.
  researchOutputFindShortened: vi.fn(),
  // Counts of shortened rows: the plain one (pending) and the one ANDed with
  // detailAttempts >= 3 (abandoned). Routed by the presence of `AND`.
  researchOutputCountShortened: vi.fn(),
  researchOutputCountAbandoned: vi.fn(),
  cacheUpdateMany: vi.fn(),
  auditLogCreate: vi.fn(),
  bindAttemptFindMany: vi.fn(),
  bindAttemptCreate: vi.fn(),
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
      findMany: (args: { where?: Record<string, unknown> } | undefined) =>
        args?.where && 'scholarAuthors' in args.where
          ? mocks.researchOutputFindShortened(args)
          : mocks.researchOutputFindMany(args),
      createMany: mocks.researchOutputCreateMany,
      updateMany: mocks.researchOutputUpdateMany,
      update: mocks.researchOutputUpdate,
      count: (args: { where?: Record<string, unknown> } | undefined) =>
        args?.where && 'AND' in args.where
          ? mocks.researchOutputCountAbandoned(args)
          : mocks.researchOutputCountShortened(args),
    },
    staffPublicationsCache: { updateMany: mocks.cacheUpdateMany },
    auditLog: { create: mocks.auditLogCreate },
    scholarBindAttempt: {
      findMany: mocks.bindAttemptFindMany,
      create: mocks.bindAttemptCreate,
    },
    $transaction: mocks.transaction,
  },
}));

import {
  SCHOLAR_MAX_PAGES,
  SCHOLAR_AUTHOR_DETAIL_CAP,
  SCHOLAR_AUTHOR_DETAIL_CANDIDATES,
  SCHOLAR_AUTHOR_DETAIL_MAX_ATTEMPTS,
  SCHOLAR_NEEDS_BINDING,
  SCHOLAR_PAGE_SIZE,
  bindScholarProfile,
  buildScholarProfilePageUrl,
  buildScholarProfileUrl,
  buildScholarSearchUrl,
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
  authors?: string;
}): string {
  const venue = opts.venue ?? 'Journal of Testing';
  const authors = opts.authors ?? 'A Author, B Author';
  return (
    '<tr class="gsc_a_tr">' +
    '<td class="gsc_a_t">' +
    `<a href="/citations?view_op=view_citation&hl=en&user=${PROFILE_ID}&citation_for_view=${opts.paperId}" class="gsc_a_at">${opts.title}</a>` +
    `<div class="gs_gray">${authors}</div>` +
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

// ── Search-page fixtures ────────────────────────────────────────────────────
// Shape taken from the VERIFIED structure documented in
// packages/shared/src/scholar/search-parse.ts, which was itself read off the
// real ScrapingBee captures under packages/shared/test/fixtures/scholar/.
// The runner parses these with the SHIPPED parser — it is not injectable —
// so markup that drifted from the real thing fails these tests immediately
// rather than passing against a stub.

const RESOLVED_ID = 'RESOLVED123';

/** One article result. `authorLink` makes the first author a profile anchor. */
function hitRow(opts: {
  title: string;
  authors: string;
  year: number;
  authorLink?: { name: string; id: string };
}): string {
  const linked = opts.authorLink
    ? `<a href="/citations?user=${opts.authorLink.id}&hl=en&oi=sra">${opts.authorLink.name}</a>, `
    : '';
  return (
    '<div class="gs_r gs_or gs_scl">' +
    '<div class="gs_ri">' +
    `<h3 class="gs_rt"><a href="https://example.org/p">${opts.title}</a></h3>` +
    `<div class="gs_a">${linked}${opts.authors} - Journal of Testing, ${opts.year} - Elsevier</div>` +
    '</div></div>'
  );
}

/** The "User profiles for X" cluster. `names` gives one card each. */
function profileCluster(cards: { id: string; name: string }[]): string {
  const rows = cards
    .map(
      (c) =>
        '<tr><td></td><td>' +
        `<h4 class="gs_rt2"><a href="/citations?user=${c.id}&hl=en&oi=ao"><b>${c.name}</b></a></h4>` +
        '<div class="gs_nph">Khon Kaen University</div>' +
        '</td></tr>',
    )
    .join('');
  return (
    '<div class="gs_r">' +
    '<h3 class="gs_rt"><a href="/citations?view_op=search_authors&mauthors=x">' +
    'User profiles for <b>someone</b></a></h3>' +
    `<table><tbody>${rows}</tbody></table>` +
    '</div>'
  );
}

function searchPage(opts: { cards?: { id: string; name: string }[]; rows?: string[] }): string {
  return (
    '<html><body>' +
    (opts.cards && opts.cards.length > 0 ? profileCluster(opts.cards) : '') +
    (opts.rows ?? []).join('') +
    '</body></html>'
  );
}

/** `SCHOLAR_SEARCH_PAGE_SIZE` rows — a FULL page, i.e. Scholar truncated. */
function fullHitRows(authorLink?: { name: string; id: string }): string[] {
  return Array.from({ length: 10 }, (_, i) =>
    hitRow({ title: `Result ${i}`, authors: 'A Other', year: 2020, authorLink }),
  );
}

/**
 * A fetcher that answers `/scholar?q=` from `search` and every
 * `/citations?user=` from `profiles`, keyed by profile id, and records every
 * URL it was asked for. `Spb-Cost` is the REAL billing shape: 75 for a
 * search, 15 for a profile page.
 */
function routedFetcher(opts: {
  search: string[];
  profiles: Record<string, string>;
}): ReturnType<typeof vi.fn> & { urls: string[] } {
  const urls: string[] = [];
  let searchIndex = 0;
  const fn = vi.fn(async (url: string): Promise<ScholarPageResult> => {
    urls.push(url);
    if (url.includes('/scholar?')) {
      const html = opts.search[Math.min(searchIndex, opts.search.length - 1)] ?? '';
      searchIndex += 1;
      return pageResult(html, 75);
    }
    const id = new URL(url).searchParams.get('user') ?? '';
    return pageResult(opts.profiles[id] ?? '<html><body></body></html>', 15);
  });
  return Object.assign(fn, { urls });
}

/** The staff record for someone who has never been bound. */
function unboundMember(nameEn: string): ScholarFacultyMember {
  return member({ nameEn, scholarProfileId: null });
}

/**
 * The runner calls `bindScholarProfile`, which re-reads the staff record and
 * checks for a conflicting binding. Point both at the same person.
 */
function expectBindableMember(m: ScholarFacultyMember): void {
  mocks.facultyMemberFindMany.mockResolvedValue([m]);
  mocks.facultyMemberFindUnique.mockResolvedValue({
    id: m.id,
    nameEn: m.nameEn,
    nameTh: m.nameTh,
    employeeId: m.employeeId,
    scholarProfileId: m.scholarProfileId,
    scholarProfileUrl: null,
  });
  mocks.facultyMemberFindFirst.mockResolvedValue(null); // nobody else holds it
  mocks.facultyMemberUpdate.mockResolvedValue({ id: m.id });
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
  mocks.researchOutputFindShortened.mockResolvedValue([]);
  mocks.researchOutputCountShortened.mockResolvedValue(0);
  mocks.researchOutputCountAbandoned.mockResolvedValue(0);
  mocks.researchOutputUpdate.mockResolvedValue({});
  mocks.cacheUpdateMany.mockResolvedValue({ count: 1 });
  mocks.bindAttemptFindMany.mockResolvedValue([]); // no bind attempts today
  mocks.bindAttemptCreate.mockResolvedValue({ id: 'bind-1' });
  mocks.auditLogCreate.mockResolvedValue({ id: 'audit-1' });
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
      // Unbound, so the run reaches the search branch and resolves nothing.
      fetchPage: routedFetcher({ search: [searchPage({ rows: [] })], profiles: {} }),
      },
      { now: NOW },
    );

    // Got past quota (refused later, for the unresolved profile — a different reason).
    expect(result.reason).toBe(SCHOLAR_NEEDS_BINDING);
  });
});

// ── 3. Binding gate ─────────────────────────────────────────────────────────

describe('runScholarFetch — unbound profile is the SEARCH branch, not a refusal', () => {
  it('searches by the English name, records what it resolved, then fetches that profile', async () => {
    const m = unboundMember('Banchob Sripa');
    expectBindableMember(m);
    const fetchPage = routedFetcher({
      search: [searchPage({ cards: [{ id: RESOLVED_ID, name: 'Banchob Sripa' }] })],
      profiles: {
        [RESOLVED_ID]: page(
          [row({ paperId: 'p1', title: 'A paper', year: 2024, citations: 3 })],
          'Banchob Sripa',
        ),
      },
    });
    mocks.researchOutputCreateMany.mockResolvedValue({ count: 1 });

    const result = await runScholarFetch(
      { userId: USER_ID, triggeredById: USER_ID, trigger: 'SELF', actorRole: 'ANALYST', fetchPage },
      { now: NOW },
    );

    expect(result.status).toBe('SUCCEEDED');
    expect(result.papersInserted).toBe(1);

    // Search first, with `as_vis=1` and the English name; then the profile.
    expect(fetchPage.urls[0]).toBe(buildScholarSearchUrl('Banchob Sripa', { asVis: true }));
    expect(fetchPage.urls[1]).toContain(`user=${RESOLVED_ID}`);

    // The id was RECORDED, through the one binding write.
    expect(mocks.facultyMemberUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          scholarProfileId: RESOLVED_ID,
          scholarProfileUrl: buildScholarProfileUrl(RESOLVED_ID),
        }),
      }),
    );

    // …and the run row now names the profile it actually scraped.
    expect(mocks.runUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'SUCCEEDED', scholarProfileId: RESOLVED_ID }),
      }),
    );
  });

  it('sums the REAL Spb-Cost — one 75-credit search plus 15 per profile page', async () => {
    const m = unboundMember('Banchob Sripa');
    expectBindableMember(m);
    // Two profile pages: a full one, then a short one that ends the walk.
    const fullProfile = page(
      Array.from({ length: SCHOLAR_PAGE_SIZE }, (_, i) =>
        row({ paperId: `p${i}`, title: `Paper ${i}`, year: 2020, citations: 1 }),
      ),
      'Banchob Sripa',
    );
    const shortProfile = page([row({ paperId: 'last', title: 'Last', year: 2021, citations: 1 })], 'Banchob Sripa');
    let profileCall = 0;
    const fetchPage = vi.fn(async (url: string): Promise<ScholarPageResult> => {
      if (url.includes('/scholar?')) {
        return pageResult(searchPage({ cards: [{ id: RESOLVED_ID, name: 'Banchob Sripa' }] }), 75);
      }
      profileCall += 1;
      return pageResult(profileCall === 1 ? fullProfile : shortProfile, 15);
    });
    mocks.researchOutputCreateMany.mockResolvedValue({ count: 11 });

    const result = await runScholarFetch(
      { userId: USER_ID, triggeredById: USER_ID, trigger: 'SELF', actorRole: 'ANALYST', fetchPage },
      { now: NOW },
    );

    // 75 + 15 + 15. Never pages × a constant — the two kinds are priced apart.
    expect(result.creditsUsed).toBe(105);
  });

  it('records the binding as MACHINE-made, in the column an auditor filters on', async () => {
    const m = unboundMember('Banchob Sripa');
    expectBindableMember(m);
    const fetchPage = routedFetcher({
      search: [searchPage({ cards: [{ id: RESOLVED_ID, name: 'Banchob Sripa' }] })],
      profiles: { [RESOLVED_ID]: page([], 'Banchob Sripa') },
    });

    await runScholarFetch(
      { userId: USER_ID, triggeredById: 'admin-1', trigger: 'ADMIN', actorRole: 'ADMIN', fetchPage },
      { now: NOW },
    );

    const audit = mocks.auditLogCreate.mock.calls[0]![0] as {
      data: { action: string; userId: string; payloadJson: Record<string, unknown> };
    };
    // The verb, not a buried flag: `WHERE action LIKE 'scholar.profile.auto-%'`
    // has to be the query that finds every machine-chosen binding.
    expect(audit.data.action).toBe('scholar.profile.auto-bind');
    // The actor still owns it — a human pressed the button.
    expect(audit.data.userId).toBe('admin-1');

    const resolution = audit.data.payloadJson.resolution as Record<string, unknown>;
    expect(resolution).toMatchObject({
      version: 'scholar-resolution.v1',
      parserVersion: 'scholar-search-parse.v1',
      searchedName: 'Banchob Sripa',
      searchUrl: buildScholarSearchUrl('Banchob Sripa', { asVis: true }),
      via: 'primary-card',
      matchedName: 'Banchob Sripa',
      candidateIds: [],
      // Ties the decision to the archived page, so it is re-readable and not
      // merely re-describable.
      fetchRunId: 'run-1',
    });
  });

  it('verifies against the page it already fetched rather than paying for it twice', async () => {
    const m = unboundMember('Banchob Sripa');
    expectBindableMember(m);
    const fetchPage = routedFetcher({
      search: [searchPage({ cards: [{ id: RESOLVED_ID, name: 'Banchob Sripa' }] })],
      profiles: { [RESOLVED_ID]: page([], 'Banchob Sripa') },
    });

    await runScholarFetch(
      { userId: USER_ID, triggeredById: USER_ID, trigger: 'SELF', actorRole: 'ANALYST', fetchPage },
      { now: NOW },
    );

    // One search, one profile page. A second fetch of the SAME profile URL
    // would be `bindScholarProfile` verifying for itself — 15 credits for
    // bytes we already held, on every first-time sync.
    expect(fetchPage.urls).toHaveLength(2);
  });

  it('takes a byline anchor when there is no profile card, without paying for a probe', async () => {
    const m = unboundMember('Prinya Chindaprasirt');
    expectBindableMember(m);
    // A FULL page with no cluster — which alone would earn the 75-credit
    // probe — but one byline anchor names the person we searched for.
    const fetchPage = routedFetcher({
      search: [searchPage({ rows: fullHitRows({ name: 'P Chindaprasirt', id: RESOLVED_ID }) })],
      profiles: { [RESOLVED_ID]: page([], 'Prinya Chindaprasirt') },
    });

    await runScholarFetch(
      { userId: USER_ID, triggeredById: USER_ID, trigger: 'SELF', actorRole: 'ANALYST', fetchPage },
      { now: NOW },
    );

    expect(mocks.facultyMemberUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ scholarProfileId: RESOLVED_ID }) }),
    );
    const audit = mocks.auditLogCreate.mock.calls[0]![0] as { data: { payloadJson: { resolution: { via: string } } } };
    expect(audit.data.payloadJson.resolution.via).toBe('byline-link');
    // Exactly one search: the byline check is free and runs before the probe.
    expect(fetchPage.urls.filter((u) => u.includes('/scholar?'))).toHaveLength(1);
  });

  it('probes without as_vis on a FULL page, and only once', async () => {
    const m = unboundMember('Somchai Jaidee');
    expectBindableMember(m);
    // Full page, no cluster, and every byline anchor is a co-author — so the
    // probe is earned. The probe comes back full and empty-handed too; asking
    // a third time would be another 75 credits for the same answer.
    const stubborn = searchPage({ rows: fullHitRows({ name: 'A Other', id: 'COAUTHOR1' }) });
    const fetchPage = routedFetcher({ search: [stubborn, stubborn], profiles: {} });

    const result = await runScholarFetch(
      { userId: USER_ID, triggeredById: USER_ID, trigger: 'SELF', actorRole: 'ANALYST', fetchPage },
      { now: NOW },
    );

    const searches = fetchPage.urls.filter((u) => u.includes('/scholar?'));
    expect(searches).toHaveLength(2);
    expect(searches[0]).toContain('as_vis=1');
    expect(searches[1]).not.toContain('as_vis');
    expect(result.creditsUsed).toBe(150);
    expect(result.reason).toBe(SCHOLAR_NEEDS_BINDING);
  });

  it('does NOT probe on a short page — Scholar already returned everything it had', async () => {
    const m = unboundMember('Somchai Jaidee');
    expectBindableMember(m);
    const fetchPage = routedFetcher({
      search: [searchPage({ rows: [hitRow({ title: 'Only one', authors: 'A Other', year: 2020 })] })],
      profiles: {},
    });

    const result = await runScholarFetch(
      { userId: USER_ID, triggeredById: USER_ID, trigger: 'SELF', actorRole: 'ANALYST', fetchPage },
      { now: NOW },
    );

    expect(fetchPage.urls.filter((u) => u.includes('/scholar?'))).toHaveLength(1);
    expect(result.creditsUsed).toBe(75);
  });

  it('fetches at most three candidates when several cards come back', async () => {
    const m = unboundMember('Somchai Jaidee');
    expectBindableMember(m);
    const fetchPage = routedFetcher({
      search: [
        searchPage({
          cards: [
            { id: 'CAND1', name: 'Another Person' },
            { id: 'CAND2', name: 'Different Human' },
            { id: 'CAND3', name: 'Third Party' },
            { id: 'CAND4', name: 'Fourth Wheel' },
          ],
        }),
      ],
      profiles: {
        CAND1: page([], 'Another Person'),
        CAND2: page([], 'Somchai Jaidee'), // the real one, found by primary name
        CAND3: page([], 'Third Party'),
        CAND4: page([], 'Should Never Be Fetched'),
      },
    });

    await runScholarFetch(
      { userId: USER_ID, triggeredById: USER_ID, trigger: 'SELF', actorRole: 'ANALYST', fetchPage },
      { now: NOW },
    );

    // Three candidate profiles at 15 credits each, on people we already
    // suspect are not ours. The fourth card is never fetched.
    //
    // The CAP itself lives in `resolveScholarProfile` and is mutation-tested
    // there; what this asserts is that the runner spends one profile fetch
    // per id it was handed and no more — plus one for the winner's own list.
    const candidateFetches = fetchPage.urls.filter((u) => /user=CAND[0-9]/.test(u));
    expect(candidateFetches).toHaveLength(4); // CAND1, CAND2, CAND3, then CAND2's list
    expect(fetchPage.urls.filter((u) => u.includes('user=CAND4'))).toHaveLength(0);
    expect(fetchPage.urls.filter((u) => u.includes('user=CAND1'))).toHaveLength(1);
    expect(mocks.facultyMemberUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ scholarProfileId: 'CAND2' }) }),
    );
    const audit = mocks.auditLogCreate.mock.calls[0]![0] as {
      data: { payloadJson: { resolution: { via: string; candidateIds: string[] } } };
    };
    expect(audit.data.payloadJson.resolution.via).toBe('primary-name');
    expect(audit.data.payloadJson.resolution.candidateIds).toEqual(['CAND1', 'CAND2', 'CAND3']);
  });
});

// ── 3b. A search that resolves nothing ──────────────────────────────────────

describe('runScholarFetch — the search resolved no profile', () => {
  const nothingFetcher = () =>
    routedFetcher({
      search: [searchPage({ rows: [hitRow({ title: 'A namesake paper', authors: 'A Other', year: 2020 })] })],
      profiles: {},
    });

  it('records NO binding, and writes no ResearchOutput', async () => {
    expectBindableMember(unboundMember('Somchai Jaidee'));

    const result = await runScholarFetch(
      {
        userId: USER_ID,
        triggeredById: USER_ID,
        trigger: 'SELF',
        actorRole: 'ANALYST',
        fetchPage: nothingFetcher(),
      },
      { now: NOW },
    );

    expect(result.status).toBe('REFUSED');
    expect(result.reason).toBe(SCHOLAR_NEEDS_BINDING);
    // The two writes that would constitute a binding.
    expect(mocks.facultyMemberUpdate).not.toHaveBeenCalled();
    expect(mocks.auditLogCreate).not.toHaveBeenCalled();
    // And nothing was imported from the article rows — they may be namesakes'
    // and they carry no scholarPaperId to merge on.
    expect(mocks.researchOutputCreateMany).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('keeps the 75 credits and the page they bought', async () => {
    expectBindableMember(unboundMember('Somchai Jaidee'));

    const result = await runScholarFetch(
      {
        userId: USER_ID,
        triggeredById: USER_ID,
        trigger: 'SELF',
        actorRole: 'ANALYST',
        fetchPage: nothingFetcher(),
      },
      { now: NOW },
    );

    expect(result.creditsUsed).toBe(75);
    // The page a 75-credit search bought is the one someone will want to read.
    expect(mocks.archiveCreate).toHaveBeenCalledTimes(1);
    expect(mocks.runUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'REFUSED', creditsUsed: 75 }) }),
    );
  });

  it('says how many article results came back, so "unreachable" reads differently from "unresolvable"', async () => {
    expectBindableMember(unboundMember('Somchai Jaidee'));

    await runScholarFetch(
      {
        userId: USER_ID,
        triggeredById: USER_ID,
        trigger: 'SELF',
        actorRole: 'ANALYST',
        fetchPage: nothingFetcher(),
      },
      { now: NOW },
    );

    const finalise = mocks.runUpdate.mock.calls.at(-1)![0] as { data: { errorText: string } };
    expect(finalise.data.errorText).toContain('Somchai Jaidee');
    expect(finalise.data.errorText).toContain('1 article result');
    expect(finalise.data.errorText).toContain('Paste the profile URL');
  });

  it('meters the spend against the daily BIND cap, not the 30-day fetch allowance', async () => {
    expectBindableMember(unboundMember('Somchai Jaidee'));

    await runScholarFetch(
      {
        userId: USER_ID,
        triggeredById: USER_ID,
        trigger: 'SELF',
        actorRole: 'ANALYST',
        fetchPage: nothingFetcher(),
      },
      { now: NOW },
    );

    // REFUSED is the status `decideScholarQuota` ignores — so the user can
    // paste their URL and sync straight away, rather than being locked out
    // for a month for not being findable on Google.
    expect(mocks.runUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'REFUSED' }) }),
    );
    // The money is metered where it belongs: this WAS a bind attempt.
    expect(mocks.bindAttemptCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ outcome: 'REFUSED', creditsUsed: 75, scholarProfileId: null }),
      }),
    );
  });

  it('refuses before spending anything once the daily bind cap is exhausted', async () => {
    expectBindableMember(unboundMember('Somchai Jaidee'));
    mocks.bindAttemptFindMany.mockResolvedValue(
      Array.from({ length: 5 }, () => ({ createdAt: new Date(NOW.getTime() - 3600_000) })),
    );
    const fetchPage = unreachableFetcher();

    const result = await runScholarFetch(
      { userId: USER_ID, triggeredById: USER_ID, trigger: 'SELF', actorRole: 'ANALYST', fetchPage },
      { now: NOW },
    );

    expect(result.status).toBe('REFUSED');
    expect(result.reason).toBe(SCHOLAR_NEEDS_BINDING);
    expect(result.creditsUsed).toBe(0);
    expect(fetchPage).not.toHaveBeenCalled();
    // No attempt row for an attempt that never happened — writing one would
    // make tomorrow's allowance smaller than the cap says it is.
    expect(mocks.bindAttemptCreate).not.toHaveBeenCalled();
    expect(result.retryAt).toBeInstanceOf(Date);
  });
});

// ── 3c. A search that FAILS ─────────────────────────────────────────────────

describe('runScholarFetch — the search itself failed', () => {
  it('writes no ResearchOutput and records no binding', async () => {
    expectBindableMember(unboundMember('Somchai Jaidee'));
    const fetchPage = vi.fn(async () => {
      throw new Error('ScrapingBee returned HTTP 500 (reason: Server responded with 403)');
    });

    const result = await runScholarFetch(
      { userId: USER_ID, triggeredById: USER_ID, trigger: 'SELF', actorRole: 'ANALYST', fetchPage },
      { now: NOW },
    );

    expect(result.status).toBe('FAILED');
    expect(result.reason).toContain('403');
    expect(mocks.researchOutputCreateMany).not.toHaveBeenCalled();
    expect(mocks.researchOutputUpdateMany).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.facultyMemberUpdate).not.toHaveBeenCalled();
    expect(mocks.auditLogCreate).not.toHaveBeenCalled();
  });

  it('records the spend as a FAILED bind attempt when the profile fetch dies after the search', async () => {
    expectBindableMember(unboundMember('Banchob Sripa'));
    const fetchPage = vi.fn(async (url: string): Promise<ScholarPageResult> => {
      if (url.includes('/scholar?')) {
        return pageResult(searchPage({ cards: [{ id: RESOLVED_ID, name: 'Banchob Sripa' }] }), 75);
      }
      throw new Error('ScrapingBee timed out');
    });

    const result = await runScholarFetch(
      { userId: USER_ID, triggeredById: USER_ID, trigger: 'SELF', actorRole: 'ANALYST', fetchPage },
      { now: NOW },
    );

    expect(result.status).toBe('FAILED');
    // No binding — the profile never came back, so nothing verified it.
    expect(mocks.facultyMemberUpdate).not.toHaveBeenCalled();
    // But the 75 credits are gone, and the cap has to see them or the loop
    // is free to repeat.
    expect(mocks.bindAttemptCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ outcome: 'FAILED', creditsUsed: 75, scholarProfileId: RESOLVED_ID }),
      }),
    );
  });

  it('refuses the import when the resolved profile already belongs to someone else', async () => {
    expectBindableMember(unboundMember('Banchob Sripa'));
    // The conflict check inside `bindScholarProfile`, which is why the bind
    // runs BEFORE the merge: two people sharing one Scholar profile is always
    // a mistake, and importing first would attach the papers to both.
    mocks.facultyMemberFindFirst.mockResolvedValue({ id: 'fm-other', nameEn: 'Someone Else', nameTh: '' });
    const fetchPage = routedFetcher({
      search: [searchPage({ cards: [{ id: RESOLVED_ID, name: 'Banchob Sripa' }] })],
      profiles: {
        [RESOLVED_ID]: page([row({ paperId: 'p1', title: 'A paper', year: 2024, citations: 3 })], 'Banchob Sripa'),
      },
    });

    const result = await runScholarFetch(
      { userId: USER_ID, triggeredById: USER_ID, trigger: 'SELF', actorRole: 'ANALYST', fetchPage },
      { now: NOW },
    );

    expect(result.status).toBe('FAILED');
    expect(result.reason).toContain('Someone Else');
    expect(mocks.researchOutputCreateMany).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});

// ── 3d. The bound path is untouched ─────────────────────────────────────────

describe('runScholarFetch — a bound profile still goes straight to the profile', () => {
  it('never searches, never binds, and spends only profile-page credits', async () => {
    const fetchPage = routedFetcher({
      search: ['<html><body>MUST NOT BE FETCHED</body></html>'],
      profiles: { [PROFILE_ID]: page([row({ paperId: 'p1', title: 'A paper', year: 2024, citations: 2 })]) },
    });
    mocks.researchOutputCreateMany.mockResolvedValue({ count: 1 });

    const result = await runScholarFetch(
      { userId: USER_ID, triggeredById: USER_ID, trigger: 'SELF', actorRole: 'ANALYST', fetchPage },
      { now: NOW },
    );

    expect(result.status).toBe('SUCCEEDED');
    expect(fetchPage.urls.every((u) => u.includes('/citations'))).toBe(true);
    expect(mocks.bindAttemptFindMany).not.toHaveBeenCalled();
    expect(mocks.bindAttemptCreate).not.toHaveBeenCalled();
    expect(mocks.facultyMemberUpdate).not.toHaveBeenCalled();
    expect(mocks.auditLogCreate).not.toHaveBeenCalled();
    expect(result.creditsUsed).toBe(15);
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
          scholarAuthors: {
            names: ['A Author', 'B Author'],
            complete: true,
            fetchedAt: NOW.toISOString(),
          },
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
        data: expect.objectContaining({ fetchRunId: 'run-1', parserVersion: 'scholar-parse.v2' }),
      }),
    );

    // Publications cache expired (aged out, never removed) so the profile page
    // recomputes against the rows just added.
    expect(mocks.cacheUpdateMany).toHaveBeenCalledWith({
      where: { facultyMemberId: MEMBER_ID },
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
      { scholarPaperId: 'a', title: 'Has a year', year: 2021, doi: null, citations: 3, venue: null, type: null, authors: null },
      { scholarPaperId: 'b', title: 'No year', year: 0, doi: null, citations: 1, venue: null, type: null, authors: null },
      {
        scholarPaperId: 'c',
        title: 'Nonsense year',
        year: Number.NaN,
        doi: null,
        citations: 1,
        venue: null,
        type: null,
        authors: null,
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

  it('does not escape when the unresolved-profile refusal cannot be written', async () => {
    expectBindableMember(unboundMember('Somchai Jaidee'));
    mocks.runUpdate.mockRejectedValue(new Error('write failed'));

    const result = await runScholarFetch(
      {
        userId: USER_ID,
        triggeredById: USER_ID,
        trigger: 'SELF',
        actorRole: 'ANALYST',
        fetchPage: routedFetcher({ search: [searchPage({ rows: [] })], profiles: {} }),
      },
      { now: NOW },
    );

    expect(result.status).toBe('REFUSED');
    expect(result.reason).toBe(SCHOLAR_NEEDS_BINDING);
  });

  it('does not escape when the bind-attempt row cannot be written either', async () => {
    // Same posture as `finaliseRun`: bookkeeping about money already spent
    // must not replace the real answer with a database error.
    expectBindableMember(unboundMember('Somchai Jaidee'));
    mocks.bindAttemptCreate.mockRejectedValue(new Error('bind ledger write failed'));

    const result = await runScholarFetch(
      {
        userId: USER_ID,
        triggeredById: USER_ID,
        trigger: 'SELF',
        actorRole: 'ANALYST',
        fetchPage: routedFetcher({ search: [searchPage({ rows: [] })], profiles: {} }),
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

// ── Author lists ────────────────────────────────────────────────────────────
//
// The list page shortens long author lines with "..."; the per-paper detail
// page carries the whole list. Each sync stores the list-page line and then
// spends at most SCHOLAR_AUTHOR_DETAIL_CAP detail pages on rows still marked
// shortened.

describe('author lists', () => {
  const LONG_ID = `${PROFILE_ID}:long`;

  function detailHtml(names: string): string {
    return (
      '<html><body><div id="gsc_oci_table">' +
      '<div class="gs_scl"><div class="gsc_oci_field">Authors</div>' +
      `<div class="gsc_oci_value">${names}</div></div>` +
      '</div></body></html>'
    );
  }

  /** Profile pages from `profileHtml`; any view_citation URL from `detail`. */
  function detailFetcher(opts: {
    profileHtml: string;
    detail: (url: string) => Promise<ScholarPageResult>;
  }): ReturnType<typeof vi.fn> & { urls: string[] } {
    const urls: string[] = [];
    const fn = vi.fn(async (url: string): Promise<ScholarPageResult> => {
      urls.push(url);
      if (url.includes('view_op=view_citation')) return opts.detail(url);
      return pageResult(opts.profileHtml, 15);
    });
    return Object.assign(fn, { urls });
  }

  const detailCalls = (urls: string[]): string[] =>
    urls.filter((u) => u.includes('view_op=view_citation'));

  /** A shortened row as the candidate read selects it. */
  function shortRow(
    i: number | string,
    opts: { year?: number; detailAttempts?: number } = {},
  ): { id: string; scholarPaperId: string; year: number; scholarAuthors: Record<string, unknown> } {
    return {
      id: `ro-${i}`,
      scholarPaperId: `${PROFILE_ID}:s${i}`,
      year: opts.year ?? 2020,
      scholarAuthors: {
        names: ['A Author'],
        complete: false,
        fetchedAt: '2026-01-01T00:00:00.000Z',
        ...(opts.detailAttempts !== undefined ? { detailAttempts: opts.detailAttempts } : {}),
      },
    };
  }

  const WALL = '<html><body>Before you continue to Google</body></html>';
  const profileOnly = () =>
    page([row({ paperId: `${PROFILE_ID}:c`, title: 'Complete', year: 2022, citations: 2 })]);

  async function run(fetchPage: (url: string) => Promise<ScholarPageResult>) {
    return runScholarFetch(
      { userId: USER_ID, triggeredById: USER_ID, trigger: 'SELF', actorRole: 'ANALYST', fetchPage },
      { now: NOW },
    );
  }

  it('writes the list-page author line on new rows', async () => {
    const fetchPage = detailFetcher({
      profileHtml: page([row({ paperId: `${PROFILE_ID}:n`, title: 'New paper', year: 2024, citations: 1 })]),
      detail: async () => {
        throw new Error('no detail page expected');
      },
    });
    mocks.researchOutputCreateMany.mockResolvedValue({ count: 1 });

    const result = await run(fetchPage);

    expect(result.status).toBe('SUCCEEDED');
    const createArg = mocks.researchOutputCreateMany.mock.calls[0]![0] as {
      data: { scholarAuthors?: unknown }[];
    };
    expect(createArg.data[0]!.scholarAuthors).toEqual({
      names: ['A Author', 'B Author'],
      complete: true,
      fetchedAt: NOW.toISOString(),
    });
  });

  it('fetches the detail page only for shortened rows, once, and stores the full list', async () => {
    const fetchPage = detailFetcher({
      profileHtml: page([
        row({ paperId: LONG_ID, title: 'Long paper', year: 2021, citations: 3, authors: 'A Author, B Author, ...' }),
      ]),
      detail: async () => pageResult(detailHtml('A Author, B Author, C Author'), 15),
    });
    mocks.researchOutputFindMany.mockResolvedValue([
      {
        id: 'ro-long',
        title: 'Long paper',
        year: 2021,
        doi: null,
        citations: 3,
        source: 'google-scholar',
        scholarPaperId: LONG_ID,
        scholarAuthors: { names: ['A Author'], complete: false, fetchedAt: '2026-01-01T00:00:00.000Z' },
      },
    ]);
    mocks.researchOutputCreateMany.mockResolvedValue({ count: 0 });
    mocks.researchOutputUpdateMany.mockResolvedValue({ count: 1 });
    mocks.researchOutputFindShortened.mockResolvedValue([
      { id: 'ro-long', scholarPaperId: LONG_ID, year: 2021, scholarAuthors: { names: ['A Author'], complete: false } },
    ]);

    const result = await run(fetchPage);

    // The shortened-rows read asks only for this member's shortened Scholar rows.
    expect(mocks.researchOutputFindShortened).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          facultyMemberId: MEMBER_ID,
          source: 'google-scholar',
          scholarAuthors: { path: ['complete'], equals: false },
        }),
      }),
    );
    expect(detailCalls(fetchPage.urls)).toEqual([buildScholarCitationUrl(PROFILE_ID, LONG_ID)]);
    expect(mocks.researchOutputUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.researchOutputUpdate).toHaveBeenCalledWith({
      where: { id: 'ro-long' },
      data: {
        scholarAuthors: {
          names: ['A Author', 'B Author', 'C Author'],
          complete: true,
          fetchedAt: NOW.toISOString(),
        },
      },
    });
    expect(result.status).toBe('SUCCEEDED');
    expect(result.creditsUsed).toBe(30); // 15 profile page + 15 detail page
    expect(result.authorListsCompleted).toBe(1);
    expect(result.authorListsPending).toBe(0);
    expect(mocks.runUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ creditsUsed: 30, errorText: null }) }),
    );
  });

  it('never fetches a row whose list is already complete', async () => {
    const fetchPage = detailFetcher({
      profileHtml: page([row({ paperId: `${PROFILE_ID}:c`, title: 'Complete', year: 2022, citations: 2 })]),
      detail: async () => pageResult(detailHtml('X'), 15),
    });
    mocks.researchOutputCreateMany.mockResolvedValue({ count: 1 });
    mocks.researchOutputFindShortened.mockResolvedValue([]);

    const result = await run(fetchPage);

    expect(detailCalls(fetchPage.urls)).toEqual([]);
    expect(mocks.researchOutputUpdate).not.toHaveBeenCalled();
    expect(result.authorListsCompleted).toBe(0);
    expect(result.authorListsPending).toBe(0);
    expect(result.creditsUsed).toBe(15);
  });

  it('caps detail fetches at 20 per sync and reports the rest as pending', async () => {
    expect(SCHOLAR_AUTHOR_DETAIL_CAP).toBe(20);
    const fetchPage = detailFetcher({
      profileHtml: page([row({ paperId: `${PROFILE_ID}:c`, title: 'Complete', year: 2022, citations: 2 })]),
      detail: async () => pageResult(detailHtml('A Author, B Author, C Author'), 15),
    });
    mocks.researchOutputCreateMany.mockResolvedValue({ count: 1 });
    mocks.researchOutputFindShortened.mockResolvedValue(
      Array.from({ length: SCHOLAR_AUTHOR_DETAIL_CAP + 1 }, (_, i) => shortRow(i)),
    );
    // After the loop one shortened row remains.
    mocks.researchOutputCountShortened.mockResolvedValue(1);

    const result = await run(fetchPage);

    expect(mocks.researchOutputFindShortened).toHaveBeenCalledWith(
      expect.objectContaining({
        take: SCHOLAR_AUTHOR_DETAIL_CANDIDATES,
        orderBy: [{ year: 'desc' }, { id: 'asc' }],
      }),
    );
    // Abandoned rows are excluded in the query itself, so they cannot fill the
    // candidate window. An OR, not a NOT: on Postgres a NOT over a missing JSON
    // path is NULL and would also drop every never-attempted row.
    expect(mocks.researchOutputFindShortened).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { scholarAuthors: { path: ['detailAttempts'], equals: Prisma.AnyNull } },
            { scholarAuthors: { path: ['detailAttempts'], lt: SCHOLAR_AUTHOR_DETAIL_MAX_ATTEMPTS } },
          ],
        }),
      }),
    );
    expect(detailCalls(fetchPage.urls)).toHaveLength(20);
    expect(mocks.researchOutputUpdate).toHaveBeenCalledTimes(20);
    expect(result.authorListsCompleted).toBe(20);
    expect(result.authorListsPending).toBe(1);
    expect(result.creditsUsed).toBe(15 + 20 * 15);
    expect(result.status).toBe('SUCCEEDED');
  });

  it('a failed or unreadable detail page leaves the row shortened and the run successful', async () => {
    const fetchPage = detailFetcher({
      profileHtml: page([row({ paperId: `${PROFILE_ID}:c`, title: 'Complete', year: 2022, citations: 2 })]),
      detail: async (url) => {
        if (url.includes('s0')) throw new Error('ScrapingBee timed out');
        // A consent wall: HTTP 200, no Authors field.
        return pageResult('<html><body>Before you continue to Google</body></html>', 15);
      },
    });
    mocks.researchOutputCreateMany.mockResolvedValue({ count: 1 });
    mocks.researchOutputFindShortened.mockResolvedValue([shortRow(0), shortRow(1)]);
    mocks.researchOutputCountShortened.mockResolvedValue(2);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await run(fetchPage);
    warn.mockRestore();

    expect(detailCalls(fetchPage.urls)).toHaveLength(2);
    // Each failure is recorded as an attempt; the list itself is kept.
    expect(mocks.researchOutputUpdate).toHaveBeenCalledTimes(2);
    for (const [arg] of mocks.researchOutputUpdate.mock.calls) {
      expect((arg as { data: { scholarAuthors: unknown } }).data.scholarAuthors).toMatchObject({
        complete: false,
        detailAttempts: 1,
      });
    }
    expect(result.status).toBe('SUCCEEDED');
    expect(result.reason).toBeNull();
    expect(result.authorListsCompleted).toBe(0);
    expect(result.authorListsPending).toBe(2);
    // The wall page was still billed; the thrown one reported nothing.
    expect(result.creditsUsed).toBe(30);
  });

  it('never replaces a complete stored list with a shortened list-page line', async () => {
    const fetchPage = detailFetcher({
      profileHtml: page([
        row({ paperId: LONG_ID, title: 'Long paper', year: 2021, citations: 3, authors: 'A Author, B Author, ...' }),
      ]),
      detail: async () => pageResult(detailHtml('A Author, B Author, C Author'), 15),
    });
    mocks.researchOutputFindMany.mockResolvedValue([
      {
        id: 'ro-long',
        title: 'Long paper',
        year: 2021,
        doi: null,
        citations: 3,
        source: 'google-scholar',
        scholarPaperId: LONG_ID,
        scholarAuthors: {
          names: ['A Author', 'B Author', 'C Author'],
          complete: true,
          fetchedAt: '2026-01-01T00:00:00.000Z',
        },
      },
    ]);
    mocks.researchOutputCreateMany.mockResolvedValue({ count: 0 });
    mocks.researchOutputUpdateMany.mockResolvedValue({ count: 1 });

    const result = await run(fetchPage);

    expect(result.status).toBe('SUCCEEDED');
    const authorWrites = mocks.researchOutputUpdateMany.mock.calls.filter(
      ([arg]) => (arg as { data: Record<string, unknown> }).data.scholarAuthors !== undefined,
    );
    expect(authorWrites).toEqual([]);
    expect(mocks.researchOutputUpdate).not.toHaveBeenCalled();
  });

  it('refreshes a shortened stored list from the list page inside the merge transaction', async () => {
    const fetchPage = detailFetcher({
      profileHtml: page([
        row({ paperId: LONG_ID, title: 'Long paper', year: 2021, citations: 3, authors: 'A Author, B Author, ...' }),
      ]),
      detail: async () => pageResult(detailHtml('A Author, B Author, C Author'), 15),
    });
    mocks.researchOutputFindMany.mockResolvedValue([
      {
        id: 'ro-long',
        title: 'Long paper',
        year: 2021,
        doi: null,
        citations: 3,
        source: 'google-scholar',
        scholarPaperId: LONG_ID,
        scholarAuthors: null,
      },
    ]);
    mocks.researchOutputCreateMany.mockResolvedValue({ count: 0 });
    mocks.researchOutputUpdateMany.mockResolvedValue({ count: 1 });

    const result = await run(fetchPage);

    expect(mocks.researchOutputUpdateMany).toHaveBeenCalledWith({
      where: { facultyMemberId: MEMBER_ID, scholarPaperId: LONG_ID, source: 'google-scholar' },
      data: {
        scholarAuthors: { names: ['A Author', 'B Author'], complete: false, fetchedAt: NOW.toISOString() },
      },
    });
    // An author-line write is not a citation update.
    expect(result.citationsUpdated).toBe(0);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });

  it('reports pending from a count of the shortened rows left, not from the batch size', async () => {
    const fetchPage = detailFetcher({
      profileHtml: profileOnly(),
      detail: async () => pageResult(detailHtml('A Author, B Author, C Author'), 15),
    });
    mocks.researchOutputCreateMany.mockResolvedValue({ count: 1 });
    mocks.researchOutputFindShortened.mockResolvedValue(Array.from({ length: 50 }, (_, i) => shortRow(i)));
    mocks.researchOutputCountShortened.mockResolvedValue(30);

    const result = await run(fetchPage);

    expect(result.authorListsCompleted).toBe(20);
    expect(result.authorListsPending).toBe(30);
    expect(result.authorListsAbandoned).toBe(0);
    // The count asks the same question as the candidate read.
    expect(mocks.researchOutputCountShortened).toHaveBeenCalledWith({
      where: {
        facultyMemberId: MEMBER_ID,
        source: 'google-scholar',
        scholarPaperId: { not: null },
        scholarAuthors: { path: ['complete'], equals: false },
      },
    });
  });

  it('excludes abandoned rows from pending and reports them separately', async () => {
    const fetchPage = detailFetcher({
      profileHtml: profileOnly(),
      detail: async () => pageResult(detailHtml('A Author, B Author'), 15),
    });
    mocks.researchOutputCreateMany.mockResolvedValue({ count: 1 });
    mocks.researchOutputFindShortened.mockResolvedValue([]);
    mocks.researchOutputCountShortened.mockResolvedValue(7);
    mocks.researchOutputCountAbandoned.mockResolvedValue(3);

    const result = await run(fetchPage);

    expect(result.authorListsPending).toBe(4);
    expect(result.authorListsAbandoned).toBe(3);
    expect(mocks.researchOutputCountAbandoned).toHaveBeenCalledWith({
      where: {
        facultyMemberId: MEMBER_ID,
        source: 'google-scholar',
        scholarPaperId: { not: null },
        AND: [
          { scholarAuthors: { path: ['complete'], equals: false } },
          { scholarAuthors: { path: ['detailAttempts'], gte: SCHOLAR_AUTHOR_DETAIL_MAX_ATTEMPTS } },
        ],
      },
    });
  });

  it('stops the phase after two consecutive walls, without failing the run', async () => {
    const fetchPage = detailFetcher({
      profileHtml: profileOnly(),
      detail: async () => pageResult(WALL, 15),
    });
    mocks.researchOutputCreateMany.mockResolvedValue({ count: 1 });
    mocks.researchOutputFindShortened.mockResolvedValue(Array.from({ length: 20 }, (_, i) => shortRow(i)));
    mocks.researchOutputCountShortened.mockResolvedValue(20);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await run(fetchPage);
    warn.mockRestore();

    expect(detailCalls(fetchPage.urls)).toHaveLength(2);
    expect(result.status).toBe('SUCCEEDED');
    expect(result.authorListsCompleted).toBe(0);
    expect(result.authorListsPending).toBe(20);
    expect(result.creditsUsed).toBe(15 + 2 * 15);
  });

  it('a success between failures resets the consecutive-failure count', async () => {
    let n = 0;
    const fetchPage = detailFetcher({
      profileHtml: profileOnly(),
      // fail, succeed, fail, fail -> stop
      detail: async () => {
        n += 1;
        return n === 2 ? pageResult(detailHtml('A Author, B Author'), 15) : pageResult(WALL, 15);
      },
    });
    mocks.researchOutputCreateMany.mockResolvedValue({ count: 1 });
    mocks.researchOutputFindShortened.mockResolvedValue(Array.from({ length: 20 }, (_, i) => shortRow(i)));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await run(fetchPage);
    warn.mockRestore();

    expect(detailCalls(fetchPage.urls)).toHaveLength(4);
    expect(result.authorListsCompleted).toBe(1);
  });

  it('counts a thrown fetch error toward the breaker', async () => {
    const fetchPage = detailFetcher({
      profileHtml: profileOnly(),
      detail: async () => {
        throw new Error('ScrapingBee timed out');
      },
    });
    mocks.researchOutputCreateMany.mockResolvedValue({ count: 1 });
    mocks.researchOutputFindShortened.mockResolvedValue(Array.from({ length: 20 }, (_, i) => shortRow(i)));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await run(fetchPage);
    warn.mockRestore();

    expect(detailCalls(fetchPage.urls)).toHaveLength(2);
    expect(result.status).toBe('SUCCEEDED');
  });

  for (const [label, make] of [
    ['quota', () => new ScrapingBeeQuotaError()],
    ['auth', () => new ScrapingBeeAuthError(401)],
    ['config', () => new ScrapingBeeConfigError('SCRAPINGBEE_API_KEY is not set')],
    ['transient (outage)', () => new ScrapingBeeTransientError(503, 'HTTP 503')],
  ] as const) {
    it(`stops after one fetch on a ScrapingBee ${label} error, records no attempt, and keeps the run`, async () => {
      const fetchPage = detailFetcher({
        profileHtml: profileOnly(),
        detail: async () => {
          throw make();
        },
      });
      mocks.researchOutputCreateMany.mockResolvedValue({ count: 1 });
      mocks.researchOutputFindShortened.mockResolvedValue(Array.from({ length: 20 }, (_, i) => shortRow(i)));
      mocks.researchOutputCountShortened.mockResolvedValue(20);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await run(fetchPage);
      warn.mockRestore();

      expect(detailCalls(fetchPage.urls)).toHaveLength(1);
      // Not the row's fault: no attempt is charged against it.
      expect(mocks.researchOutputUpdate).not.toHaveBeenCalled();
      expect(result.status).toBe('SUCCEEDED');
      expect(result.authorListsPending).toBe(20);
    });
  }

  it('records an attempt on failure, keeping the stored names and flag', async () => {
    const fetchPage = detailFetcher({
      profileHtml: profileOnly(),
      detail: async () => pageResult(WALL, 15),
    });
    mocks.researchOutputCreateMany.mockResolvedValue({ count: 1 });
    mocks.researchOutputFindShortened.mockResolvedValue([shortRow(0, { detailAttempts: 1 })]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await run(fetchPage);
    warn.mockRestore();

    expect(mocks.researchOutputUpdate).toHaveBeenCalledWith({
      where: { id: 'ro-0' },
      data: {
        scholarAuthors: {
          names: ['A Author'],
          complete: false,
          fetchedAt: '2026-01-01T00:00:00.000Z',
          detailAttempts: 2,
          detailAttemptedAt: NOW.toISOString(),
        },
      },
    });
  });

  it('never fetches a row that has used up its attempts', async () => {
    const fetchPage = detailFetcher({
      profileHtml: profileOnly(),
      detail: async () => pageResult(detailHtml('A Author, B Author'), 15),
    });
    mocks.researchOutputCreateMany.mockResolvedValue({ count: 1 });
    mocks.researchOutputFindShortened.mockResolvedValue([
      shortRow('dead', { year: 2025, detailAttempts: SCHOLAR_AUTHOR_DETAIL_MAX_ATTEMPTS }),
      shortRow('live', { year: 2019 }),
    ]);

    await run(fetchPage);

    expect(detailCalls(fetchPage.urls)).toEqual([buildScholarCitationUrl(PROFILE_ID, `${PROFILE_ID}:slive`)]);
  });

  it('fetches never-attempted rows first, then by year desc, then id asc', async () => {
    const fetchPage = detailFetcher({
      profileHtml: profileOnly(),
      detail: async () => pageResult(detailHtml('A Author, B Author'), 15),
    });
    mocks.researchOutputCreateMany.mockResolvedValue({ count: 1 });
    // Returned in the database's order (year desc, id asc).
    mocks.researchOutputFindShortened.mockResolvedValue([
      shortRow('t2', { year: 2024, detailAttempts: 2 }),
      shortRow('t1', { year: 2023, detailAttempts: 1 }),
      shortRow('a', { year: 2022 }),
      shortRow('b', { year: 2022 }),
      shortRow('z', { year: 2020 }),
    ]);

    await run(fetchPage);

    expect(detailCalls(fetchPage.urls)).toEqual(
      ['a', 'b', 'z', 't1', 't2'].map((k) => buildScholarCitationUrl(PROFILE_ID, `${PROFILE_ID}:s${k}`)),
    );
  });

  it('the cap is spent on never-attempted rows before attempted ones', async () => {
    const fetchPage = detailFetcher({
      profileHtml: profileOnly(),
      detail: async () => pageResult(detailHtml('A Author, B Author'), 15),
    });
    mocks.researchOutputCreateMany.mockResolvedValue({ count: 1 });
    mocks.researchOutputFindShortened.mockResolvedValue([
      ...Array.from({ length: 5 }, (_, i) => shortRow(`old${i}`, { year: 2025, detailAttempts: 1 })),
      ...Array.from({ length: SCHOLAR_AUTHOR_DETAIL_CAP }, (_, i) => shortRow(`new${i}`, { year: 2010 })),
    ]);

    await run(fetchPage);

    const fetched = detailCalls(fetchPage.urls);
    expect(fetched).toHaveLength(SCHOLAR_AUTHOR_DETAIL_CAP);
    expect(fetched.some((u) => u.includes('old'))).toBe(false);
  });

  it('a detail page that is itself shortened is stored incomplete and counted as an attempt', async () => {
    const fetchPage = detailFetcher({
      profileHtml: profileOnly(),
      detail: async () => pageResult(detailHtml('A Author, B Author, C Author, ...'), 15),
    });
    mocks.researchOutputCreateMany.mockResolvedValue({ count: 1 });
    mocks.researchOutputFindShortened.mockResolvedValue([shortRow(0)]);
    mocks.researchOutputCountShortened.mockResolvedValue(1);

    const result = await run(fetchPage);

    expect(mocks.researchOutputUpdate).toHaveBeenCalledWith({
      where: { id: 'ro-0' },
      data: {
        scholarAuthors: {
          names: ['A Author', 'B Author', 'C Author'],
          complete: false,
          fetchedAt: NOW.toISOString(),
          detailAttempts: 1,
          detailAttemptedAt: NOW.toISOString(),
        },
      },
    });
    expect(result.authorListsCompleted).toBe(0);
    expect(result.authorListsPending).toBe(1);
  });

  it('a list-page refresh of a shortened row keeps its detail-attempt count', async () => {
    const fetchPage = detailFetcher({
      profileHtml: page([
        row({ paperId: LONG_ID, title: 'Long paper', year: 2021, citations: 3, authors: 'A Author, B Author, ...' }),
      ]),
      detail: async () => pageResult(WALL, 15),
    });
    mocks.researchOutputFindMany.mockResolvedValue([
      {
        id: 'ro-long',
        title: 'Long paper',
        year: 2021,
        doi: null,
        citations: 3,
        source: 'google-scholar',
        scholarPaperId: LONG_ID,
        scholarAuthors: {
          names: ['A Author'],
          complete: false,
          fetchedAt: '2026-01-01T00:00:00.000Z',
          detailAttempts: 2,
          detailAttemptedAt: '2026-08-01T00:00:00.000Z',
        },
      },
    ]);
    mocks.researchOutputCreateMany.mockResolvedValue({ count: 0 });
    mocks.researchOutputUpdateMany.mockResolvedValue({ count: 1 });

    await run(fetchPage);

    expect(mocks.researchOutputUpdateMany).toHaveBeenCalledWith({
      where: { facultyMemberId: MEMBER_ID, scholarPaperId: LONG_ID, source: 'google-scholar' },
      data: {
        scholarAuthors: {
          names: ['A Author', 'B Author'],
          complete: false,
          fetchedAt: NOW.toISOString(),
          detailAttempts: 2,
          detailAttemptedAt: '2026-08-01T00:00:00.000Z',
        },
      },
    });
  });
});
