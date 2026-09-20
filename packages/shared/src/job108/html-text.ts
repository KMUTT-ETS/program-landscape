import { decodeHtmlEntities } from '../scholar/html-text';

const DROP_ELEMENTS = /<(script|style|noscript)[\s\S]*?<\/\1>/gi;

/** `<!DOCTYPE ...>` and `<!-- ... -->` don't start with a tag-name letter, so
 *  the letter-anchored `TAG` pattern below never matches them and they would
 *  otherwise survive verbatim at the top of every page (confirmed against a
 *  real fetched page — `<!DOCTYPE html>` was leaking straight into the
 *  output). Dropped here, before tag stripping, rather than folded into
 *  `TAG`'s alternation, so that regex can stay anchored on a real tag name. */
const DROP_DOCTYPE_AND_COMMENTS = /<!(?:DOCTYPE[^>]*|--[\s\S]*?--)>/gi;

/** A page whose `<script>` is never closed — a truncated fetch, an injected
 *  ad, a template bug — otherwise leaks its body into the text, because the
 *  paired pattern simply fails to match and the generic tag strip then removes
 *  only the opening tag. */
const DROP_UNCLOSED = /<(script|style|noscript)\b[\s\S]*$/i;

/** Inline tags carry emphasis INSIDE a word or phrase — the real pages bold
 *  agency names and degree fragments — so replacing them with a space splits
 *  Thai compounds that have no space of their own: `วุฒิ<b>ปริญญา</b>ตรี`
 *  would read as three tokens instead of "วุฒิปริญญาตรี". Everything else
 *  SEPARATES values, and the real markup runs block tags together with no
 *  whitespace (36 such pairs per sampled page), so those become a newline. */
const INLINE_TAGS = /^(b|i|u|em|strong|span|a|font|small|sup|sub)$/i;

const TAG = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;

/** Inline tags close up to nothing; every other tag becomes a newline so
 *  block-level content that the source runs together (no whitespace between
 *  `</p>` and the next `<p>`) does not get fused into one run-on word. */
function stripTags(html: string): string {
  return html.replace(TAG, (whole, tagName: string) => (INLINE_TAGS.test(tagName) ? '' : '\n'));
}

/**
 * A whole announcement page reduced to plain text for the extractor.
 *
 * Distinct from `scholar/html-text.ts`'s `htmlToText`, which is for a
 * FRAGMENT: that one collapses every whitespace run to a single space and
 * leaves script and style bodies in place, both of which are wrong for a
 * page being handed to a language model. The names are different so picking
 * the wrong one is a compile error rather than a quiet degradation.
 *
 * Deliberately crude: the pages are prose inside a conventional template and
 * the model reads the text, not the markup. Entity decoding is delegated to
 * `scholar/html-text.ts`'s `decodeHtmlEntities`, which scans the original
 * string in one pass — running several `String#replaceAll` calls in sequence
 * would decode `&amp;lt;` into a real `<` instead of the literal text `&lt;`,
 * because the first pass's output becomes the second pass's input.
 */
export function announcementPageToText(html: string): string {
  const withoutScripts = html
    .replace(DROP_ELEMENTS, ' ')
    .replace(DROP_UNCLOSED, ' ')
    .replace(DROP_DOCTYPE_AND_COMMENTS, ' ');
  const withoutTags = stripTags(withoutScripts);
  const decoded = decodeHtmlEntities(withoutTags);
  return decoded
    .replace(/[ \t ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}
