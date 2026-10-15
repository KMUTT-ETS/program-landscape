/**
 * Heading slugs as GitHub renders them, so the in-page and cross-page anchors written for the
 * repository (e.g. the adopter guide's table of contents) also work on the site. VitePress's own
 * slugify prefixes digit-leading slugs with `_` and keeps punctuation such as `—`.
 *
 * Same rule as github-slugger: lowercase, drop everything that is not a letter, mark, number,
 * connector punctuation, space or hyphen, then turn each space into a hyphen. Duplicate slugs are
 * numbered by markdown-it-anchor, as GitHub does.
 */
export function githubSlugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-');
}
