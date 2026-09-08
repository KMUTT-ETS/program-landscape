// ────────────────────────────────────────────────────────────────────────────
// Google Scholar on-demand fetch — THE ONLY WRITER.
//
// Every ResearchOutput row that carries `source = 'google-scholar'` is written
// here, by `runScholarFetch`, and nowhere else. Nothing in this module removes
// a row: the merge is additive-only by construction (`planScholarMerge` has no
// removal field, and this file has no removal call). That is not stylistic —
// on 2026-09-07 an unconditional replace-in-place in the program-courses
// materialiser destroyed 56 curated course rows on a failed upstream call
// while reporting success. A user's publication library is the same shape of
// asset: irreplaceable, and the scraped source is the untrustworthy side of
// the pair. If a fetch is empty, partial, walled or misparsed, everything the
// user already had must still be there afterwards.
//
// Dependency injection, and why:
//   - `fetchPage` — the ScrapingBee wrapper lives in `apps/ingestion`
//     (src/lib/scrapingbee-client.ts) and this runner lives in `packages/db`.
//     An app cannot be a dependency of a package, so the fetcher is passed in
//     as a function. This follows the existing DI shape in this package —
//     `generateProgramResearchExpertise({ ai: AiService, … })` in
//     program-research-expertise-run.ts takes its outbound service the same
//     way — and it is what makes the runner testable with no network.
//   - `parsePage` — same reason at one remove. The shipped parser drops rows
//     with no usable year before the runner ever sees them, so the runner's
//     own year guard (below) would be untestable through the HTML seam. It is
//     kept as a real guard, not decoration, and injecting the parser is what
//     lets a test prove it fires. It also matches the archive's stated
//     purpose: reprocess an archived payload under a later parser rather than
//     re-scrape.
//
// See docs/superpowers/specs/2026-09-08-google-scholar-on-demand-design.md.
// ────────────────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ResearchOutputType } from '@prisma/client';
import {
  SCHOLAR_PARSER_VERSION,
  decideScholarQuota,
  parseScholarProfileIdentity,
  parseScholarProfileUrl,
  parseScholarPublications,
  personNameMatchesAny,
  personNamesMatch,
  planScholarMerge,
  type ScholarPaper,
  type ScholarStatus,
  type ScholarTrigger,
} from '@kku/shared';
import { prisma } from './index';

// ── Injected collaborators ────────────────────────────────────────────────

/** One page of raw Scholar HTML, plus what ScrapingBee billed for it. */
export interface ScholarPageResult {
  html: string;
  /**
   * Credits ScrapingBee actually billed for this page, read off the
   * `Spb-Cost` response header.
   *
   * The run's `creditsUsed` is the SUM of these, never pages × a constant:
   * a Google page is billed at roughly 15 credits, not 1, and the live
   * figure has already disagreed with ScrapingBee's published number (docs
   * say 20, measured 15). `GOOGLE_PAGE_CREDIT_COST` in the ScrapingBee
   * client is for pre-flight estimates in the admin console, not for
   * recording what a run actually spent.
   *
   * Null means "we don't know" — the header was absent — and contributes 0.
   * If every page comes back null the run records 0 credits, which reads as
   * obviously missing rather than plausibly cheap; that is the intended
   * failure mode, since a guessed number in a spend ledger is worse than a
   * visible hole.
   */
  creditsUsed: number | null;
}

export type ScholarPageFetcher = (targetUrl: string) => Promise<ScholarPageResult>;
export type ScholarPageParser = (html: string) => ScholarPaper[];

// ── Constants ─────────────────────────────────────────────────────────────

/** Scholar's own maximum for `pagesize` on the citations list view. */
export const SCHOLAR_PAGE_SIZE = 100;

/**
 * Hard ceiling on pages per run: 10 × 100 = 1,000 papers. Above KKU's most
 * prolific researcher by a wide margin, and a belt against a pagination bug
 * spending credits in a loop. Hitting it is reported as PARTIAL, never as a
 * clean success.
 */
export const SCHOLAR_MAX_PAGES = 10;

/**
 * Counts publication rows in a raw page to decide whether another page
 * exists. Deliberately NOT `parsePage(html).length`: the parser drops rows
 * with no usable year, so a full page containing one such row would look
 * short and pagination would stop early, silently truncating the library.
 * The marker is the same class the parser keys off — if Scholar renames it
 * the parser fails loudly (zero papers) rather than this drifting alone.
 */
const ROW_MARKER = /class="gsc_a_tr"/g;

const SOURCE = 'google-scholar';

// ── Public types ──────────────────────────────────────────────────────────

export interface RunScholarFetchInput {
  /** Whose record is being fetched. */
  userId: string;
  /** Who asked for it — equals `userId` for a SELF fetch. */
  triggeredById: string;
  trigger: ScholarTrigger;
  /** The triggering actor's role, for the SUPER_ADMIN quota exemption. */
  actorRole: string;
  fetchPage: ScholarPageFetcher;
  /** Overridable for tests; defaults to the shipped parser. */
  parsePage?: ScholarPageParser;
  /** Overridable for tests; defaults to the wall clock. */
  now?: Date;
}

export interface ScholarFetchResult {
  status: ScholarStatus;
  /** Null only when nothing was recorded — the no-FacultyMember refusals. */
  runId: string | null;
  /**
   * Why, in words a person can act on. Always set for REFUSED and FAILED.
   *
   * The one exception is the unbound-profile refusal, where this is the
   * machine-readable `SCHOLAR_NEEDS_BINDING` code — the UI branches on it to
   * open the "paste your profile URL" flow rather than showing prose. The
   * prose version is on the run row's `errorText`.
   */
  reason: string | null;
  /** When a quota refusal may be retried. */
  retryAt: Date | null;
  papersFound: number;
  papersInserted: number;
  citationsUpdated: number;
  /** Parsed papers dropped for lacking a usable year. Never inserted. */
  papersSkippedNoYear: number;
  creditsUsed: number;
  searchQuery: string | null;
}

/** Reason code the UI keys off to prompt for a Scholar profile URL. */
export const SCHOLAR_NEEDS_BINDING = 'needs-binding';

// ── Type mapping ──────────────────────────────────────────────────────────

export function toResearchOutputType(scholarType: string | null): ResearchOutputType {
  const t = (scholarType ?? '').toLowerCase();
  if (t.includes('patent')) return 'PATENT';
  if (t.includes('book') || t.includes('chapter')) return 'BOOK';
  if (t.includes('conference') || t.includes('proceeding')) return 'CONFERENCE';
  // Everything else, including absent: JOURNAL is the dominant case. The raw
  // Scholar string survives in ScholarFetchArchive, so a better mapping can be
  // applied later by reprocessing rather than re-scraping.
  return 'JOURNAL';
}

// ── FacultyMember resolution ─────────────────────────────────────────────

export interface ScholarFacultyMember {
  id: string;
  nameEn: string;
  nameTh: string;
  employeeId: string | null;
  isActive: boolean;
  scholarProfileId: string | null;
}

export interface ScholarMemberResolution {
  user: { id: string; name: string | null } | null;
  member: ScholarFacultyMember | null;
  /** Set when `member` is null and the caller should refuse. */
  refusal: string | null;
}

/**
 * Pick exactly one staff record out of a candidate set, or refuse.
 *
 * NEVER picks arbitrarily. `ResearchOutput.facultyMemberId` feeds
 * Council-facing per-faculty research roll-ups, so attaching one person's
 * papers to another's record is the expensive, hard-to-detect error — a
 * refusal a human resolves in a minute is strictly cheaper. `isActive` is
 * used only to break a tie, never as a filter: a retired researcher's
 * publication history is still legitimate data.
 */
function pickSingleMember(
  candidates: ScholarFacultyMember[],
  describeSearch: string,
): { member: ScholarFacultyMember | null; refusal: string | null } {
  if (candidates.length === 1) return { member: candidates[0]!, refusal: null };
  if (candidates.length === 0) {
    return { member: null, refusal: null }; // caller decides whether to fall through
  }
  const active = candidates.filter((c) => c.isActive);
  if (active.length === 1) return { member: active[0]!, refusal: null };
  return {
    member: null,
    refusal:
      `${describeSearch} matches ${candidates.length} staff records` +
      (active.length > 1 ? ` (${active.length} of them active)` : '') +
      '. Refusing rather than guessing which one — link the Scholar profile from the staff record directly.',
  };
}

/**
 * Resolve the FacultyMember row behind a User.
 *
 * Deliberately NOT gated on HR linkage. `employeeCode` marks a current
 * employee and Scholar has no need of it; `employeeId` is the identity
 * bridge (the HR id `User.employeeId` also carries, captured from the SSO
 * token) and is tried first because an id match is an identity match. When
 * it yields nothing, an exact normalised name match against
 * `FacultyMember.nameEn` is the fallback.
 *
 * Diverges from `apps/web/src/lib/profile-data.ts` in two deliberate ways,
 * both approved for this feature: no `isActive: true` filter (see
 * `pickSingleMember`), and the fallback matches the English name rather than
 * the Thai one. The two surfaces can therefore resolve differently for a
 * user whose Thai name matches a record but whose English name does not.
 */
export async function resolveScholarFacultyMember(userId: string): Promise<ScholarMemberResolution> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, employeeId: true },
  });
  if (!user) {
    return { user: null, member: null, refusal: 'No user record for this account.' };
  }
  const publicUser = { id: user.id, name: user.name };

  const select = {
    id: true,
    nameEn: true,
    nameTh: true,
    employeeId: true,
    isActive: true,
    scholarProfileId: true,
  } as const;

  // (a) Identity: HR employee id. Not unique in the schema, so the same
  // one-or-refuse rule applies here as to the name path.
  if (user.employeeId) {
    const byEmployeeId = await prisma.facultyMember.findMany({
      where: { employeeId: user.employeeId },
      select,
    });
    const picked = pickSingleMember(byEmployeeId, `HR employee id "${user.employeeId}"`);
    if (picked.member) return { user: publicUser, member: picked.member, refusal: null };
    if (picked.refusal) return { user: publicUser, member: null, refusal: picked.refusal };
    // Zero matches — fall through to the name path.
  }

  // (b) Name: exact match on the normalised English name.
  const accountName = user.name?.trim();
  if (!accountName) {
    return {
      user: publicUser,
      member: null,
      refusal:
        'This account is not linked to a staff record by HR employee id, and has no name to match one by.',
    };
  }

  // The comparison is normalised (case, diacritics, punctuation, token
  // order) and so cannot be expressed in SQL against `name_en`. The table is
  // a few thousand rows of short strings and this runs once per human-
  // initiated fetch, not on a hot path — scanning it is cheaper than a
  // `contains` pre-filter that would miss exactly the diacritic and
  // punctuation cases the normaliser exists to handle.
  const everyone = await prisma.facultyMember.findMany({ select });
  const byName = everyone.filter((m) => personNamesMatch(m.nameEn, accountName));
  const picked = pickSingleMember(byName, `The name "${accountName}"`);
  if (picked.member) return { user: publicUser, member: picked.member, refusal: null };
  if (picked.refusal) return { user: publicUser, member: null, refusal: picked.refusal };

  return {
    user: publicUser,
    member: null,
    refusal:
      `No staff record matches the name "${accountName}" (searched English names), ` +
      'and no HR employee id links this account to one.',
  };
}

// ── URL construction ──────────────────────────────────────────────────────

/**
 * One page of a Scholar profile's publication list. `hl=en` pins the UI
 * language so the parser sees the markup it was verified against regardless
 * of what locale the exit IP lands in.
 */
export function buildScholarProfilePageUrl(profileId: string, cstart: number): string {
  const url = new URL('https://scholar.google.com/citations');
  url.searchParams.set('user', profileId);
  url.searchParams.set('hl', 'en');
  url.searchParams.set('cstart', String(cstart));
  url.searchParams.set('pagesize', String(SCHOLAR_PAGE_SIZE));
  return url.toString();
}

// ── Input validation ──────────────────────────────────────────────────────

const runInputSchema = z.object({
  userId: z.string().min(1),
  triggeredById: z.string().min(1),
  trigger: z.enum(['SELF', 'ADMIN', 'ADMIN_BULK']),
  actorRole: z.string().min(1),
});

// ── Runner ────────────────────────────────────────────────────────────────

/** How far back the quota ledger is read. The window itself is 30 days; 90
 *  gives `decideScholarQuota` headroom and keeps the query bounded. */
const LEDGER_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;

export async function runScholarFetch(input: RunScholarFetchInput): Promise<ScholarFetchResult> {
  const { userId, triggeredById, trigger, actorRole } = runInputSchema.parse(input);
  const fetchPage = input.fetchPage;
  const parsePage = input.parsePage ?? parseScholarPublications;
  const now = input.now ?? new Date();

  // ── 1. Resolve the person ───────────────────────────────────────────────
  // No run row and no quota consumed on any refusal here: nothing was
  // attempted, and a ledger entry for a person we could not identify (or
  // could not identify UNIQUELY) makes the "why can't this person fetch"
  // answer worse, not better — the refusal reason is returned to the caller
  // instead, naming exactly what was searched for.
  const { user, member, refusal } = await resolveScholarFacultyMember(userId);
  if (!member) {
    return refusedWithoutRun(
      refusal ?? 'This account could not be matched to a single staff record.',
    );
  }

  // ── 1a. The name we would search under, recorded for diagnosis ──────────
  // English, never Thai: Scholar profiles are indexed under the Latin name.
  // Binding is by URL today, so this is diagnostic rather than load-bearing —
  // which is exactly why it must be stored: a fetch that comes back empty is
  // otherwise undiagnosable without spending another credit.
  const searchQuery = (member.nameEn.trim() || user?.name?.trim() || '') || null;
  if (!searchQuery) {
    return refusedWithoutRun(
      'This staff record has no English name and the account has no name either, so the fetch cannot be attributed to anyone.',
    );
  }

  // ── 2. Quota ────────────────────────────────────────────────────────────
  const ledger = await prisma.scholarFetchRun.findMany({
    where: { userId, startedAt: { gte: new Date(now.getTime() - LEDGER_LOOKBACK_MS) } },
    select: { trigger: true, status: true, startedAt: true },
    orderBy: { startedAt: 'desc' },
  });
  const quota = decideScholarQuota({ trigger, actorRole, runs: ledger, now });
  if (!quota.allowed) {
    const refusalRun = await prisma.scholarFetchRun.create({
      data: {
        userId,
        facultyMemberId: member.id,
        triggeredById,
        trigger,
        status: 'REFUSED',
        searchQuery,
        errorText: quota.reason ?? 'Refused by quota.',
        startedAt: now,
        finishedAt: now,
      },
      select: { id: true },
    });
    return {
      status: 'REFUSED',
      runId: refusalRun.id,
      reason: quota.reason ?? 'Refused by quota.',
      retryAt: quota.retryAt ?? null,
      papersFound: 0,
      papersInserted: 0,
      citationsUpdated: 0,
      papersSkippedNoYear: 0,
      creditsUsed: 0,
      searchQuery,
    };
  }

  // ── 3. Open the run ─────────────────────────────────────────────────────
  // Opened as FAILED on purpose. Status is NOT NULL and there is no
  // "in flight" value; FAILED is the honest default because a process that
  // dies mid-fetch produced no data, and FAILED is the one status the quota
  // unit ignores — a crash must not burn someone's month.
  const run = await prisma.scholarFetchRun.create({
    data: {
      userId,
      facultyMemberId: member.id,
      triggeredById,
      trigger,
      status: 'FAILED',
      searchQuery,
      errorText: 'Fetch in progress.',
      startedAt: now,
    },
    select: { id: true },
  });

  // ── 4. Binding ──────────────────────────────────────────────────────────
  const profileId = member.scholarProfileId?.trim();
  if (!profileId) {
    // No fetch, so no credit and no quota consumption (REFUSED is ignored by
    // the quota unit). The UI reads SCHOLAR_NEEDS_BINDING and asks for the
    // profile URL; `bindScholarProfile` is the separate call that follows.
    // There is deliberately no name-search fallback: Scholar's
    // `view_op=search_authors` is behind a mandatory Google sign-in wall, and
    // guessing at a profile is how the wrong person's papers get imported.
    const reason =
      'No Google Scholar profile is linked to this staff record yet. Paste the profile URL to link it, then fetch.';
    await prisma.scholarFetchRun.update({
      where: { id: run.id },
      data: { status: 'REFUSED', errorText: `${SCHOLAR_NEEDS_BINDING}: ${reason}`, finishedAt: new Date() },
    });
    return {
      status: 'REFUSED',
      runId: run.id,
      reason: SCHOLAR_NEEDS_BINDING,
      retryAt: null,
      papersFound: 0,
      papersInserted: 0,
      citationsUpdated: 0,
      papersSkippedNoYear: 0,
      creditsUsed: 0,
      searchQuery,
    };
  }

  let creditsUsed = 0;
  try {
    // ── 5. Fetch every page, archive the raw payload, parse ───────────────
    const pages: string[] = [];
    const papers: ScholarPaper[] = [];
    const seenPaperIds = new Set<string>();
    let truncated = false;

    for (let page = 0; page < SCHOLAR_MAX_PAGES; page += 1) {
      const result = await fetchPage(buildScholarProfilePageUrl(profileId, page * SCHOLAR_PAGE_SIZE));
      pages.push(result.html);
      if (typeof result.creditsUsed === 'number' && Number.isFinite(result.creditsUsed)) {
        creditsUsed += result.creditsUsed;
      }

      let fresh = 0;
      for (const paper of parsePage(result.html)) {
        if (seenPaperIds.has(paper.scholarPaperId)) continue;
        seenPaperIds.add(paper.scholarPaperId);
        papers.push(paper);
        fresh += 1;
      }

      const rowsOnPage = (result.html.match(ROW_MARKER) ?? []).length;
      if (rowsOnPage < SCHOLAR_PAGE_SIZE) break; // short page — that was the last one
      if (fresh === 0) break; // Scholar re-served a page we already have; stop rather than loop
      if (page === SCHOLAR_MAX_PAGES - 1) truncated = true;
    }

    const rawPayload = pages.join('\n<!-- kku:scholar-page-break -->\n');
    await prisma.scholarFetchArchive.create({
      data: {
        fetchRunId: run.id,
        rawPayload,
        contentHash: createHash('sha256').update(rawPayload).digest('hex'),
        parserVersion: SCHOLAR_PARSER_VERSION,
      },
    });

    // A paper with no usable year is SKIPPED, never inserted with a guess.
    // `ResearchOutput.year` is NOT NULL and feeds year-banded aggregates, so a
    // wrong year is worse than a missing paper. The shipped parser already
    // drops these; this is the second wall, and it is counted so a parser
    // regression shows up as PARTIAL in the ledger instead of silently
    // shrinking someone's library.
    const usable = papers.filter((p) => Number.isInteger(p.year) && p.year > 0);
    const papersSkippedNoYear = papers.length - usable.length;

    // ── 6. Plan and apply — additive only, one transaction ────────────────
    const existing = await prisma.researchOutput.findMany({
      where: { facultyMemberId: member.id },
      select: { id: true, title: true, year: true, doi: true, citations: true },
    });
    const plan = planScholarMerge({ scholar: usable, existing });

    const insertRows = plan.inserts.map((p) => ({
      facultyMemberId: member.id,
      year: p.year,
      type: toResearchOutputType(p.type),
      title: p.title,
      venue: p.venue,
      citations: p.citations,
      doi: p.doi,
      scholarPaperId: p.scholarPaperId,
      source: SOURCE,
      // Whose Scholar profile this row came off — the same reconciliation
      // handle the kku-research connector writes.
      kkuAuthorName: searchQuery,
    }));

    const [insertResult, ...updateResults] = await prisma.$transaction([
      prisma.researchOutput.createMany({ data: insertRows, skipDuplicates: true }),
      ...plan.citationUpdates.map((u) =>
        // updateMany, not update, and scoped: only ever raise the citation
        // count and only stamp `scholarPaperId` onto a row that has none (or
        // already has this one). Metadata — title, venue, year, source — is
        // never touched, so a Scopus-sourced row keeps its provenance.
        // A collision with another row's paper id becomes a no-op rather than
        // a unique-constraint failure that would lose the whole run.
        prisma.researchOutput.updateMany({
          where: {
            id: u.id,
            facultyMemberId: member.id,
            OR: [{ scholarPaperId: null }, { scholarPaperId: u.scholarPaperId }],
          },
          data: { citations: u.citations, scholarPaperId: u.scholarPaperId },
        }),
      ),
    ]);

    const papersInserted = insertResult?.count ?? 0;
    const citationsUpdated = updateResults.reduce((sum, r) => sum + (r?.count ?? 0), 0);

    // ── 7. Expire the publications cache ─────────────────────────────────
    await expireUserPublicationsCache(userId);

    // ── 8. Finalise ──────────────────────────────────────────────────────
    const notes: string[] = [];
    if (truncated) {
      notes.push(
        `Stopped at the ${SCHOLAR_MAX_PAGES}-page ceiling (${SCHOLAR_MAX_PAGES * SCHOLAR_PAGE_SIZE} papers); this profile may have more.`,
      );
    }
    if (papersSkippedNoYear > 0) {
      notes.push(`${papersSkippedNoYear} paper(s) had no usable year and were not imported.`);
    }
    const status: ScholarStatus = notes.length > 0 ? 'PARTIAL' : 'SUCCEEDED';

    await prisma.scholarFetchRun.update({
      where: { id: run.id },
      data: {
        status,
        papersFound: papers.length,
        papersInserted,
        citationsUpdated,
        creditsUsed: Math.round(creditsUsed),
        errorText: notes.length > 0 ? notes.join(' ') : null,
        finishedAt: new Date(),
      },
    });

    return {
      status,
      runId: run.id,
      reason: notes.length > 0 ? notes.join(' ') : null,
      retryAt: null,
      papersFound: papers.length,
      papersInserted,
      citationsUpdated,
      papersSkippedNoYear,
      creditsUsed: Math.round(creditsUsed),
      searchQuery,
    };
  } catch (err) {
    // Nothing reached ResearchOutput: every write to it is inside the single
    // transaction above, which is all-or-nothing, and the only step after it
    // (cache expiry) cannot throw. The run is marked FAILED, which the quota
    // unit ignores — a ScrapingBee timeout must not burn someone's month.
    const errorText = describeError(err);
    await prisma.scholarFetchRun.update({
      where: { id: run.id },
      data: {
        status: 'FAILED',
        errorText,
        creditsUsed: Math.round(creditsUsed),
        finishedAt: new Date(),
      },
    });
    return {
      status: 'FAILED',
      runId: run.id,
      reason: errorText,
      retryAt: null,
      papersFound: 0,
      papersInserted: 0,
      citationsUpdated: 0,
      papersSkippedNoYear: 0,
      creditsUsed: Math.round(creditsUsed),
      searchQuery,
    };
  }
}

/**
 * Mark the user's publications cache stale so the next profile-page load
 * recomputes it against the rows this fetch just added.
 *
 * Expiry, not removal. Two reasons: this module never removes a row from any
 * table (see the header), and `loadPublicationsWithCache` in
 * apps/web/src/lib/profile-data.ts treats an aged row as
 * stale-while-revalidate — it serves immediately and refreshes in the
 * background — so an expired row degrades better than an absent one, which
 * would block the next page load on the full 3-5s pipeline.
 *
 * Never throws: a cache that failed to expire is a stale page, not a lost
 * fetch, and the ResearchOutput writes are already committed by this point.
 */
async function expireUserPublicationsCache(userId: string): Promise<void> {
  try {
    await prisma.userPublicationsCache.updateMany({
      where: { userId },
      data: { fetchedAt: new Date(0) },
    });
  } catch (err) {
    console.warn(`[scholar-fetch] could not expire publications cache for user=${userId}:`, describeError(err));
  }
}

function refusedWithoutRun(reason: string): ScholarFetchResult {
  return {
    status: 'REFUSED',
    runId: null,
    reason,
    retryAt: null,
    papersFound: 0,
    papersInserted: 0,
    citationsUpdated: 0,
    papersSkippedNoYear: 0,
    creditsUsed: 0,
    searchQuery: null,
  };
}

/**
 * Error text safe to persist. Name plus message, truncated. The ScrapingBee
 * client already guarantees its errors never carry the request URL (and so
 * never the API key); this bound is the second wall against an unbounded
 * upstream string landing in the ledger.
 */
function describeError(err: unknown): string {
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return raw.length > 2000 ? `${raw.slice(0, 2000)}…` : raw;
}

// ── Binding ───────────────────────────────────────────────────────────────

const bindInputSchema = z.object({
  facultyMemberId: z.string().min(1),
  url: z.string().min(1),
  boundById: z.string().min(1),
});

export interface BindScholarProfileInput {
  facultyMemberId: string;
  /** The profile URL a human pasted. The profile id is derived from it. */
  url: string;
  boundById: string;
  /** Same injected ScrapingBee wrapper the runner takes — see the header. */
  fetchPage: ScholarPageFetcher;
  now?: Date;
}

export interface BindScholarProfileResult {
  scholarProfileId: string;
  /** The name the profile displays — what the match was made against. */
  profileName: string;
  /** Credits the verification page cost. Not in the quota ledger: a bind is
   *  not a fetch, and it must not consume someone's monthly allowance. */
  creditsUsed: number;
}

/**
 * Link a Google Scholar profile to a staff record, after VERIFYING that the
 * profile's own name matches the person it is being attached to.
 *
 * The verification is the point. Scholar's author search
 * (`view_op=search_authors`) is behind a mandatory Google sign-in wall —
 * verified across proxies, render_js settings and countries, with the real
 * response committed as a fixture — so name matching cannot drive discovery.
 * It can, and does, drive the one moment a human asserts an identity: the
 * page fetched here is page 1 of the publication list, so the check costs no
 * extra request, and a mismatch refuses the bind rather than silently
 * attaching a stranger's papers to a Council-facing research record.
 *
 * The profile id is derived from the URL rather than accepted as a separate
 * parameter, so the two can never disagree in the stored row.
 *
 * Idempotent — rebinding overwrites the four columns and is audit-logged
 * either way, because "who pointed this person's publication record at that
 * profile, and when" is exactly the question asked after a wrong import.
 */
export async function bindScholarProfile(
  input: BindScholarProfileInput,
): Promise<BindScholarProfileResult> {
  const { facultyMemberId, url, boundById } = bindInputSchema.parse(input);
  const now = input.now ?? new Date();

  const parsed = parseScholarProfileUrl(url);
  if (!parsed.ok) {
    throw new Error(`Cannot link that Scholar profile: ${parsed.reason}`);
  }
  const scholarProfileId = parsed.profileId;

  const member = await prisma.facultyMember.findUnique({
    where: { id: facultyMemberId },
    select: {
      id: true,
      nameEn: true,
      nameTh: true,
      employeeId: true,
      scholarProfileId: true,
      scholarProfileUrl: true,
    },
  });
  if (!member) {
    throw new Error(`No staff record with id "${facultyMemberId}".`);
  }

  // Refuse a profile already linked elsewhere rather than letting the unique
  // index surface as an opaque P2002: two people sharing one Scholar profile
  // is always a mistake, and the message needs to name what is in the way.
  const conflict = await prisma.facultyMember.findFirst({
    where: { scholarProfileId, NOT: { id: facultyMemberId } },
    select: { id: true, nameEn: true, nameTh: true },
  });
  if (conflict) {
    throw new Error(
      `That Scholar profile is already linked to another staff record (${conflict.nameEn || conflict.nameTh || conflict.id}).`,
    );
  }

  // Who we expect the profile to belong to: the staff record's English name,
  // falling back to the linked account's name when the record has none.
  const expectedNames: string[] = [];
  if (member.nameEn.trim()) expectedNames.push(member.nameEn.trim());
  if (expectedNames.length === 0 && member.employeeId) {
    const account = await prisma.user.findFirst({
      where: { employeeId: member.employeeId },
      select: { name: true },
    });
    if (account?.name?.trim()) expectedNames.push(account.name.trim());
  }
  if (expectedNames.length === 0) {
    throw new Error(
      'That staff record has no English name and no linked account name, so the Scholar profile cannot be verified against anyone. Fill in the staff record first.',
    );
  }

  const pageOne = await input.fetchPage(buildScholarProfilePageUrl(scholarProfileId, 0));
  const creditsUsed =
    typeof pageOne.creditsUsed === 'number' && Number.isFinite(pageOne.creditsUsed)
      ? Math.round(pageOne.creditsUsed)
      : 0;
  const identity = parseScholarProfileIdentity(pageOne.html);
  if (!identity.displayName) {
    // No profile header at all — an error page, a redirect shell, or the
    // sign-in wall. "Cannot verify" is not "verified".
    throw new Error(
      `Could not read a profile name from ${url}. The page did not come back as a Scholar profile — check the link and try again.`,
    );
  }

  const profileNames = [identity.displayName, ...identity.otherNames];
  const verified = profileNames.some((candidate) => personNameMatchesAny(candidate, expectedNames));
  if (!verified) {
    // Both sides quoted, so a human can see exactly what mismatched and
    // decide whether the staff record or the link is the thing to fix.
    throw new Error(
      `That Scholar profile does not appear to belong to this person. ` +
        `The profile is named "${profileNames.join('", "')}"; the staff record says "${expectedNames.join('", "')}". ` +
        'Refusing to link them.',
    );
  }

  await prisma.facultyMember.update({
    where: { id: facultyMemberId },
    data: {
      scholarProfileId,
      scholarProfileUrl: url,
      scholarBoundAt: now,
      scholarBoundById: boundById,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: boundById,
      action: member.scholarProfileId ? 'scholar.profile.rebind' : 'scholar.profile.bind',
      entityType: 'FacultyMember',
      entityId: facultyMemberId,
      payloadJson: {
        scholarProfileId,
        scholarProfileUrl: url,
        verifiedAgainst: expectedNames,
        profileNames,
        previousScholarProfileId: member.scholarProfileId,
        previousScholarProfileUrl: member.scholarProfileUrl,
      },
    },
  });

  return { scholarProfileId, profileName: identity.displayName, creditsUsed };
}
