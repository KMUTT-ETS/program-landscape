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

export function parseScholarAuthorName(name: string): AuthorName {
  const tokens = name.trim().split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) return { family: tokens[0] ?? '', given: null, initials: null };
  const first = tokens[0]!;
  if (INITIALS_TOKEN_RE.test(first)) {
    const letters = first.replace(/\./g, '').split('');
    return { family: tokens.slice(1).join(' '), given: null, initials: letters.map((l) => `${l}.`).join('') };
  }
  return { family: tokens.slice(1).join(' '), given: first, initials: null };
}
