// packages/shared/src/scholar/name-match.ts
//
// Pure person-name comparison for the Google Scholar feature. Two callers:
//
//   1. Resolving a User to a FacultyMember when the HR `employeeId` bridge
//      comes up empty (Scholar deliberately does not require HR linkage —
//      `employeeCode` marks a current employee, and a retired researcher's
//      publication history is still legitimate data).
//   2. Verifying, at bind time, that the Scholar profile someone pasted
//      actually belongs to the person it is being attached to.
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
 * Single-character tokens (middle initials — `"Geoffrey E Hinton"` vs
 * `"Geoffrey Hinton"`) are ignored, but ONLY while at least two tokens
 * survive on both sides. Without that floor, `"A Smith"` and `"B Smith"`
 * would both reduce to `{smith}` and match — two different people, exactly
 * the failure this module exists to prevent. When either side would drop
 * below two tokens, the full token sets are compared instead.
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
  return substantialA.join(' ') === substantialB.join(' ');
}

/** True when `candidate` matches any of `accepted`. Convenience for the
 *  bind-time check, where a profile offers a display name plus aliases. */
export function personNameMatchesAny(candidate: string, accepted: readonly string[]): boolean {
  return accepted.some((name) => personNamesMatch(candidate, name));
}
