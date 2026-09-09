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
// ── The unbound branch (2026-09-09) ───────────────────────────────────────
//
// `SCHOLAR_NEEDS_BINDING` used to be where this runner stopped: no profile
// linked meant refuse, spend nothing, and ask a human to paste a URL. It is
// now the SEARCH branch. Unbound means: search Google Scholar for the staff
// record's English name (75 credits), resolve a profile id out of that one
// page, record it, and then fetch that profile exactly as a bound person's
// sync does. The paste survives as a manual override for when the search
// resolves the wrong person.
//
// Three properties of that branch are load-bearing and easy to lose:
//
//   - The BINDING IS RECORDED FROM THE PROFILE PAGE, not from the search
//     page. The order is fetch → wall/header/name checks → bind → merge, so a
//     binding only ever exists for a profile that came back as a real Scholar
//     profile whose name matches the staff record. It also puts the
//     "already linked to someone else" conflict check strictly BEFORE any
//     ResearchOutput write. If the profile fetch throws, nothing is recorded
//     and the next sync re-spends the 75 — the right side to err on.
//   - A MACHINE-RESOLVED BINDING IS NOT A HUMAN ASSERTION, and the audit
//     record says so in the column an auditor filters on: the action verb is
//     `scholar.profile.auto-bind`, not `scholar.profile.bind`. What was
//     searched, which card won and how all ride in `payloadJson.resolution`,
//     alongside the fetch-run id so the archived page itself can be re-read.
//   - A SEARCH THAT RESOLVES NOTHING SPENT REAL MONEY. It does NOT consume
//     the 30-day fetch allowance — see the comment on the refusal itself for
//     why that would be worse, not better — it is metered as a BIND ATTEMPT,
//     which is what it is: a spend-before-success identity assertion.
//
// See docs/superpowers/specs/2026-09-08-google-scholar-on-demand-design.md,
// and 2026-09-09-scholar-name-resolution-design.md for the branch above.
// ────────────────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ResearchOutputType } from '@prisma/client';
import {
  DEFAULT_SCHOLAR_BIND_MAX_PER_DAY,
  SCHOLAR_LEDGER_LOOKBACK_MS,
  SCHOLAR_PARSER_VERSION,
  decideScholarBindQuota,
  decideScholarQuota,
  parseScholarProfileIdentity,
  parseScholarProfileUrl,
  parseScholarPublications,
  personNameTokens,
  personNamesMatch,
  planScholarMerge,
  scholarBindQuotaWhere,
  scholarNameMatchesAny,
  type ScholarPaper,
  type ScholarStatus,
  type ScholarTrigger,
} from '@kku/shared';
// Both spelled with `src/`, and both spellings are keys in @kku/shared's
// `exports` map for that reason. This package typechecks under
// moduleResolution 'node', which ignores that map and finds a subpath only
// through a deep path — while Node at RUNTIME honours the map and refuses any
// path it does not list. Measured both ways from here on 2026-09-09: the short
// `@kku/shared/scholar/search-parse` resolves at runtime and fails tsc with
// TS2307; the deep one typechecks and threw ERR_PACKAGE_PATH_NOT_EXPORTED.
// Listing the deep spelling is what makes one specifier work in both worlds.
//
// `search-parse` pulls cheerio and must stay off any client-reachable path.
// It is safe HERE — packages/db is server-only — and the boundary it must not
// cross is `@kku/shared`'s barrel, which it stays off; there is a test in
// packages/shared asserting that, and another asserting no app imports it.
import {
  SCHOLAR_SEARCH_PARSER_VERSION,
  parseScholarSearchPage,
} from '@kku/shared/src/scholar/search-parse';
import {
  SCHOLAR_DISAMBIGUATION_CAP,
  SCHOLAR_RESOLUTION_VERSION,
  resolveScholarDisambiguation,
  resolveScholarProfile,
  type ScholarCandidateProfile,
  type ScholarResolutionVia,
} from '@kku/shared/src/scholar/resolve';
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
   * The one exception is the unresolved-profile refusal, where this is the
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

/**
 * Reason code the UI keys off to prompt for a Scholar profile URL.
 *
 * Its MEANING changed on 2026-09-09 while its value deliberately did not.
 * It used to mean "we declined to look you up"; it now means "we looked and
 * could not find a profile we are willing to attach to you" — after spending
 * 75 credits on a name search. The affordance the UI should offer is
 * identical either way (paste the URL), and three surfaces already branch on
 * `errorText.startsWith(SCHOLAR_NEEDS_BINDING)`, so changing the string would
 * have re-taught them all for no gain.
 */
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
 * Every staff record, in the shape resolution needs.
 *
 * Loaded once and handed to `inMemoryScholarRoster` when a caller has many
 * people to resolve — see the note on `ScholarRosterLookup` for why that
 * matters. A caller resolving ONE person should use `databaseScholarRoster`,
 * which reads the table only if the employee-id lookup misses.
 */
export async function loadScholarRoster(): Promise<ScholarFacultyMember[]> {
  return prisma.facultyMember.findMany({ select: MEMBER_SELECT });
}

/** The three columns resolution reads off a `User`. */
export interface ScholarAccount {
  id: string;
  name: string | null;
  employeeId: string | null;
}

/**
 * Where resolution gets its candidate staff records.
 *
 * Two implementations, because the two callers want opposite trade-offs and
 * neither may be allowed to have its own copy of the RULE:
 *
 *   `databaseScholarRoster()` — one person at a time. An indexed point query
 *   on `employeeId` first, and the full table only if that misses. This is
 *   what `GET /scholar/status/me` runs, and the profile panel polls it every
 *   four seconds, so the common case must not read 3,852 rows.
 *
 *   `inMemoryScholarRoster(roster)` — many people at once. One read of the
 *   table, indexed once, then every lookup is a Map hit. This is what the bulk
 *   pre-flight and the admin console run.
 *
 * `nameCandidates` MAY OVER-RETURN. It narrows; `personNamesMatch` decides.
 */
export interface ScholarRosterLookup {
  byEmployeeId(employeeId: string): Promise<ScholarFacultyMember[]>;
  nameCandidates(name: string): Promise<ScholarFacultyMember[]>;
}

/**
 * The only key a name match can be bucketed on without changing its verdict.
 *
 * THIS IS AN EXACT PRE-FILTER, NOT AN APPROXIMATION. `personNamesMatch`
 * returns true through exactly two branches, and both require the two names'
 * SUBSTANTIAL (multi-character) tokens to be equal: the fast branch compares
 * all tokens, which implies it, and the slow branch tests it outright before
 * looking at initials. Sharing a substantial-token key is therefore a
 * NECESSARY condition for a match, so bucketing on it can only exclude names
 * that would have been refused anyway.
 */
function substantialNameKey(name: string): string {
  return personNameTokens(name)
    .filter((t) => t.length > 1)
    .join(' ');
}

/**
 * Resolve many accounts against one read of the staff table.
 *
 * The alternative — which the admin console started with — is to scan the
 * whole roster per person: 624 accounts against 3,852 staff records
 * re-tokenises both sides 2.4 million times and took 2.9 seconds on a warm
 * dev box.
 */
export function inMemoryScholarRoster(
  roster: readonly ScholarFacultyMember[],
): ScholarRosterLookup {
  const byEmployeeId = new Map<string, ScholarFacultyMember[]>();
  const byNameKey = new Map<string, ScholarFacultyMember[]>();
  const push = (map: Map<string, ScholarFacultyMember[]>, key: string, m: ScholarFacultyMember) => {
    const existing = map.get(key);
    if (existing) existing.push(m);
    else map.set(key, [m]);
  };
  for (const member of roster) {
    if (member.employeeId) push(byEmployeeId, member.employeeId, member);
    // Indexed under its key even when that key is EMPTY — a name that reduces
    // to nothing, or to initials alone. `personNamesMatch`'s fast branch
    // (all tokens equal) can still match two such names, so dropping them
    // would make this a filter that changes verdicts rather than one that
    // only narrows. Those members share one bucket that no ordinary lookup
    // reaches, and `personNamesMatch` still has the final say inside it.
    push(byNameKey, substantialNameKey(member.nameEn), member);
  }
  return {
    byEmployeeId: async (employeeId) => byEmployeeId.get(employeeId) ?? [],
    nameCandidates: async (name) => byNameKey.get(substantialNameKey(name)) ?? [],
  };
}

/** One person at a time: point query first, full table only on a miss. */
export function databaseScholarRoster(): ScholarRosterLookup {
  let everyone: Promise<ScholarFacultyMember[]> | null = null;
  return {
    byEmployeeId: (employeeId) =>
      prisma.facultyMember.findMany({ where: { employeeId }, select: MEMBER_SELECT }),
    nameCandidates: () => {
      // The comparison is normalised (case, diacritics, punctuation, token
      // order) and so cannot be expressed in SQL against `name_en`, so the
      // whole table — a few thousand rows of short strings — is scanned in
      // memory. That is cheaper than a `contains` pre-filter, which would miss
      // exactly the diacritic and punctuation cases the normaliser exists to
      // handle. Memoised so a caller resolving twice reads once.
      everyone ??= loadScholarRoster();
      return everyone;
    },
  };
}

/**
 * Resolve the FacultyMember row behind a `User`. THE rule; everything else in
 * this section only decides where the candidates come from.
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
export async function resolveScholarMember(
  account: ScholarAccount,
  lookup: ScholarRosterLookup,
): Promise<ScholarMemberResolution> {
  const publicUser = { id: account.id, name: account.name };

  // (a) Identity: HR employee id. Not unique in the schema, so the same
  // one-or-refuse rule applies here as to the name path.
  let employeeIdMissed = false;
  if (account.employeeId) {
    const byEmployeeId = await lookup.byEmployeeId(account.employeeId);
    const picked = pickSingleMember(byEmployeeId, `HR employee id "${account.employeeId}"`);
    if (picked.member) return { user: publicUser, member: picked.member, refusal: null };
    if (picked.refusal) return { user: publicUser, member: null, refusal: picked.refusal };
    employeeIdMissed = true; // it exists, it just matched nothing — say so below
  }

  // (b) Name: exact match on the normalised English name.
  const accountName = account.name?.trim();
  if (!accountName) {
    return {
      user: publicUser,
      member: null,
      refusal: employeeIdMissed
        ? `HR employee id "${account.employeeId}" matches no staff record, and this account has no name to match one by.`
        : 'This account carries no HR employee id and no name, so it cannot be matched to a staff record.',
    };
  }

  const candidates = await lookup.nameCandidates(accountName);
  const byName = candidates.filter((m) => personNamesMatch(m.nameEn, accountName));
  const picked = pickSingleMember(byName, `The name "${accountName}"`);
  if (picked.member) return { user: publicUser, member: picked.member, refusal: null };
  if (picked.refusal) return { user: publicUser, member: null, refusal: picked.refusal };

  return {
    user: publicUser,
    member: null,
    refusal:
      `No staff record matches the name "${accountName}" (searched English names)` +
      (employeeIdMissed
        ? `, and HR employee id "${account.employeeId}" matches none either.`
        : ', and this account carries no HR employee id to match one by.'),
  };
}

export async function resolveScholarFacultyMember(
  userId: string,
  /**
   * Pre-loaded roster from `loadScholarRoster()`. When present the lookups
   * run against it in memory instead of hitting the database, which is what
   * makes a bulk pre-flight one query rather than N. Callers resolving MANY
   * accounts should build one `inMemoryScholarRoster` and call
   * `resolveScholarMember` directly — passing the array here re-indexes it
   * per person.
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
  return resolveScholarMember(
    user,
    roster ? inMemoryScholarRoster(roster) : databaseScholarRoster(),
  );
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

/**
 * The canonical public URL of a Scholar profile.
 *
 * A human binding pastes a URL and we keep it verbatim; a machine-resolved
 * binding has only an id, so this is what goes into
 * `FacultyMember.scholarProfileUrl` on that path. Round-trips through
 * `parseScholarProfileUrl`, which is what `bindScholarProfile` derives the
 * stored id from — so the id and the URL in that row cannot disagree.
 */
export function buildScholarProfileUrl(profileId: string): string {
  const url = new URL('https://scholar.google.com/citations');
  url.searchParams.set('user', profileId);
  url.searchParams.set('hl', 'en');
  return url.toString();
}

/**
 * One Scholar name search. 75 credits — five times a profile page — because
 * the transport adds `stealth_proxy` for searches, which it must: plain
 * `custom_google` comes back HTTP 500 on every `/scholar?q=`, and that 500 is
 * a lie whose `reason` field reads "Server responded with 403".
 *
 * ONLY `q`, `hl` and `as_vis` may be set. `num=`, `as_ylo=` and `as_yhi=` are
 * silently rejected by the proxy with an HTTP 500 (measured 2026-09-09), so
 * the publication-year window is filtered client-side after parsing and never
 * pushed into the query. Do not add parameters here without measuring.
 *
 * `as_vis=1` suppresses the "User profiles for X" cluster — the cleanest
 * carrier of a profile id — which is why the second, gated probe re-asks the
 * same question with it off.
 */
export function buildScholarSearchUrl(query: string, opts: { asVis: boolean }): string {
  const url = new URL('https://scholar.google.com/scholar');
  url.searchParams.set('q', query);
  url.searchParams.set('hl', 'en');
  if (opts.asVis) url.searchParams.set('as_vis', '1');
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

/**
 * Add what ScrapingBee actually billed for one page.
 *
 * The run's `creditsUsed` is the SUM of real `Spb-Cost` headers, never pages
 * times a constant — and since 2026-09-09 that is not a nicety: a search is
 * billed at 75 and a profile page at 15, so a first-time sync is
 * `75 + 15 × pages` and any constant would be wrong for one of the two. Null
 * contributes 0, which reads as an obviously missing number rather than a
 * plausibly cheap one.
 */
function addCredits(progress: ScholarFetchProgress, creditsUsed: number | null): void {
  if (typeof creditsUsed === 'number' && Number.isFinite(creditsUsed)) {
    progress.creditsUsed += creditsUsed;
  }
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
    addCredits(progress, result.creditsUsed);

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

// ── Phase: resolve a profile from the name ────────────────────────────────

/**
 * Every way a profile id can be reached. The first four come from the search
 * page itself (`ScholarResolutionVia`); the last two are the disambiguation
 * verdict, reached only after candidate profiles were fetched. Closed on
 * purpose — `via` is what an auditor reads to know how much evidence stood
 * behind a binding, so a new way of resolving one must not be able to slip
 * into the audit record as an unrecognised string.
 */
export type ScholarBindingVia = ScholarResolutionVia | 'primary-name' | 'other-name';

/** What a search-and-resolve pass concluded, when it concluded anything. */
export interface ScholarNameResolution {
  /** The Scholar `user=` id to bind and fetch. */
  authorId: string;
  /** How it was reached: primary card, alias card, byline anchor, … */
  via: ScholarBindingVia;
  /** The card, anchor or profile name that won the match. */
  matchedName: string;
  /** The search URL whose page decided it — says whether `as_vis` was set. */
  searchUrl: string;
  /** Candidate ids fetched to disambiguate, when that is what happened. */
  candidateIds?: string[];
}

interface ScholarSearchOutcome {
  resolution: ScholarNameResolution | null;
  /** Raw HTML of every page this pass fetched, so the archive holds them. */
  pages: string[];
  /**
   * Article rows the search returned.
   *
   * REPORTED, NEVER IMPORTED. The spec's flow line said "no profile id → use
   * the article results"; that is wrong for us and the spec is being
   * corrected. `ScholarSearchHit` carries no `scholarPaperId`, so
   * `planScholarMerge` has nothing to key on and every re-sync would insert
   * the same papers again — in the one table whose defining invariant is that
   * it is additive-only. On top of which the rows are matched by a free-text
   * name query with no profile confirmation, i.e. they may be namesakes', and
   * a full page marks them a sample so any count off them is a floor. The
   * count is surfaced in the refusal text instead, so an operator can see the
   * search DID reach Scholar and it was resolution that failed, not reach.
   */
  hitCount: number;
  /** The page came back full, so `hitCount` is a floor rather than a count. */
  hitsAreSample: boolean;
}

/**
 * Find the person's Scholar profile id from their English name.
 *
 * One 75-credit search, parsed once for both the profile cluster and the
 * article rows, handed to the pure four-case decision in
 * `@kku/shared/src/scholar/resolve`. Everything expensive is here and
 * everything arguable is there.
 *
 * Two branches spend more, and both are gated:
 *
 *   - The `as_vis`-off PROBE fires only when the first page came back FULL,
 *     because a short page means Scholar returned everything it had. It fires
 *     AT MOST ONCE: the second pass asks the identical question of the
 *     identical URL, so a second probe request is downgraded to "use what we
 *     have" rather than spending another 75 to be told the same thing.
 *   - DISAMBIGUATION fetches at most `SCHOLAR_DISAMBIGUATION_CAP` (3) profile
 *     pages at 15 each, on candidates we already suspect are not ours. Past
 *     three the honest answer is "we could not tell".
 *
 * A candidate profile that comes back with no header — a consent wall, or a
 * profile that is private or gone — contributes no name and is skipped rather
 * than judged, since "cannot read" is not "does not match".
 */
async function searchForScholarProfile(
  queryName: string,
  fetchPage: ScholarPageFetcher,
  progress: ScholarFetchProgress,
): Promise<ScholarSearchOutcome> {
  const pages: string[] = [];

  const readSearchPage = async (asVis: boolean) => {
    const searchUrl = buildScholarSearchUrl(queryName, { asVis });
    const result = await fetchPage(searchUrl);
    pages.push(result.html);
    addCredits(progress, result.creditsUsed);
    return { searchUrl, page: parseScholarSearchPage(result.html) };
  };

  let { searchUrl, page } = await readSearchPage(true);
  let decision = resolveScholarProfile({
    queryName,
    profileCards: page.profileCards,
    searchHits: page.hits,
    searchPageWasFull: page.pageWasFull,
  });

  if (decision.kind === 'probe-without-as-vis') {
    ({ searchUrl, page } = await readSearchPage(false));
    decision = resolveScholarProfile({
      queryName,
      profileCards: page.profileCards,
      searchHits: page.hits,
      searchPageWasFull: page.pageWasFull,
    });
    if (decision.kind === 'probe-without-as-vis') {
      // Already probed. Asking again would fetch the same URL for another 75
      // credits and reach the same conclusion.
      decision = {
        kind: 'use-articles',
        searchHits: page.hits,
        searchHitsAreSample: page.pageWasFull,
      };
    }
  }

  if (decision.kind === 'disambiguate') {
    const candidateIds = decision.candidateIds.slice(0, SCHOLAR_DISAMBIGUATION_CAP);
    const candidates: ScholarCandidateProfile[] = [];
    for (const authorId of candidateIds) {
      const result = await fetchPage(buildScholarProfilePageUrl(authorId, 0));
      pages.push(result.html);
      addCredits(progress, result.creditsUsed);
      const identity = parseScholarProfileIdentity(result.html);
      if (!identity.displayName) continue;
      candidates.push({
        authorId,
        primaryName: identity.displayName,
        otherNames: identity.otherNames,
      });
    }
    const picked = resolveScholarDisambiguation({ queryName, candidates });
    // Several cards is direct evidence of namesakes on that page, so its
    // article rows are a mixture either way — nothing to report as a sample.
    const noHits = { pages, hitCount: 0, hitsAreSample: false };
    if (picked.kind === 'use-profile') {
      return {
        resolution: {
          authorId: picked.authorId,
          via: picked.via,
          matchedName: picked.matchedName,
          searchUrl,
          candidateIds: [...candidateIds],
        },
        ...noHits,
      };
    }
    return { resolution: null, ...noHits };
  }

  const carried = {
    pages,
    hitCount: decision.searchHits.length,
    hitsAreSample: decision.searchHitsAreSample,
  };
  if (decision.kind === 'use-profile') {
    return {
      resolution: {
        authorId: decision.authorId,
        via: decision.via,
        matchedName: decision.matchedName,
        searchUrl,
      },
      ...carried,
    };
  }
  return { resolution: null, ...carried };
}

// ── The bind-attempt ledger ───────────────────────────────────────────────
//
// A name search is a BIND ATTEMPT, not a fetch, and it is metered as one.
//
// It spends before it can succeed — 75 credits buy an answer that may be "no
// profile exists" — which is the exact shape `decideScholarBindQuota` was
// written for, and its own header rules on: attempts that produce nothing are
// precisely the ones that must be counted, because "spend, get nothing,
// repeat" is the abuse loop. A pasted URL is the same assertion at 15
// credits; a name search is the same assertion at 75.
//
// It is deliberately NOT metered against the 30-day fetch allowance. Counting
// a resolve-nothing search as PARTIAL would burn the month, and the user's
// very next action is to paste their URL and sync — so it would lock them out
// for thirty days for the crime of not being findable on Google. That moves
// the harm the FAILED exemption exists to prevent rather than removing it.

/**
 * The cap, per person per rolling day.
 *
 * COSTED FOR 15-CREDIT ATTEMPTS, NOT 75. When this cap was set, an attempt
 * was a pasted URL verified by one profile page: five of them was 75 credits
 * per user per day. An auto-resolve attempt is a 75-credit search, so the
 * same cap now permits 375 credits per user per day — a five-fold rise in
 * worst-case per-user spend, with the cap itself unchanged. Left at 5
 * deliberately for now; the unit that wants re-thinking is the console's,
 * which shows an ATTEMPT COUNT. A count stopped being the meaningful number
 * the moment attempts stopped costing the same amount — CREDITS AT RISK is
 * what an operator now needs to see. Flagged for Task 6.
 */
function scholarBindMaxPerDay(): number {
  const parsed = Number(process.env.SCHOLAR_BIND_MAX_PER_DAY);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_SCHOLAR_BIND_MAX_PER_DAY;
  return Math.floor(parsed);
}

interface RecordBindAttemptInput {
  userId: string;
  facultyMemberId: string;
  url: string;
  scholarProfileId: string | null;
  outcome: 'BOUND' | 'REFUSED' | 'FAILED';
  profileName: string | null;
  creditsUsed: number;
  errorText: string | null;
}

/**
 * Write one bind-attempt row. NEVER throws.
 *
 * Same posture as `finaliseRun`, for the same reason: this is bookkeeping
 * about money that has already been spent. On the failure path an exception
 * here would replace the real error with a database error; on the success
 * path it would turn a committed merge into a 500.
 *
 * `url` holds the SEARCH url on this path, where the column's own comment
 * says "the URL a human pasted". That is the intended widening: the question
 * the column answers is "what was actually tried", and for a machine-resolved
 * binding the answer is a query, not a paste. The `outcome` plus a null
 * `scholarProfileId` still read the same way for the cap.
 */
async function recordScholarBindAttempt(input: RecordBindAttemptInput): Promise<void> {
  try {
    await prisma.scholarBindAttempt.create({ data: input });
  } catch (err) {
    console.error(
      `[scholar-fetch] could not record bind attempt for user=${input.userId}:`,
      describeError(err),
    );
  }
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
  /**
   * Stamped when the profile id was resolved DURING the run rather than read
   * off the staff record at the start. Without it, the run that performed a
   * first-time import would read as having had no profile — which is exactly
   * the run someone goes looking for when a wrong import surfaces.
   */
  scholarProfileId?: string;
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

/** Separates one page from the next inside an archived payload. */
const ARCHIVE_PAGE_BREAK = '\n<!-- kku:scholar-page-break -->\n';

/**
 * Archive every raw page this run fetched, search pages first.
 *
 * Written even when the run resolved nothing: a 75-credit search that found
 * no profile is precisely the page someone will want to read, and losing it
 * means re-spending to see what Google actually said. It is also what makes
 * `payloadJson.resolution.fetchRunId` on the audit record worth carrying —
 * the decision is re-readable against the page, not merely re-describable.
 *
 * `parserVersion` stamps the PROFILE parser, which is what reads the pages
 * this run imported from. The search pages in the same payload were read by
 * `SCHOLAR_SEARCH_PARSER_VERSION`, which is recorded on the audit row instead
 * — one column cannot honestly name two parsers, and the importing one is the
 * one a re-parse would replay.
 */
async function archiveScholarPayload(
  runId: string,
  searchPages: readonly string[],
  profilePages: readonly string[],
): Promise<void> {
  const rawPayload = [...searchPages, ...profilePages].join(ARCHIVE_PAGE_BREAK);
  await prisma.scholarFetchArchive.create({
    data: {
      fetchRunId: runId,
      rawPayload,
      contentHash: createHash('sha256').update(rawPayload).digest('hex'),
      parserVersion: SCHOLAR_PARSER_VERSION,
    },
  });
}

/**
 * `user_publications_cache.fetched_at` written by the expiry below: the epoch,
 * meaning "this row was invalidated on purpose", as distinct from a row that
 * merely aged past its 24h window.
 *
 * Exported because the READER has to tell those two apart.
 * `loadPublicationsWithCache` in apps/web/src/lib/profile-data.ts is
 * stale-while-revalidate: an aged row is served immediately and refreshed in
 * the background, which is right for a row that is a day old and wrong for one
 * a user just invalidated by pressing sync — that path showed the OLD list
 * after a successful fetch and rebuilt in the background, so the new papers
 * only appeared on the page load after the one that was supposed to show them.
 * That is the defect this constant closes: the reader blocks on a recompute
 * for this value and only this value.
 */
export const PUBLICATIONS_CACHE_INVALIDATED_MS = 0;

/**
 * Mark the user's publications cache stale so the next profile-page load
 * recomputes it against the rows this fetch just added.
 *
 * Expiry, not removal — this module never removes a row from any table (see
 * the header). The reader recognises THIS value specifically and blocks on a
 * rebuild rather than serving the row it found, so the result of a sync is on
 * the very next page load. See `PUBLICATIONS_CACHE_INVALIDATED_MS` above.
 *
 * Never throws: a cache that failed to expire is a stale page, not a lost
 * fetch, and the ResearchOutput writes are already committed by this point.
 */
async function expireUserPublicationsCache(userId: string): Promise<void> {
  try {
    await prisma.userPublicationsCache.updateMany({
      where: { userId },
      data: { fetchedAt: new Date(PUBLICATIONS_CACHE_INVALIDATED_MS) },
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
  /**
   * Raw HTML of the search pages, when this run searched. Kept apart from the
   * profile pages because `pages[0]` must stay page 1 of the PROFILE — the
   * identity and name checks below read it — while the archive gets both, so
   * the page that decided a binding can be re-read months later.
   */
  let searchPages: string[] = [];
  /**
   * Set only on the search path, and cleared once the attempt has been
   * recorded. Non-null in the catch block means: money was spent deciding a
   * binding, and the attempt never reached a verdict — record it as FAILED so
   * the cap sees the spend.
   */
  let pendingBindAttempt: { url: string; scholarProfileId: string | null } | null = null;
  /** Credits spent DECIDING the binding, as opposed to importing papers. */
  let bindDecisionCredits = 0;

  try {
    // ── 4. Binding ────────────────────────────────────────────────────────
    let profileId = member.scholarProfileId?.trim() ?? '';
    let resolution: ScholarNameResolution | null = null;

    if (!profileId) {
      // ── 4a. The search is a bind attempt, so the bind cap gates it ──────
      // Read BEFORE spending. A refusal here costs nothing and writes no
      // attempt row — a ledger entry for an attempt that never happened would
      // make tomorrow's allowance smaller than the cap says it is.
      const bindAttempts = await prisma.scholarBindAttempt.findMany({
        where: scholarBindQuotaWhere(userId, now),
        select: { createdAt: true },
      });
      const bindQuota = decideScholarBindQuota({
        actorRole,
        attempts: bindAttempts,
        now,
        maxPerDay: scholarBindMaxPerDay(),
      });
      if (!bindQuota.allowed) {
        const reason =
          bindQuota.reason ??
          'Too many attempts to link a Scholar profile for this person today.';
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
          retryAt: bindQuota.retryAt ?? null,
          searchQuery,
        };
      }

      // ── 4b. Search Google Scholar for the name and resolve an id ────────
      const searched = await searchForScholarProfile(searchQuery, fetchPage, progress);
      searchPages = searched.pages;
      bindDecisionCredits = Math.round(progress.creditsUsed);
      pendingBindAttempt = {
        url: searched.resolution?.searchUrl ?? buildScholarSearchUrl(searchQuery, { asVis: true }),
        scholarProfileId: searched.resolution?.authorId ?? null,
      };

      if (!searched.resolution) {
        // A complete, correct answer that happens to be "no profile we are
        // willing to attach". Not a transport failure — so it is REFUSED
        // rather than FAILED, and the machine code is the one the UI already
        // branches on to offer the paste override.
        //
        // The 30-day fetch allowance is untouched (the quota unit ignores
        // REFUSED), which is the point: the user's next move is to paste
        // their URL, and locking them out for a month would punish them for a
        // fact about Google's index. The 75 credits are metered instead
        // against the daily BIND cap, via the attempt row written below.
        //
        // The article-row count rides in the message so an operator can tell
        // "Scholar was unreachable" from "Scholar answered, and none of what
        // it returned was safe to attach".
        const found =
          searched.hitCount === 0
            ? 'The search returned no article results either.'
            : `The search returned ${searched.hitCount} article result${searched.hitCount === 1 ? '' : 's'}` +
              `${searched.hitsAreSample ? ' (a full page, so more exist)' : ''}, ` +
              'but none of them identified a profile we could safely attach — they may belong to a namesake.';
        const reason =
          `Searched Google Scholar for "${searchQuery}" and found no profile that could be linked to this staff record. ` +
          `${found} Paste the profile URL to link it directly, then fetch.`;

        await archiveScholarPayload(run.id, searchPages, []);
        await recordScholarBindAttempt({
          userId,
          facultyMemberId: member.id,
          url: pendingBindAttempt.url,
          scholarProfileId: null,
          outcome: 'REFUSED',
          profileName: null,
          creditsUsed: bindDecisionCredits,
          errorText: reason,
        });
        pendingBindAttempt = null;

        await finaliseRun(run.id, {
          status: 'REFUSED',
          errorText: `${SCHOLAR_NEEDS_BINDING}: ${reason}`,
          creditsUsed: Math.round(progress.creditsUsed),
          finishedAt: clock(),
        });
        return {
          ...emptyCounts(),
          status: 'REFUSED',
          runId: run.id,
          reason: SCHOLAR_NEEDS_BINDING,
          creditsUsed: Math.round(progress.creditsUsed),
          searchQuery,
        };
      }

      resolution = searched.resolution;
      profileId = resolution.authorId;
    }

    // ── 5. Fetch every page, archive the raw payload, parse ───────────────
    const { pages, papers, truncated, unreadableRows, wallAtCstart } = await fetchAllPages(
      profileId,
      fetchPage,
      parsePage,
      progress,
    );

    await archiveScholarPayload(run.id, searchPages, pages);

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
    //
    // `scholarNameMatchesAny`, not `personNamesMatch`: one side of this
    // comparison is a third party's free-text author name, which abbreviates
    // given names as house style and inverts around a comma. See the Scholar
    // section of `name-match.ts` for why that is a different question from
    // resolving a `User` to a `FacultyMember`, which still uses the other rule.
    const profileNames = [identity.displayName, ...identity.otherNames];
    if (!profileNames.some((candidate) => scholarNameMatchesAny(candidate, [searchQuery]))) {
      throw new Error(
        `The linked Scholar profile is named "${profileNames.join('", "')}", but this staff record says "${searchQuery}". ` +
          'Refusing to import. Either the wrong profile is linked, or the staff record has been renamed since it was linked ' +
          '(an HR backfill correcting the English name will do this) — check which, then re-link the profile.',
      );
    }

    // ── 5b. Record a machine-resolved binding ────────────────────────────
    // Deliberately HERE: after the wall check, the header check and the name
    // re-verification above, and BEFORE the merge below.
    //
    // After, because a binding must only ever be recorded from a page that
    // came back as a real Scholar profile whose name matches this staff
    // record — the search page alone is not evidence enough, and every check
    // that could refuse has now run against the very page we are about to
    // import from. Before, because `bindScholarProfile` is what refuses a
    // profile already linked to ANOTHER staff record, and that refusal has to
    // land before a single ResearchOutput row is written; a profile shared by
    // two people is always a mistake and importing first would attach one
    // person's publications to both.
    //
    // `pageHtml` is `pages[0]`, which is exactly the page `bindScholarProfile`
    // would otherwise fetch for itself. Passing it saves a second 15-credit
    // fetch of the same URL on every first-time sync, and it also removes the
    // possibility of the two disagreeing: they now verify the same bytes.
    if (resolution) {
      await bindScholarProfile({
        facultyMemberId: member.id,
        url: buildScholarProfileUrl(profileId),
        boundById: triggeredById,
        // Never called — `pageHtml` is supplied — but the parameter is
        // required, and a fetcher that throws is a louder failure than one
        // that quietly spends 15 credits if that ever stops being true.
        fetchPage: async () => {
          throw new Error('bindScholarProfile must not fetch when pageHtml is supplied');
        },
        pageHtml: pages[0] ?? '',
        now: clock(),
        resolution: {
          version: SCHOLAR_RESOLUTION_VERSION,
          parserVersion: SCHOLAR_SEARCH_PARSER_VERSION,
          searchedName: searchQuery,
          searchUrl: resolution.searchUrl,
          via: resolution.via,
          matchedName: resolution.matchedName,
          candidateIds: resolution.candidateIds ?? [],
          fetchRunId: run.id,
        },
      });
      await recordScholarBindAttempt({
        userId,
        facultyMemberId: member.id,
        url: resolution.searchUrl,
        scholarProfileId: profileId,
        outcome: 'BOUND',
        profileName: identity.displayName,
        creditsUsed: bindDecisionCredits,
        errorText: null,
      });
      pendingBindAttempt = null;
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
      // Only on the search path: the row was opened with whatever the staff
      // record held, which on that path was nothing.
      ...(resolution ? { scholarProfileId: profileId } : {}),
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
    if (pendingBindAttempt) {
      // This run searched, spent, and never reached a verdict on the binding
      // — the profile fetch threw, the profile turned out to be linked to
      // someone else, or the page was a wall. NO BINDING WAS RECORDED, which
      // is the right outcome, but the money is gone and the daily cap has to
      // see it or the loop is free to repeat.
      await recordScholarBindAttempt({
        userId,
        facultyMemberId: member.id,
        url: pendingBindAttempt.url,
        scholarProfileId: pendingBindAttempt.scholarProfileId,
        outcome: 'FAILED',
        profileName: null,
        creditsUsed: bindDecisionCredits,
        errorText,
      });
    }
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

/**
 * Provenance for a binding that a MACHINE resolved rather than a human
 * asserted. Present only on the auto path, and its presence is what switches
 * the audit action verb to `auto-bind` / `auto-rebind`.
 *
 * Every field answers a question asked after a wrong import surfaces:
 * `searchedName` and `searchUrl` say what was asked; `via` and `matchedName`
 * say which card, anchor or profile name won and how; `version` and
 * `parserVersion` say under which rules, so a later rule change is
 * distinguishable from a bad reading of the same rules; and `fetchRunId`
 * points at the `ScholarFetchArchive` row holding the actual page, which is
 * what makes the decision RE-READABLE rather than merely re-describable.
 */
export type ScholarAutoBindProvenance = {
  /** `SCHOLAR_RESOLUTION_VERSION` — the ruleset that decided. */
  version: string;
  /** `SCHOLAR_SEARCH_PARSER_VERSION` — what read the search page. */
  parserVersion: string;
  /** The name put into `?q=`. */
  searchedName: string;
  /** The search URL, including whether `as_vis` was set. */
  searchUrl: string;
  /** How the id was reached. See `ScholarBindingVia`. */
  via: ScholarBindingVia;
  /** The card, anchor or profile name that won. */
  matchedName: string;
  /** Ids fetched to disambiguate. Empty on every other path.
   *  Always present, and an ARRAY rather than an optional or a null, because
   *  this object is written straight into `payloadJson`: Prisma's
   *  `InputJsonValue` rejects `undefined`-valued properties, and `null` needs
   *  a sentinel. An empty array says "no disambiguation happened" just as
   *  clearly and survives the round trip. */
  candidateIds: string[];
  /** The run whose archive holds the page this was decided from. */
  fetchRunId: string;
};

export interface BindScholarProfileInput {
  facultyMemberId: string;
  /** The profile URL a human pasted. The profile id is derived from it. */
  url: string;
  boundById: string;
  /** Same injected ScrapingBee wrapper the runner takes — see the header. */
  fetchPage: ScholarPageFetcher;
  /**
   * Page 1 of the profile, when the caller already holds it.
   *
   * Supplied by the runner on the auto-bind path, where it has just fetched
   * that exact page: without it, verification would fetch the same URL a
   * second time and bill another 15 credits on every first-time sync. It also
   * removes any possibility of the runner's own header and name checks and
   * this function's verification disagreeing — they read the same bytes.
   */
  pageHtml?: string;
  /** Set when a machine resolved this binding. See the type. */
  resolution?: ScholarAutoBindProvenance;
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
 * The verification is the point, and it is the SAME verification on both
 * paths into this function — a human pasting a URL, and the runner recording
 * an id its name search resolved. The page checked is page 1 of the
 * publication list (supplied by the runner, fetched here for a paste), so the
 * check costs no extra request, and a mismatch refuses the bind rather than
 * silently attaching a stranger's papers to a Council-facing research record.
 *
 * Scholar's AUTHOR search (`view_op=search_authors`) really is behind a
 * mandatory Google sign-in wall — verified across proxies, render_js settings
 * and countries, with the real response committed as a fixture. What changed
 * on 2026-09-09 is that the ARTICLE search (`/scholar?q=`) is not, and it
 * carries profile ids; that is what the runner's search branch resolves
 * against. Do not read the walled-endpoint finding as covering both.
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

  // A caller that already holds page 1 hands it over rather than paying for
  // it twice — see `pageHtml`. Credits are then zero because THIS call
  // fetched nothing; the fetch that produced the page is already in the
  // caller's own ledger, and adding it here would double-count it.
  const pageOne =
    typeof input.pageHtml === 'string'
      ? { html: input.pageHtml, creditsUsed: 0 }
      : await input.fetchPage(buildScholarProfilePageUrl(scholarProfileId, 0));
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
  const verified = profileNames.some((candidate) =>
    scholarNameMatchesAny(candidate, expectedNames),
  );
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

  // A MACHINE-RESOLVED BINDING IS NOT A HUMAN ASSERTION, and the distinction
  // lives in `action` — the column an auditor filters on — not only in the
  // payload. Burying it in `payloadJson` would mean the obvious query, "who
  // bound this person's profile and when", returns a row that reads exactly
  // like someone pasting their own URL. A distinct verb makes "show me every
  // binding a machine chose" a `WHERE action LIKE 'scholar.profile.auto-%'`,
  // which is the query actually run the day a wrong import surfaces.
  //
  // `boundById` stays the triggering actor: a human did press the button.
  // The verb is what stops that reading as "this person asserted the identity".
  const rebind = Boolean(member.scholarProfileId);
  const action = input.resolution
    ? rebind
      ? 'scholar.profile.auto-rebind'
      : 'scholar.profile.auto-bind'
    : rebind
      ? 'scholar.profile.rebind'
      : 'scholar.profile.bind';

  await prisma.auditLog.create({
    data: {
      userId: boundById,
      action,
      entityType: 'FacultyMember',
      entityId: facultyMemberId,
      payloadJson: {
        scholarProfileId,
        scholarProfileUrl: url,
        verifiedAgainst: expectedNames,
        profileNames,
        previousScholarProfileId: member.scholarProfileId,
        previousScholarProfileUrl: member.scholarProfileUrl,
        ...(input.resolution ? { resolution: input.resolution } : {}),
      },
    },
  });

  return { scholarProfileId, profileName: identity.displayName, creditsUsed };
}
