// Google Scholar's per-paper "view_citation" page carries the complete author
// list, unlike the profile list page, which shortens long lists with "...".
// A /citations path classifies as a 15-credit profile-kind request
// (costs.ts), so no stealth proxy is used.
//
// Markup confirmed against a live capture on 2026-10-01
// (test/fixtures/scholar/citation-detail-hinton.html): each bibliographic
// field is a `gsc_oci_field` label div immediately followed by its
// `gsc_oci_value` div. We match on the LABEL ("Authors", or "Inventors" for a
// patent), never on position — the field order varies by publication type.
import { htmlToText } from './html-text';
import { splitScholarAuthorLine, type ScholarAuthorLine } from './author-names';

const AUTHORS_FIELD_RE =
  /<div class="gsc_oci_field">\s*(?:Authors|Inventors)\s*<\/div>\s*<div class="gsc_oci_value">([\s\S]*?)<\/div>/;

/**
 * The author list on a detail page, or null when the page has no Authors field.
 *
 * Normally complete. Split with the list-page splitter so a detail page that
 * itself ends in "..."/"…" has the ellipsis stripped and reads incomplete
 * rather than storing "..." as an author name.
 */
export function parseScholarCitationAuthors(html: string): ScholarAuthorLine | null {
  const raw = AUTHORS_FIELD_RE.exec(html)?.[1];
  if (!raw) return null;
  return splitScholarAuthorLine(htmlToText(raw));
}

/** The detail-page URL for one paper on one profile. */
export function buildScholarCitationUrl(profileId: string, scholarPaperId: string): string {
  const url = new URL('https://scholar.google.com/citations');
  url.searchParams.set('view_op', 'view_citation');
  url.searchParams.set('hl', 'en');
  url.searchParams.set('user', profileId);
  url.searchParams.set('citation_for_view', scholarPaperId);
  return url.toString();
}
