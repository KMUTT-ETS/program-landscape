// packages/shared/src/scholar/html-text.ts
//
// The one place that turns a fragment of Google Scholar's HTML into text.
//
// This used to exist twice — verbatim in `parse.ts` and again in
// `profile-identity.ts` — and the two copies had already drifted: one
// replaced tags with nothing, the other with a space, so
// `<div>A<br>B</div>` read as `"AB"` in one module and `"A B"` in the
// other. Both behaviours are wanted; neither was chosen on purpose. They
// are now one function with an explicit argument, so picking the wrong one
// is a visible decision rather than an accident of which file you are in.

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  nbsp: ' ',
};

/** Decodes the small set of entities Scholar actually emits, plus numeric entities generally. */
export function decodeHtmlEntities(input: string): string {
  return input.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, entity: string) => {
    if (entity[0] === '#') {
      const isHex = entity[1] === 'x' || entity[1] === 'X';
      const code = parseInt(isHex ? entity.slice(2) : entity.slice(1), isHex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[entity] ?? whole;
  });
}

/**
 * Strip markup, decode entities, collapse whitespace, trim.
 *
 * `tagSeparator` is the whole decision:
 *
 *   `''`  — the tags are inline emphasis INSIDE one value. A title rendered
 *           as `<b>Nano</b>technology` is the single word "Nanotechnology",
 *           and inserting a space there would corrupt it. This is what
 *           publication titles and venues want, and it is the default.
 *
 *   `' '` — the tags SEPARATE values. A profile's alias row can put each
 *           name in its own element; joining them tightly would fuse two
 *           people's names into one string. This is what the profile
 *           identity block wants.
 */
export function htmlToText(html: string, tagSeparator: '' | ' ' = ''): string {
  return decodeHtmlEntities(html.replace(/<[^>]*>/g, tagSeparator))
    .replace(/\s+/g, ' ')
    .trim();
}
