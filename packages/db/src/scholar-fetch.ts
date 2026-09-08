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
// The runner is deliberately three phases with a single finalisation helper:
//
//     open the run  →  do the work  →  finalise (once, never throwing)
//
// `fetchAllPages` and `applyMergePlan` hold the work so the runner itself only
// owns that sequence. Every exit — refusal, success, failure — goes through
// `finaliseRun`, which swallows its own errors. An earlier shape finalised
// inline at three different points, one of which sat outside the try block;
// when a bookkeeping write failed AFTER the merge had committed, the rows were
// in the database while the run row read FAILED forever, the spent credits
// never reached the ledger, and because quota ignores FAILED the operator
// simply re-ran and spent again.
//
// Dependency injection, and why:
//   - `fetchPage` — the ScrapingBee wrapper lives in `@kku/shared`
//     (packages/shared/src/scholar/scrapingbee.ts; it moved out of
//     apps/ingestion/src/lib on 2026-09-08 when apps/api's synchronous bind
//     endpoint needed it too) and this runner lives in `packages/db`. It is
//     still passed in as a function rather than imported: what the runner
//     needs is a page fetcher, not that particular one. This follows the
//     existing DI shape in this package — `generateProgramResearchExpertise({
//     ai: AiService, … })` in program-research-expertise-run.ts takes its
//     outbound service the same way — and it is what makes the runner
//     testable with no network.
//   - `parsePage` and `now` are TEST SEAMS and live in a separate, deliberately
//     un-exported parameter. Both are dangerous as public input: a caller
//     passing `now` sixty days ahead sees no blocking runs and walks straight
//     through the quota (and then writes that fictional timestamp into
//     `startedAt`, poisoning the ledger for everyone downstream), and a caller
//     substituting a parser makes `ScholarFetchArchive.parserVersion` — always
//     stamped with the shipped version — describe a payload it did not read.
//     `export *` re-exports only what a module exports, so leaving the seam
//     type unexported is enough to make it un-nameable from the API layer.
//
// See docs/superpowers/specs/2026-09-08-google-scholar-on-demand-design.md.
// ────────────────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ResearchOutputType } from '@prisma/client';
import {
  SCHOLAR_LEDGER_LOOKBACK_MS,
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
 * How long an unfinished run blocks a new one for the same person.
 *
 * A run row is opened as FAILED with `finishedAt` null and only finalised at
 * the end, so "FAILED and unfinished and recent" is exactly "a fetch is
 * probably in flight". Without this, a double-click starts two page walks,
 * spends two lots of ~15-credit pages, and both pass quota because neither
 * has finished yet. It also stops an operator immediately re-running against
 * a row that a bookkeeping failure left unfinished.
 */
const STUCK_RUN_WINDOW_MS = 15 * 60 * 1000;

/**
 * Counts publication rows in a raw page, to decide whether another page
 * exists. Deliberately NOT `parsePage(html).length`: the parser drops rows
 * with no usable year, so a full page containing one such row would look
 * short and pagination would stop early, silently truncating the library.
 *
 * This marker is looser than the parser's own row regex, and that asymmetry
 * is the point rather than a weakness. Markup drift such as
 * `<tr class="gsc_a_tr" data-cid="…">` still matches here while the parser
 * extracts nothing, so "rows on the page, none of them parsed" is a
 * detectable disagreement — see the repeated/unparsable-page anomaly in
 * `fetchAllPages`, which forces the run to PARTIAL instead of letting it
 * finish clean and empty.
 */
const ROW_MARKER = /class="gsc_a_tr"/g;

/**
 * The `research_outputs.source` value every row this runner writes carries.
 *
 * Exported because it is a JOIN KEY, not a label: the profile page counts
 * `source = SCHOLAR_RESEARCH_OUTPUT_SOURCE` to say how many papers came from
 * Scholar rather than the library index. That count was written against a
 * hardcoded 'google-scholar' on the reading side, so renaming this constant
 * would have silently re-attributed every Scholar paper to the library index
 * instead of failing to compile.
 */
export const SCHOLAR_RESEARCH_OUTPUT_SOURCE = 'google-scholar';
const SOURCE = SCHOLAR_RESEARCH_OUTPUT_SOURCE;

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
}

/**
 * Test seams. NOT exported, and must not become so — see the module header
 * for what each one lets a caller do to the quota ledger and to archive
 * provenance if it is reachable from the API layer.
 */
interface ScholarFetchSeams {
  parsePage?: ScholarPageParser;
  now?: Date;
}

export interface ScholarFetchResult {
  status: ScholarStatus;
  /**
   * The run this call recorded, or the run it collided with. Null only when
   * nothing was recorded at all — the resolution refusals, which happen
   * before any row exists.
   */
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

const MEMBER_SELECT = {
  id: true,
  nameEn: true,
  nameTh: true,
  employeeId: true,
  isActive: true,
  scholarProfileId: true,
} as const;

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
/**
 * Every staff record, in the shape resolution needs.
 *
 * Loaded once and handed to `resolveScholarFacultyMember` when a caller has
 * many people to resolve — see the note on the name path below for why that
 * matters. A caller resolving ONE person should omit it.
 */
export async function loadScholarRoster(): Promise<ScholarFacultyMember[]> {
  return prisma.facultyMember.findMany({ select: MEMBER_SELECT });
}

export async function resolveScholarFacultyMember(
  userId: string,
  /**
   * Pre-loaded roster from `loadScholarRoster()`. When present, BOTH lookups
   * below run against it in memory instead of hitting the database, which is
   * what makes a bulk pre-flight one query rather than N.
   */
  roster?: ScholarFacultyMember[],
): Promise<ScholarMemberResolution> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, employeeId: true },
  });
  if (!user) {
    return { user: null, member: null, refusal: 'No user record for this account.' };
  }
  const publicUser = { id: user.id, name: user.name };

  // (a) Identity: HR employee id. Not unique in the schema, so the same
  // one-or-refuse rule applies here as to the name path.
  let employeeIdMissed = false;
  if (user.employeeId) {
    const byEmployeeId = roster
      ? roster.filter((m) => m.employeeId === user.employeeId)
      : await prisma.facultyMember.findMany({
          where: { employeeId: user.employeeId },
          select: MEMBER_SELECT,
        });
    const picked = pickSingleMember(byEmployeeId, `HR employee id "${user.employeeId}"`);
    if (picked.member) return { user: publicUser, member: picked.member, refusal: null };
    if (picked.refusal) return { user: publicUser, member: null, refusal: picked.refusal };
    employeeIdMissed = true; // it exists, it just matched nothing — say so below
  }

  // (b) Name: exact match on the normalised English name.
  const accountName = user.name?.trim();
  if (!accountName) {
    return {
      user: publicUser,
      member: null,
      refusal: employeeIdMissed
        ? `HR employee id "${user.employeeId}" matches no staff record, and this account has no name to match one by.`
        : 'This account carries no HR employee id and no name, so it cannot be matched to a staff record.',
    };
  }

  // The comparison is normalised (case, diacritics, punctuation, token
  // order) and so cannot be expressed in SQL against `name_en`, so the whole
  // table — a few thousand rows of short strings — is scanned in memory. That
  // is cheaper than a `contains` pre-filter, which would miss exactly the
  // diacritic and punctuation cases the normaliser exists to handle.
  //
  // This function is NO LONGER once-per-human-initiated-fetch, which an
  // earlier version of this comment claimed. It is now also called once per
  // target by the bulk pre-flight in apps/api/src/scholar/scholar.service.ts,
  // and on every poll of GET /scholar/status/me. Pass `roster` for the first
  // of those — N sequential unfiltered scans inside one HTTP request is what
  // the parameter exists to prevent. The status endpoint resolves one person
  // and takes the scan; if that ever shows up in a profile, cache the roster
  // rather than weakening the match.
  const everyone = roster ?? (await prisma.facultyMember.findMany({ select: MEMBER_SELECT }));
  const byName = everyone.filter((m) => personNamesMatch(m.nameEn, accountName));
  const picked = pickSingleMember(byName, `The name "${accountName}"`);
  if (picked.member) return { user: publicUser, member: picked.member, refusal: null };
  if (picked.refusal) return { user: publicUser, member: null, refusal: picked.refusal };

  return {
    user: publicUser,
    member: null,
    refusal:
      `No staff record matches the name "${accountName}" (searched English names)` +
      (employeeIdMissed
        ? `, and HR employee id "${user.employeeId}" matches none either.`
        : ', and this account carries no HR employee id to match one by.'),
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

// ── Phase: fetch ──────────────────────────────────────────────────────────

/**
 * Everything the runner still needs to report if the walk throws part-way
 * through. Mutated as pages arrive, so spent credits reach the ledger even
 * on a run that fails on page 4 — otherwise ~45 credits would vanish and the
 * operator would have no signal that money was spent.
 */
interface ScholarFetchProgress {
  creditsUsed: number;
  papersFound: number;
}

interface ScholarFetchPages {
  pages: string[];
  papers: ScholarPaper[];
  /** Stopped at SCHOLAR_MAX_PAGES with more pages apparently available. */
  truncated: boolean;
  /** A page carried publication rows the parser could not read at all. */
  unreadableRows: boolean;
  /**
   * `cstart` of a page that came back with no publication rows AND no profile
   * header — a consent screen, robot interstitial or gone-profile page, all of
   * which Google serves with HTTP 200. Null when every page was a real profile
   * page. Non-null is fatal, but the runner raises it AFTER archiving so the
   * wall itself is on disk to look at.
   */
  wallAtCstart: number | null;
}

/**
 * Walk the profile's publication list, page by page.
 *
 * The end-of-list test is the subtle part. "No rows on this page" is what a
 * finished list looks like — and it is also what a consent screen looks like,
 * because Google serves those with HTTP 200 so nothing throws and the parser
 * simply finds nothing. Distinguishing them needs the profile header, so every
 * zero-row page is checked for one before it is accepted as the end. Checking
 * only page 1 (an earlier version) left a wall on page 2 indistinguishable
 * from a 100-paper library: success reported, credits spent, quota burnt, and
 * everything past page 1 quietly missing — which bites the most prolific
 * researchers first, since they are the only ones who need a second page.
 * ScrapingBee rotates the exit IP per request, so a wall on page 2 is no less
 * likely than on page 1.
 */
async function fetchAllPages(
  profileId: string,
  fetchPage: ScholarPageFetcher,
  parsePage: ScholarPageParser,
  progress: ScholarFetchProgress,
): Promise<ScholarFetchPages> {
  const pages: string[] = [];
  const papers: ScholarPaper[] = [];
  const seenPaperIds = new Set<string>();
  let truncated = false;
  let unreadableRows = false;
  let wallAtCstart: number | null = null;

  for (let page = 0; page < SCHOLAR_MAX_PAGES; page += 1) {
    const cstart = page * SCHOLAR_PAGE_SIZE;
    const result = await fetchPage(buildScholarProfilePageUrl(profileId, cstart));
    pages.push(result.html);
    if (typeof result.creditsUsed === 'number' && Number.isFinite(result.creditsUsed)) {
      progress.creditsUsed += result.creditsUsed;
    }

    const parsed = parsePage(result.html);
    let fresh = 0;
    for (const paper of parsed) {
      if (seenPaperIds.has(paper.scholarPaperId)) continue;
      seenPaperIds.add(paper.scholarPaperId);
      papers.push(paper);
      fresh += 1;
    }
    progress.papersFound = papers.length;

    const rowsOnPage = (result.html.match(ROW_MARKER) ?? []).length;

    if (rowsOnPage === 0) {
      // End of the list, or a wall. Only the profile header tells them apart.
      if (!parseScholarProfileIdentity(result.html).displayName) {
        wallAtCstart = cstart;
      }
      break;
    }

    if (parsed.length === 0) {
      // Rows are on the page and the parser read none of them: the row markup
      // has drifted past it (`<tr class="gsc_a_tr" data-cid="…">` still matches
      // the loose marker while the parser's stricter row regex does not).
      // Stop — further pages would be equally unreadable and cost ~15 credits
      // each — and flag it, because "page 1 is unreadable, the real papers are
      // on page 2" would otherwise truncate a library and report clean.
      unreadableRows = true;
      break;
    }

    if (fresh === 0) {
      // Papers parsed, every one already held: Scholar re-served a page. This
      // is what a profile of exactly SCHOLAR_PAGE_SIZE papers does at the next
      // cstart, and it is BENIGN — the import is complete. Flagging it would
      // put "the list may be incomplete" on a complete Council-facing record,
      // which is the sort of noise that teaches operators to ignore the flag.
      break;
    }

    if (rowsOnPage < SCHOLAR_PAGE_SIZE) break; // short page — that was the last one
    if (page === SCHOLAR_MAX_PAGES - 1) truncated = true;
  }

  return { pages, papers, truncated, unreadableRows, wallAtCstart };
}

// ── Phase: apply ──────────────────────────────────────────────────────────

async function applyMergePlan(input: {
  memberId: string;
  searchQuery: string;
  usable: ScholarPaper[];
}): Promise<{ papersInserted: number; citationsUpdated: number }> {
  const { memberId, searchQuery, usable } = input;

  const existing = await prisma.researchOutput.findMany({
    where: { facultyMemberId: memberId },
    select: { id: true, title: true, year: true, doi: true, citations: true },
  });
  const plan = planScholarMerge({ scholar: usable, existing });

  const insertRows = plan.inserts.map((p) => ({
    facultyMemberId: memberId,
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
          facultyMemberId: memberId,
          OR: [{ scholarPaperId: null }, { scholarPaperId: u.scholarPaperId }],
        },
        data: { citations: u.citations, scholarPaperId: u.scholarPaperId },
      }),
    ),
  ]);

  return {
    papersInserted: insertResult?.count ?? 0,
    citationsUpdated: updateResults.reduce((sum, r) => sum + (r?.count ?? 0), 0),
  };
}

// ── Run bookkeeping ───────────────────────────────────────────────────────

interface RunFinalisation {
  status: ScholarStatus;
  errorText: string | null;
  papersFound?: number;
  papersInserted?: number;
  citationsUpdated?: number;
  creditsUsed?: number;
  finishedAt: Date;
}

/**
 * Close a run row. NEVER throws.
 *
 * This is bookkeeping about work that has already happened. By the time it
 * runs on the success path the merge is committed; letting a failed status
 * write turn that into an exception would leave the caller with a 500, the
 * rows in the database, the run reading FAILED forever, and the spent
 * credits missing from the ledger — after which quota (which ignores FAILED)
 * cheerfully lets the operator spend them again. On the failure path it must
 * not throw for a second reason: an exception here would replace the real
 * error with a database error and the actual cause would never surface.
 */
async function finaliseRun(runId: string, data: RunFinalisation): Promise<void> {
  try {
    await prisma.scholarFetchRun.update({ where: { id: runId }, data });
  } catch (err) {
    console.error(
      `[scholar-fetch] could not finalise run ${runId} as ${data.status}:`,
      describeError(err),
    );
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

// ── Input validation ──────────────────────────────────────────────────────

const runInputSchema = z.object({
  userId: z.string().min(1),
  triggeredById: z.string().min(1),
  trigger: z.enum(['SELF', 'ADMIN', 'ADMIN_BULK']),
  actorRole: z.string().min(1),
});

// ── Runner ────────────────────────────────────────────────────────────────

export async function runScholarFetch(
  input: RunScholarFetchInput,
  seams: ScholarFetchSeams = {},
): Promise<ScholarFetchResult> {
  const { userId, triggeredById, trigger, actorRole } = runInputSchema.parse(input);
  const fetchPage = input.fetchPage;
  const parsePage = seams.parsePage ?? parseScholarPublications;
  // One clock for the whole run, so `startedAt` and `finishedAt` cannot come
  // from different sources — an earlier version took the start from the seam
  // and the finish from the wall clock, which made test timestamps disagree
  // with each other for no reason.
  const clock = (): Date => seams.now ?? new Date();

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

  // ── 1a. The name this fetch is attributed to ────────────────────────────
  // English, never Thai: Scholar profiles are indexed under the Latin name.
  // Recorded on the run because a fetch that comes back empty is otherwise
  // undiagnosable without spending another ~15 credits, and because it is
  // the string the profile's own name is re-verified against below.
  const searchQuery = (member.nameEn.trim() || user?.name?.trim() || '') || null;
  if (!searchQuery) {
    return refusedWithoutRun(
      'This staff record has no English name and the account has no name either, so the fetch cannot be attributed to anyone.',
    );
  }

  // ── 2. Quota ────────────────────────────────────────────────────────────
  const now = clock();
  const ledger = await prisma.scholarFetchRun.findMany({
    where: { userId, startedAt: { gte: new Date(now.getTime() - SCHOLAR_LEDGER_LOOKBACK_MS) } },
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
        scholarProfileId: member.scholarProfileId,
        errorText: quota.reason ?? 'Refused by quota.',
        startedAt: now,
        finishedAt: now,
      },
      select: { id: true },
    });
    return {
      ...emptyCounts(),
      status: 'REFUSED',
      runId: refusalRun.id,
      reason: quota.reason ?? 'Refused by quota.',
      retryAt: quota.retryAt ?? null,
      searchQuery,
    };
  }

  // ── 2a. One fetch at a time ─────────────────────────────────────────────
  const inFlight = await prisma.scholarFetchRun.findFirst({
    where: {
      userId,
      status: 'FAILED',
      finishedAt: null,
      startedAt: { gt: new Date(now.getTime() - STUCK_RUN_WINDOW_MS) },
    },
    select: { id: true, startedAt: true },
    orderBy: { startedAt: 'desc' },
  });
  if (inFlight) {
    // Check-then-act, and deliberately so. Two requests that both read before
    // either writes will both pass, and both will walk the profile at ~15
    // credits a page — this does NOT make concurrent fetches impossible. What
    // it does cover is the two cases that actually happen: a double-clicked
    // button (the second read sees the first row) and an operator retrying
    // against a run some earlier failure left unfinished.
    //
    // A partial unique index would close the race and is deliberately not
    // used: with no sweeper for unfinished rows, a process dying mid-fetch
    // would wedge that person out of Scholar permanently. A window that
    // expires on its own fails in the recoverable direction.
    //
    // No new row either: a second ledger entry for the same intent is noise,
    // and this refusal costs nothing to repeat.
    const retryAt = new Date(inFlight.startedAt.getTime() + STUCK_RUN_WINDOW_MS);
    const waitMinutes = Math.max(1, Math.ceil((retryAt.getTime() - now.getTime()) / 60_000));
    return {
      ...emptyCounts(),
      status: 'REFUSED',
      runId: inFlight.id,
      reason:
        'A Scholar fetch for this person is already running and has not finished. ' +
        `Refusing to start a second one — each page costs credits. Try again in ${waitMinutes} minute${waitMinutes === 1 ? '' : 's'}.`,
      retryAt,
      searchQuery,
    };
  }

  // ── 3. Open the run ─────────────────────────────────────────────────────
  // Opened as FAILED on purpose. Status is NOT NULL and there is no
  // "in flight" value; FAILED is the honest default because a process that
  // dies mid-fetch produced no data, and FAILED is the one status the quota
  // unit ignores — a crash must not burn someone's month. `finishedAt` stays
  // null until finalisation, which is what makes the guard above work.
  const run = await prisma.scholarFetchRun.create({
    data: {
      userId,
      facultyMemberId: member.id,
      triggeredById,
      trigger,
      status: 'FAILED',
      searchQuery,
      scholarProfileId: member.scholarProfileId,
      errorText: 'Fetch in progress.',
      startedAt: now,
    },
    select: { id: true },
  });

  const progress: ScholarFetchProgress = { creditsUsed: 0, papersFound: 0 };

  try {
    // ── 4. Binding ────────────────────────────────────────────────────────
    const profileId = member.scholarProfileId?.trim();
    if (!profileId) {
      // No fetch, so no credit and no quota consumption (REFUSED is ignored
      // by the quota unit). The UI reads SCHOLAR_NEEDS_BINDING and asks for
      // the profile URL; `bindScholarProfile` is the separate call that
      // follows. There is deliberately no name-search fallback: Scholar's
      // `view_op=search_authors` is behind a mandatory Google sign-in wall,
      // and guessing at a profile is how the wrong person's papers get
      // imported.
      const reason =
        'No Google Scholar profile is linked to this staff record yet. Paste the profile URL to link it, then fetch.';
      await finaliseRun(run.id, {
        status: 'REFUSED',
        errorText: `${SCHOLAR_NEEDS_BINDING}: ${reason}`,
        finishedAt: clock(),
      });
      return {
        ...emptyCounts(),
        status: 'REFUSED',
        runId: run.id,
        reason: SCHOLAR_NEEDS_BINDING,
        searchQuery,
      };
    }

    // ── 5. Fetch every page, archive the raw payload, parse ───────────────
    const { pages, papers, truncated, unreadableRows, wallAtCstart } = await fetchAllPages(
      profileId,
      fetchPage,
      parsePage,
      progress,
    );

    const rawPayload = pages.join('\n<!-- kku:scholar-page-break -->\n');
    await prisma.scholarFetchArchive.create({
      data: {
        fetchRunId: run.id,
        rawPayload,
        contentHash: createHash('sha256').update(rawPayload).digest('hex'),
        parserVersion: SCHOLAR_PARSER_VERSION,
      },
    });

    // ── 5a. Prove we were actually on this person's profile ───────────────
    // Google serves consent screens, robot interstitials and "profile not
    // available" pages with HTTP 200, so the client does not throw and the
    // parser simply finds no rows. Without this check that lands as a clean
    // SUCCEEDED: the user is told it worked, ~15 credits per page are gone,
    // and their one fetch per 30 days is spent — since SUCCEEDED is exactly
    // what the quota unit counts. Failing instead leaves the quota untouched
    // and still records the credits. The raw payload is already archived
    // above, so the wall itself can be read back.
    //
    // A profile header that IS present with zero papers is a different thing
    // entirely — an empty Scholar profile — and succeeds correctly.
    if (wallAtCstart !== null) {
      throw new Error(
        `Google did not return a Scholar profile page for "${profileId}" at cstart=${wallAtCstart} (no profile header). ` +
          'This is usually a consent or robot interstitial, or a profile that is private or gone — not the end of the publication list.',
      );
    }

    const identity = parseScholarProfileIdentity(pages[0] ?? '');
    if (!identity.displayName) {
      // Rows but no header: not a shape Scholar produces, so treat it as a
      // page we do not understand rather than importing from it.
      throw new Error(
        `Google did not return a Scholar profile page for "${profileId}" (no profile header). ` +
          'This is usually a consent or robot interstitial, or a profile that is private or gone — not an empty publication list.',
      );
    }

    // Re-verify the binding on every fetch, by the same rule
    // `bindScholarProfile` applies. A correctly bound profile passes by
    // construction; this catches the profile being rebound underneath a
    // fetch, and a staff record renamed after binding.
    const profileNames = [identity.displayName, ...identity.otherNames];
    if (!profileNames.some((candidate) => personNameMatchesAny(candidate, [searchQuery]))) {
      throw new Error(
        `The linked Scholar profile is named "${profileNames.join('", "')}", but this staff record says "${searchQuery}". ` +
          'Refusing to import. Either the wrong profile is linked, or the staff record has been renamed since it was linked ' +
          '(an HR backfill correcting the English name will do this) — check which, then re-link the profile.',
      );
    }

    // A paper with no usable year is SKIPPED, never inserted with a guess.
    // `ResearchOutput.year` is NOT NULL and feeds year-banded aggregates, so a
    // wrong year is worse than a missing paper. The shipped parser already
    // drops these; this is the second wall, and it is counted so a parser
    // regression shows up as PARTIAL in the ledger instead of silently
    // shrinking someone's library.
    const usable = papers.filter((p) => Number.isInteger(p.year) && p.year > 0);
    const papersSkippedNoYear = papers.length - usable.length;

    // ── 6. Plan and apply — additive only, one transaction ────────────────
    const { papersInserted, citationsUpdated } = await applyMergePlan({
      memberId: member.id,
      searchQuery,
      usable,
    });

    // ── 7. Expire the publications cache ─────────────────────────────────
    await expireUserPublicationsCache(userId);

    // ── 8. Finalise ──────────────────────────────────────────────────────
    const notes: string[] = [];
    if (truncated) {
      notes.push(
        `Stopped at the ${SCHOLAR_MAX_PAGES}-page ceiling (${SCHOLAR_MAX_PAGES * SCHOLAR_PAGE_SIZE} papers); this profile may have more.`,
      );
    }
    if (unreadableRows) {
      notes.push(
        'A page carried publication rows the parser could not read — the row markup has drifted. The list may be incomplete.',
      );
    }
    if (papersSkippedNoYear > 0) {
      notes.push(`${papersSkippedNoYear} paper(s) had no usable year and were not imported.`);
    }
    // A run that ends on an anomaly having found NOTHING has the same
    // evidentiary standing as an interstitial: it imported nothing and we do
    // not know why. PARTIAL would still burn the 30-day allowance (the quota
    // unit counts it, correctly — PARTIAL normally means data arrived), so
    // that case is FAILED. PARTIAL stays for runs that imported something,
    // just not everything.
    const status: ScholarStatus =
      notes.length === 0 ? 'SUCCEEDED' : papers.length === 0 ? 'FAILED' : 'PARTIAL';
    const creditsUsed = Math.round(progress.creditsUsed);

    await finaliseRun(run.id, {
      status,
      papersFound: papers.length,
      papersInserted,
      citationsUpdated,
      creditsUsed,
      errorText: notes.length > 0 ? notes.join(' ') : null,
      finishedAt: clock(),
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
      creditsUsed,
      searchQuery,
    };
  } catch (err) {
    // Nothing reached ResearchOutput: every write to it lives inside the
    // single transaction in `applyMergePlan`, which is all-or-nothing, and
    // the only steps after it (cache expiry, finalisation) cannot throw. The
    // run is marked FAILED, which the quota unit ignores — a ScrapingBee
    // timeout, a consent interstitial or a bad binding must not burn
    // someone's month. Credits and papers seen so far are still reported;
    // money was spent whether or not the run finished.
    const errorText = describeError(err);
    const creditsUsed = Math.round(progress.creditsUsed);
    await finaliseRun(run.id, {
      status: 'FAILED',
      errorText,
      papersFound: progress.papersFound,
      creditsUsed,
      finishedAt: clock(),
    });
    return {
      status: 'FAILED',
      runId: run.id,
      reason: errorText,
      retryAt: null,
      papersFound: progress.papersFound,
      papersInserted: 0,
      citationsUpdated: 0,
      papersSkippedNoYear: 0,
      creditsUsed,
      searchQuery,
    };
  }
}

function emptyCounts(): Pick<
  ScholarFetchResult,
  'papersFound' | 'papersInserted' | 'citationsUpdated' | 'papersSkippedNoYear' | 'creditsUsed' | 'retryAt'
> {
  return {
    papersFound: 0,
    papersInserted: 0,
    citationsUpdated: 0,
    papersSkippedNoYear: 0,
    creditsUsed: 0,
    retryAt: null,
  };
}

function refusedWithoutRun(reason: string): ScholarFetchResult {
  return {
    ...emptyCounts(),
    status: 'REFUSED',
    runId: null,
    reason,
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
  // falling back to the linked account's name when the record has none. Same
  // string the runner re-verifies against on every fetch.
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
    // No profile header at all — an error page, a redirect shell, a consent
    // interstitial, or the sign-in wall. "Cannot verify" is not "verified".
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
