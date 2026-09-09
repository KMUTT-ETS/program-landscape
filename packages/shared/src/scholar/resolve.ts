// packages/shared/src/scholar/resolve.ts
//
// The decision that sits between the search-page parsers and the runner:
// given what one 75-credit search page said, WHICH Scholar profile — if any —
// belongs to the person we searched for.
//
// PURE. No network, no Prisma, no clock, no environment. Everything this
// needs has already been parsed by `./search-parse`; everything it decides is
// carried out by the caller (`packages/db/src/scholar-fetch.ts`, Task 5).
// That separation is the point: the expensive, hard-to-detect error in this
// feature is attaching one person's publications to another's
// `FacultyMember` record, those rows roll up into Council-facing research
// metrics, and a decision that can be exercised exhaustively in a unit test
// is the only kind worth trusting with it.
//
// THE STANDING COST FUNCTION, which every branch below is written to obey:
// **a visible false refusal beats an invisible false match.** A refusal is a
// non-result the user fixes in seconds by pasting their profile URL — the
// manual override survives precisely for this. A wrong binding is silent, and
// wrong in a Council paper months later.
//
// ── Placement ─────────────────────────────────────────────────────────────
//
// Deliberately NOT re-exported from `./index.ts` or the `@kku/shared` barrel.
// It takes `./search-parse`'s types, and although the import is TYPE-ONLY
// (erased at compile time, so no bundle ever pulls cheerio through this
// file), keeping it off the barrel keeps the boundary a rule rather than a
// judgement call about which imports happen to be erasable today.
//
// Consumers under Node resolution — `packages/db`, `apps/api`,
// `apps/ingestion` — import it as `@kku/shared/src/scholar/resolve`. The
// short `@kku/shared/scholar/resolve` specifier does NOT typecheck there,
// for the same reason recorded for `search-parse` in package.json: those
// packages resolve through `main` and ignore the `exports` map.

import type { ScholarProfileCard, ScholarSearchHit } from './search-parse';
import { matchesScholarAuthorName } from './name-match';

export const SCHOLAR_RESOLUTION_VERSION = 'scholar-resolution.v1';

/**
 * Profiles we are willing to fetch when the search page hands us several
 * candidate cards and none of their displayed names matched.
 *
 * Three, from the reference implementation. Each one is a 15-credit profile
 * fetch spent on a person we already suspect is not ours; past three, the
 * honest answer is "we could not tell" rather than a deeper search.
 */
export const SCHOLAR_DISAMBIGUATION_CAP = 3;

/**
 * What resolved a profile id. Recorded so a wrong binding is explicable after
 * the fact — the audit trail needs to say which card or anchor won, not just
 * that something did.
 */
export type ScholarResolutionVia =
  /** (b) A single card whose displayed name matches the queried name. */
  | 'primary-card'
  /** (c) A single card whose displayed name does NOT match: Google matched it
   *  through its own "Other names" index, so the queried name is an alias. */
  | 'alias-card'
  /** (d) Several cards, one of which displays a matching name. */
  | 'multi-card-primary'
  /** (a) No card at all, but a per-author byline anchor whose text matches. */
  | 'byline-link';

/**
 * What to do with the search page's article rows.
 *
 * `searchHits` is EMPTY wherever the article rows cannot be trusted to be the
 * subject's — see the alias and multi-card branches. Emptiness is the
 * contract, not an accident of there being no rows: "drop the article
 * results" is enforced by handing back none.
 *
 * `searchHitsAreSample` mirrors `pageWasFull` from the parser. A full page
 * means Scholar truncated, so any count derived from these rows is a FLOOR.
 * It is judged on the RAW row count, before any year filtering — a full page
 * that filters down to three rows is still truncated.
 */
interface WithSearchHits {
  searchHits: readonly ScholarSearchHit[];
  searchHitsAreSample: boolean;
}

export type ScholarResolution =
  /**
   * Bind `authorId` and fetch that profile's own publications. `searchHits`
   * is the degraded fallback if the profile fetch fails — empty where the
   * rows are not safe to attribute.
   */
  | ({
      kind: 'use-profile';
      authorId: string;
      via: ScholarResolutionVia;
      /** The card or anchor text that won, for the audit record. */
      matchedName: string;
    } & WithSearchHits)
  /** No profile id to be had. Use the article rows; record no binding. */
  | ({ kind: 'use-articles' } & WithSearchHits)
  /**
   * Re-query WITHOUT `as_vis=1` and resolve again from that page.
   *
   * Not a retry: `as_vis=1` is what suppressed the profile cluster, so the
   * same parser is being asked a different question and can succeed where
   * this page found nothing. It costs another 75 credits, which is why it is
   * gated — see the branch.
   */
  | ({ kind: 'probe-without-as-vis' } & WithSearchHits)
  /**
   * Several cards, none of them displaying a matching name. Fetch each
   * candidate profile (at most `SCHOLAR_DISAMBIGUATION_CAP`) and hand the
   * primary + Other names back to `resolveScholarDisambiguation`.
   */
  | { kind: 'disambiguate'; candidateIds: readonly string[] };

export interface ScholarResolutionInput {
  /** The English full name we hold for the person, as searched. */
  queryName: string;
  /** Cards from the "User profiles for X" cluster. Usually none. */
  profileCards: readonly ScholarProfileCard[];
  /** Article rows, already year-filtered by the caller if it filters at all. */
  searchHits: readonly ScholarSearchHit[];
  /** `pageWasFull` from the parser — judged on the RAW row count. */
  searchPageWasFull: boolean;
}

/**
 * Byline anchors whose text names the person we searched for.
 *
 * A byline anchor whose text does NOT match is a CO-AUTHOR, and binding one
 * is exactly the mis-attribution this module exists to prevent. Anchor text
 * is Scholar's abbreviated house style (`P Chindaprasirt`), which is what
 * `matchesScholarAuthorName` is built to read.
 *
 * Returns DISTINCT ids: one page repeats the same author across rows, and
 * that repetition is agreement, not ambiguity. Two DIFFERENT ids both
 * matching is real ambiguity — two Scholar profiles on one page answering to
 * the same written name — and the caller below refuses rather than picking.
 */
function matchingBylineAuthorIds(
  queryName: string,
  searchHits: readonly ScholarSearchHit[],
): { authorId: string; name: string }[] {
  const seen = new Set<string>();
  const matches: { authorId: string; name: string }[] = [];
  for (const hit of searchHits) {
    for (const link of hit.authorLinks) {
      if (seen.has(link.authorId)) continue;
      if (!matchesScholarAuthorName(queryName, link.name)) continue;
      seen.add(link.authorId);
      matches.push({ authorId: link.authorId, name: link.name });
    }
  }
  return matches;
}

/**
 * Decide what one search page means.
 *
 * The four cases are the reference implementation's, which has run this in
 * production, plus a fifth the reference parses and never uses:
 *
 *   (a) No card        → byline anchor, else probe (only if the page was
 *                        full), else the article rows.
 *   (b) One card,
 *       name matches   → bind it.
 *   (c) One card,
 *       name differs   → Google matched an Other name, so the queried name
 *                        is an alias: bind the card and DROP the article
 *                        rows, which may be namesakes'.
 *   (d) Several cards  → a displayed-name match wins; otherwise hand back at
 *                        most three ids to disambiguate by fetching.
 *
 * A blank query name resolves nothing: with no name to match against, every
 * comparison below is vacuous and case (c) would bind the first card it saw
 * on no evidence whatsoever.
 */
export function resolveScholarProfile(input: ScholarResolutionInput): ScholarResolution {
  const { profileCards, searchHits, searchPageWasFull } = input;
  const queryName = input.queryName.trim();
  const carry: WithSearchHits = { searchHits, searchHitsAreSample: searchPageWasFull };
  const carryNothing: WithSearchHits = { searchHits: [], searchHitsAreSample: false };

  if (!queryName) return { kind: 'use-articles', ...carry };

  // ── (a) No profile card ────────────────────────────────────────────────
  if (profileCards.length === 0) {
    // The fifth case. Measured 2026-09-09 on `Prinya Chindaprasirt`: the
    // search returned no cluster at all, yet a byline anchor carried
    // `wmV9HqoAAAAJ`, which resolves to the right person in the right
    // faculty. The committed fixture `search-as-vis-chindaprasirt.html` is
    // that page. Checked BEFORE the probe because it is free and the probe
    // is 75 credits per person per run.
    const bylineMatches = matchingBylineAuthorIds(queryName, searchHits);
    const onlyMatch = bylineMatches.length === 1 ? bylineMatches[0] : undefined;
    if (onlyMatch) {
      return {
        kind: 'use-profile',
        authorId: onlyMatch.authorId,
        via: 'byline-link',
        matchedName: onlyMatch.name,
        ...carry,
      };
    }
    // Two or more DIFFERENT ids answering to the same written name is the
    // namesake case in miniature. We have nothing on this page to separate
    // them, so we bind neither and fall through — a probe or a visible
    // non-result, not a coin flip.

    // A SHORT page means Scholar returned everything it had: the article
    // rows are already the whole answer, and probing would spend 75 credits
    // to confirm what is known. Only a full page — i.e. a truncated one —
    // earns the second call.
    if (searchPageWasFull) return { kind: 'probe-without-as-vis', ...carry };
    return { kind: 'use-articles', ...carry };
  }

  // ── (b) / (c) A single card ────────────────────────────────────────────
  if (profileCards.length === 1) {
    const card = profileCards[0];
    // Unreachable given the length check; stated rather than asserted, because
    // `noUncheckedIndexedAccess` is on and a non-null assertion here would be
    // the one place this file stopped being checkable.
    if (!card) return { kind: 'use-articles', ...carry };

    if (matchesScholarAuthorName(queryName, card.name)) {
      // (b) The queried name is this profile's primary form.
      return {
        kind: 'use-profile',
        authorId: card.authorId,
        via: 'primary-card',
        matchedName: card.name,
        ...carry,
      };
    }

    // (c) One card came back and its displayed name is not ours — so GOOGLE
    // matched this query, through an "Other names" index we cannot see, and
    // Google answering is different from Google offering candidates. We trust
    // it here; case (d) below, where the matching is ours, holds itself to a
    // stricter bar. Reference example: `Phet Imtongkhum` → `Phet Aimtongkham`.
    //
    // The article rows are DROPPED. Our query matched an alias, so the rows
    // the same query returned may belong to whoever holds the name as their
    // primary form — namesakes. The profile's own publication list is the
    // authoritative answer and it costs 15 credits.
    return {
      kind: 'use-profile',
      authorId: card.authorId,
      via: 'alias-card',
      matchedName: card.name,
      ...carryNothing,
    };
  }

  // ── (d) Several cards ──────────────────────────────────────────────────
  //
  // UNPROVEN IN THE WILD. Ten live searches on 2026-09-09 — three real KKU
  // researchers, two bare surnames, a bare given name, `John Smith`,
  // `Michael I Jordan` and a Thai-language query — produced a cluster three
  // times and it carried exactly one card every time. This branch is
  // exercised against a DERIVED fixture (a real second card spliced into a
  // real cluster; see test/fixtures/scholar/search-derived-multicard.html),
  // never against a captured multi-card page. Its safe default is a refusal,
  // which is what limits the cost of getting it subtly wrong.
  const primaryMatch = profileCards.find((card) =>
    matchesScholarAuthorName(queryName, card.name),
  );
  if (primaryMatch) {
    // Several cards means several people answer to this name on this page, so
    // the article rows are a mixture and are dropped — the same reasoning as
    // the alias branch. DIVERGENCE from the reference, which keeps them as a
    // fallback here.
    return {
      kind: 'use-profile',
      authorId: primaryMatch.authorId,
      via: 'multi-card-primary',
      matchedName: primaryMatch.name,
      ...carryNothing,
    };
  }
  return {
    kind: 'disambiguate',
    candidateIds: profileCards.slice(0, SCHOLAR_DISAMBIGUATION_CAP).map((card) => card.authorId),
  };
}

// ── Case (d), second half: the Other-names check ───────────────────────────
//
// `resolveScholarProfile` cannot do this itself — it would have to fetch each
// candidate's profile page, and this module does no I/O. The caller fetches
// the (at most three) profiles named by `disambiguate` and brings the names
// back here, so the RULING below stays pure and testable rather than being
// re-implemented inside the runner.

/** A candidate profile, fetched because `disambiguate` named it. */
export interface ScholarCandidateProfile {
  authorId: string;
  /** The name the profile header displays. */
  primaryName: string;
  /** The profile's "Other names" field, free text controlled by its owner. */
  otherNames: readonly string[];
}

export type ScholarDisambiguation =
  | {
      kind: 'use-profile';
      authorId: string;
      via: 'primary-name' | 'other-name';
      /** Which of the candidate's names matched, for the audit record. */
      matchedName: string;
    }
  /**
   * Nothing cleared the bar. Bind NOTHING — and do not fall back to the
   * search page's article rows either: several cards is direct evidence of
   * namesakes on that page, so its rows are a mixture. DIVERGENCE from the
   * reference, which returns the article results here.
   */
  | { kind: 'no-binding' };

/**
 * Pick a candidate, or refuse.
 *
 * THE RULING (design spec, "how much an Other name is allowed to count"):
 *
 * A **primary-name** match wins outright, and all candidates are checked for
 * one before any Other name is consulted — a profile that displays the name
 * is better evidence than one that lists it among aliases.
 *
 * An **Other-name** match counts only if it clears the same bar every other
 * name comparison in this feature clears: `matchesScholarAuthorName`, whose
 * two-token floor drops any arrangement shorter than two tokens and whose
 * surname rule is exact equality. "Other names" is free text its owner
 * controls and it is frequently a mononym (`Chindaprasirt`) or initials
 * (`P.C.`); neither is enough to attach a person's publications to a staff
 * record, and both are refused by that floor without needing a second rule.
 * This is deliberately weaker than the reference, which accepts any Other
 * name its matcher likes.
 *
 * If nothing clears it, **no binding**. A visible non-result the user fixes
 * by pasting a URL beats an invisible wrong binding feeding Council figures.
 */
export function resolveScholarDisambiguation(input: {
  queryName: string;
  candidates: readonly ScholarCandidateProfile[];
}): ScholarDisambiguation {
  const queryName = input.queryName.trim();
  if (!queryName) return { kind: 'no-binding' };
  // Capped again here rather than trusting the caller to have honoured the
  // cap: this function is the one that decides, so it is the one that has to
  // be safe on its own terms.
  const candidates = input.candidates.slice(0, SCHOLAR_DISAMBIGUATION_CAP);

  for (const candidate of candidates) {
    if (matchesScholarAuthorName(queryName, candidate.primaryName)) {
      return {
        kind: 'use-profile',
        authorId: candidate.authorId,
        via: 'primary-name',
        matchedName: candidate.primaryName,
      };
    }
  }
  for (const candidate of candidates) {
    for (const otherName of candidate.otherNames) {
      if (matchesScholarAuthorName(queryName, otherName)) {
        return {
          kind: 'use-profile',
          authorId: candidate.authorId,
          via: 'other-name',
          matchedName: otherName,
        };
      }
    }
  }
  return { kind: 'no-binding' };
}
