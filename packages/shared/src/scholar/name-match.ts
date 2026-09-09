// packages/shared/src/scholar/name-match.ts
//
// Pure person-name comparison for the Google Scholar feature. TWO RULES, for
// two questions that look alike and are not:
//
//   1. `personNamesMatch` — resolving a User to a FacultyMember when the HR
//      `employeeId` bridge comes up empty (Scholar deliberately does not
//      require HR linkage — `employeeCode` marks a current employee, and a
//      retired researcher's publication history is still legitimate data).
//      Both sides are records WE curate.
//   2. `matchesScholarAuthorName` — deciding whether a Scholar author name
//      names the person we hold, at bind time and on every re-verify. One
//      side is a third party's free-text, abbreviated by house style.
//      Defined in the second half of this file, with its own rationale.
//
// Both are identity decisions on Council-facing data: `ResearchOutput`
// rows carry `facultyMemberId` and roll up into per-faculty research
// metrics, so attaching one person's papers to another's record is the
// expensive, hard-to-detect error. The matcher is therefore deliberately
// STRICT — it answers "are these the same written name", not "could these
// plausibly be the same person". Fuzzy distance, nickname tables and
// initial expansion are all absent on purpose: each one trades a false
// refusal (visible, a human fixes it in seconds) for a false match
// (invisible, and wrong in a Council report months later).
//
// `normaliseTitle` in merge.ts is the existing precedent for this kind of
// helper — same NFD-strip-fold approach, different unit of comparison.

/**
 * Case-folded, diacritic-stripped, punctuation-free, whitespace-collapsed
 * form of a name. `"ผศ.ดร. Sômchai  Jai-dee"` → `"ผศ ดร somchai jai dee"`.
 *
 * Combining marks (`\p{M}`) are KEPT, unlike in `normaliseTitle` — Thai
 * vowel signs such as U+0E35 are category Mn, so a `\p{L}\p{N}`-only filter
 * silently turns `ใจดี` into `ใจด` and erases the difference between names
 * that differ only in their vowels. Latin accents are already gone by then:
 * the NFD pass above splits them off and the U+0300–U+036F strip removes
 * them.
 *
 * Note that punctuation becomes a SPACE, not nothing: `"Jai-dee"` is two
 * tokens, and `"S.Jaidee"` is `"s jaidee"` rather than the single token
 * `"sjaidee"`.
 */
export function normalisePersonName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalised tokens, order-insensitive and duplicate-free. */
export function personNameTokens(name: string): string[] {
  const normalised = normalisePersonName(name);
  if (!normalised) return [];
  return [...new Set(normalised.split(' '))].sort();
}

/**
 * Order-insensitive canonical key for a name. Equal keys mean the same
 * written name in some order: `"Jaidee Somchai"` and `"Somchai Jaidee"`
 * share a key, because Thai and Western sources disagree about which half
 * comes first and that disagreement is not evidence of a different person.
 */
export function personNameKey(name: string): string {
  return personNameTokens(name).join(' ');
}

/**
 * True when two names are the same written name.
 *
 * Initials are tolerated as an OMISSION, never as a CONFLICT — and the
 * tolerance is for a MISSING token, not for an abbreviated one. `"Geoffrey
 * Everest Hinton"` and `"Geoffrey E Hinton"` therefore REFUSE, even though
 * they are the same person and this is the commonest real-world variant of
 * all: `everest` and `e` are two different substantial-vs-initial tokens, and
 * treating an initial as standing for any word beginning with that letter is
 * exactly the inference that would let `"Wei L Zhang"` swallow `"Wei Liang
 * Zhang"` and `"Wei Lin Zhang"` alike. That refusal is visible at bind time
 * and a human fixes it by correcting one of the two records. `"Geoffrey E Hinton"` and `"Geoffrey Hinton"` match, because one
 * side simply does not carry the middle initial. `"Geoffrey E Hinton"` and
 * `"Geoffrey R Hinton"` do NOT, because both sides state an initial and the
 * statements disagree — those are two people, and matching them is precisely
 * the failure this module exists to prevent.
 *
 * Mechanically: the substantial (multi-character) tokens must be equal AND
 * one side's single-character token set must be a subset of the other's.
 * `{} ⊆ {e}` keeps the omission case; `{e} ⊄ {r}` refuses the conflict. The
 * two-substantial-token floor stays on top of that, so `"A Smith"` and
 * `"B Smith"` — which would otherwise both reduce to `{smith}` — still
 * refuse, and so do names built entirely from initials.
 *
 * Empty or whitespace-only input never matches anything, including another
 * empty string: "we don't know this person's name" is not an identity.
 */
export function personNamesMatch(a: string, b: string): boolean {
  const tokensA = personNameTokens(a);
  const tokensB = personNameTokens(b);
  if (tokensA.length === 0 || tokensB.length === 0) return false;
  if (tokensA.join(' ') === tokensB.join(' ')) return true;

  const substantialA = tokensA.filter((t) => t.length > 1);
  const substantialB = tokensB.filter((t) => t.length > 1);
  if (substantialA.length < 2 || substantialB.length < 2) return false;
  if (substantialA.join(' ') !== substantialB.join(' ')) return false;

  const initialsA = tokensA.filter((t) => t.length === 1);
  const initialsB = tokensB.filter((t) => t.length === 1);
  const isSubset = (small: string[], large: string[]) => {
    const set = new Set(large);
    return small.every((t) => set.has(t));
  };
  return isSubset(initialsA, initialsB) || isSubset(initialsB, initialsA);
}

/** True when `candidate` matches any of `accepted`. Convenience for the
 *  bind-time check, where a profile offers a display name plus aliases. */
export function personNameMatchesAny(candidate: string, accepted: readonly string[]): boolean {
  return accepted.some((name) => personNamesMatch(candidate, name));
}

// ─────────────────────────────────────────────────────────────────────────
// Scholar author names — a SECOND rule, deliberately not the first one.
//
// `personNamesMatch` above answers "are these the same written name" between
// two records we curate: a `User` and a `FacultyMember`. Both sides are
// internal, neither abbreviates systematically, and the question is answered
// order-insensitively because Thai and Western sources disagree about which
// half of a name comes first.
//
// This rule answers a different question: "is this third party's free-text
// author name the person we searched for". Scholar names ARE abbreviated —
// that is the house style ("P Chindaprasirt") — and they arrive with academic
// titles glued on. So the rule here is positional, tolerates an initial
// against the word it abbreviates, and is anchored on an EXACT surname.
//
// Ported from the mhesi-program-review implementation, which has run this in
// production. Four deliberate divergences, each marked DIVERGENCE below.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Honorifics and post-nominals dropped from both sides before comparison.
 *
 * `ap`, `ma` and `ba` are the sharp edges: `Ma` and `Ba` are real Chinese and
 * Vietnamese surnames, so dropping them can leave a one-token name. The
 * two-token floor in `scholarNameArrangements` is what stops that becoming a
 * false match (see DIVERGENCE 2).
 */
export const SCHOLAR_NAME_NOISE_TOKENS: ReadonlySet<string> = new Set([
  'ap',
  'dr',
  'prof',
  'assoc',
  'asst',
  'associate',
  'assistant',
  'professor',
  'lecturer',
  'ms',
  'mr',
  'mrs',
  'miss',
  'sir',
  'madam',
  'phd',
  'msc',
  'bsc',
  'ma',
  'ba',
]);

/**
 * Multi-character title patterns, stripped BEFORE character-level
 * normalisation.
 *
 * THE ORDERING IS LOAD-BEARING. `normalisePersonName` turns punctuation into
 * spaces, so normalising first splits `A/P` into `["a", "p"]` — two
 * single-character tokens that the positional rule below then reads as
 * INITIALS against the real given name, letting `A/P Lim Wei` match anyone
 * whose given name starts with an `a`. Stripping first, the tokens never
 * exist. `SCHOLAR_NAME_NOISE_TOKENS` cannot do this job: by the time it runs,
 * the damage is already done.
 *
 * Ordered so the longer patterns win: `Asst. Prof. Dr. X` loses `Asst. Prof.`
 * here and its leftover bare `dr` to the noise set.
 */
const SCHOLAR_TITLE_PATTERNS: readonly RegExp[] = [
  /\ba\s*\/\s*p\b/gi,
  /\basst\.?\s*prof\.?/gi,
  /\bassoc\.?\s*prof\.?/gi,
  /\bprof\.?\s*dr\.?/gi,
];

function stripScholarTitles(name: string): string {
  let out = name;
  for (const pattern of SCHOLAR_TITLE_PATTERNS) out = out.replace(pattern, ' ');
  return out;
}

function scholarTokens(name: string): string[] {
  const normalised = normalisePersonName(name);
  if (!normalised) return [];
  return normalised.split(' ').filter((t) => t.length > 0 && !SCHOLAR_NAME_NOISE_TOKENS.has(t));
}

/**
 * The token orderings a written name may legitimately stand for.
 *
 * Always the name as written. Additionally, when the name carries a comma,
 * the halves swapped around it — `"Chindaprasirt, P"` also stands for
 * `"P Chindaprasirt"`. That is not guesswork: a comma in a personal name IS
 * the inversion marker, and Scholar profiles use the inverted form (measured
 * on a real KKU professor, 2026-09-09). Without it the positional rule takes
 * `p` for the surname and refuses a correct binding.
 *
 * DIVERGENCE 2 from the reference: arrangements shorter than two tokens are
 * DROPPED, so a name that reduces to one token never matches anything. The
 * reference refuses only the empty case, which leaves two holes — a Scholar
 * card displaying a bare surname (`"Hinton"`) matches every Hinton, and a
 * name whose second token is in the noise set (`"Yong Ma"` → `["yong"]`)
 * matches `"Yong Ba"`. Both are the mis-attribution error this module exists
 * to prevent. The cost is a false REFUSAL for a genuine `Ma`/`Ba` surname,
 * which is visible and correctable; the alternative is invisible.
 */
function scholarNameArrangements(name: string): string[][] {
  const stripped = stripScholarTitles(name);
  const arrangements = [scholarTokens(stripped)];
  const comma = stripped.indexOf(',');
  if (comma !== -1) {
    arrangements.push(scholarTokens(`${stripped.slice(comma + 1)} ${stripped.slice(0, comma)}`));
  }
  return arrangements.filter((tokens) => tokens.length >= 2);
}

/**
 * Positional comparison of one query ordering against one Scholar ordering.
 *
 * Surname (last token) must be EQUAL — no prefix tolerance there, because the
 * surname is the only token carrying enough information to distinguish two
 * people who share a given name, and `Wei L Zhang` vs `Wei L Zhao` is two
 * people.
 *
 * Every preceding Scholar token must equal its positional counterpart, or be
 * a single-character prefix of it in EITHER direction: `e` abbreviates
 * `everest`, and `everest` is abbreviated by `e`. That is what accepts
 * `Geoffrey E Hinton` ↔ `Geoffrey Everest Hinton` — the commonest real
 * variant — while still refusing `Wei L Zhang` ↔ `Wei Q Zhang`, where both
 * sides state an initial and the statements disagree.
 *
 * Asymmetric on purpose: a Scholar name may carry FEWER given-name tokens
 * than the query (it omits the middle name), but never MORE. An extra token
 * on the Scholar side is information the staff record does not corroborate.
 */
function scholarArrangementMatches(query: readonly string[], scholar: readonly string[]): boolean {
  // `scholarNameArrangements` never hands over an empty arrangement, but two
  // empties would otherwise compare `undefined !== undefined` and fall through
  // to a loop that does not run — i.e. match. Stated rather than assumed.
  if (query.length === 0 || scholar.length === 0) return false;
  if (query[query.length - 1] !== scholar[scholar.length - 1]) return false;
  for (let i = 0; i < scholar.length - 1; i += 1) {
    if (i >= query.length - 1) return false;
    const scholarToken = scholar[i];
    const queryToken = query[i];
    if (scholarToken === undefined || queryToken === undefined) return false;
    if (scholarToken === queryToken) continue;
    if (scholarToken.length === 1 && queryToken.startsWith(scholarToken)) continue;
    if (queryToken.length === 1 && scholarToken.startsWith(queryToken)) continue;
    return false;
  }
  return true;
}

/**
 * True when `scholarName` — a Scholar profile card, profile header or byline
 * anchor — plausibly names the person searched for as `queryFull`.
 *
 * DIVERGENCE 1 from the reference: normalisation is Unicode-aware
 * (`normalisePersonName`) rather than `[^a-zA-Z]`-stripping. ASCII-only
 * stripping reduces any Thai name to the empty string, so `"สมชาย ใจดี"` can
 * never match itself. Unicode-aware normalisation cannot make a match MORE
 * likely between different scripts — it only stops same-script comparison
 * being answered by accident.
 *
 * DIVERGENCE 3: comma-inverted forms, above.
 *
 * DIVERGENCE 4: this does NOT replace `personNamesMatch`. See the note on
 * that function; the two answer different questions, and `substantialNameKey`
 * in `packages/db/src/scholar-fetch.ts` is an exact pre-filter derived from
 * `personNamesMatch`'s internals that this rule would invalidate.
 *
 * Argument order matters — the query is the name we hold, the Scholar name is
 * the one we are judging.
 */
export function matchesScholarAuthorName(queryFull: string, scholarName: string): boolean {
  const queryArrangements = scholarNameArrangements(queryFull);
  const scholarArrangements = scholarNameArrangements(scholarName);
  return queryArrangements.some((query) =>
    scholarArrangements.some((scholar) => scholarArrangementMatches(query, scholar)),
  );
}

/**
 * True when `scholarName` matches any of the names we hold for the person —
 * the staff record's English name plus, where we have them, the account name
 * and known aliases. Empty list never matches.
 */
export function scholarNameMatchesAny(
  scholarName: string,
  queryNames: readonly string[],
): boolean {
  return queryNames.some((query) => matchesScholarAuthorName(query, scholarName));
}
