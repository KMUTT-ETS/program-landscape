// Google Scholar author strings.
//
// The profile list page prints a row's authors initials-first, comma-separated
// ("A Krizhevsky, I Sutskever, GE Hinton") and shortens long lists with a
// trailing "..." (observed as ASCII in every real capture; "…" accepted too).
// Thai authors often appear as full names ("เด่นพงษ์ สุดภักดี").
// Pure and browser-safe: no runtime imports.
import type { AuthorName } from '../staff-profile/types';

export interface ScholarAuthorLine {
  names: string[];
  /** False when Scholar shortened the list with a trailing ellipsis. */
  complete: boolean;
}

const TRAILING_ELLIPSIS_RE = /,?\s*(?:\.\.\.|…)\s*$/;

export function splitScholarAuthorLine(line: string): ScholarAuthorLine | null {
  const trimmed = line.trim();
  const complete = !TRAILING_ELLIPSIS_RE.test(trimmed);
  const body = trimmed.replace(TRAILING_ELLIPSIS_RE, '');
  const names = body
    .split(',')
    .map((n) => n.trim())
    .filter((n) => n.length > 0);
  return names.length === 0 ? null : { names, complete };
}

// One to three capital letters, optionally dotted: "G", "GE", "J.K.".
const INITIALS_TOKEN_RE = /^(?:\p{Lu}\.?){1,3}$/u;

// Lowercase surname particles kept with the family name: "van der Maaten".
const FAMILY_PARTICLES = new Set(['van', 'der', 'de', 'da', 'von', 'del', 'di', 'du', 'la', 'le', 'ten', 'ter']);

const THAI_SCRIPT_RE = /\p{Script=Thai}/u;

export function parseScholarAuthorName(name: string): AuthorName {
  const trimmed = name.trim();
  // A Thai name is kept whole and rendered verbatim. Scholar sometimes splits
  // Thai names on combining marks ("ภร ณ์ จิ รา"), so any token split would be
  // a guess — and APA initials mean nothing in Thai anyway.
  if (THAI_SCRIPT_RE.test(trimmed)) return { family: trimmed, given: null, initials: null };
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) return { family: tokens[0] ?? '', given: null, initials: null };
  const first = tokens[0]!;
  if (INITIALS_TOKEN_RE.test(first)) {
    const letters = first.replace(/\./g, '').split('');
    return { family: tokens.slice(1).join(' '), given: null, initials: letters.map((l) => `${l}.`).join('') };
  }
  // Full name: the family is the last token plus any lowercase particles
  // immediately before it; every remaining token is given ("George E Dahl" →
  // given "George E", family "Dahl").
  let familyStart = tokens.length - 1;
  while (familyStart > 1 && FAMILY_PARTICLES.has(tokens[familyStart - 1]!)) familyStart -= 1;
  return {
    family: tokens.slice(familyStart).join(' '),
    given: tokens.slice(0, familyStart).join(' '),
    initials: null,
  };
}
