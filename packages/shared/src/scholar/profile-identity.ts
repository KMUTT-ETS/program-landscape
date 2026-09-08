// packages/shared/src/scholar/profile-identity.ts
//
// Reads the identity block off a Google Scholar profile page — the name the
// profile displays, plus any "other names" it lists. Used at BIND time to
// verify that the profile a human pasted actually belongs to the person it
// is being attached to.
//
// The page parsed here is the same `citations?user=<id>` page the
// publication list comes from, so verification costs no extra request.
//
// ── What is verified, and what is inferred ────────────────────────────────
//
// VERIFIED against both committed real captures
// (test/fixtures/scholar/profile-hinton.html and -page2.html):
//
//     <div id="gsc_prf_i"><div id="gsc_prf_inw">
//       <div id="gsc_prf_in">Geoffrey Hinton</div>
//     </div>…
//
// NOT verified: the "other names" block. Neither capture emits it — the
// captured profile has no other names, so Scholar renders nothing. Per the
// rule this feature's parser was written under (a parser tested against
// imagined markup is worse than no parser), the extraction below is NOT
// guessed from general knowledge of Scholar's HTML. It is derived from the
// stylesheet that IS in the captures, which styles three real ids:
//
//     #gsc_prf_ion      the row
//     #gsc_prf_ion_lbl  the grey label ("Other names")
//     #gs_prf_ion_txt   the toggled-visible element holding the names
//
// so `gs_prf_ion_txt` is read first and the `gsc_prf_ion` row second. Both
// are strictly ADDITIVE accept paths: aliases can only ever let a bind
// through, never refuse one. If this markup is wrong or absent, the worst
// outcome is that a legitimate alias is not recognised and a human is asked
// to look at a quoted mismatch — never a wrong profile silently bound.
// Replace this with a verified reading the first time a real profile that
// lists other names is captured.

import { htmlToText } from './html-text';

const DISPLAY_NAME_RE = /<div[^>]*\bid="gsc_prf_in"[^>]*>([\s\S]*?)<\/div>/;
const OTHER_NAMES_TXT_RE = /<[a-z]+[^>]*\bid="gs_prf_ion_txt"[^>]*>([\s\S]*?)<\/[a-z]+>/i;
const OTHER_NAMES_ROW_RE = /<div[^>]*\bid="gsc_prf_ion"[^>]*>([\s\S]*?)<\/div>/i;
/** The grey "Other names" caption, stripped so it is not read as a name. */
const OTHER_NAMES_LABEL_RE = /<[a-z]+[^>]*\bid="gsc_prf_ion_lbl"[^>]*>[\s\S]*?<\/[a-z]+>/i;

/** Tags here SEPARATE values — an alias row can put each name in its own
 *  element, and joining those tightly would fuse two people's names. */
const htmlToTextSpaced = (html: string): string => htmlToText(html, ' ');

export interface ScholarProfileIdentity {
  /** The name the profile displays. Null when the page carries no profile
   *  header at all — an error page, a sign-in wall, or a redirect shell. */
  displayName: string | null;
  /** Aliases the profile lists. Empty when absent, which is the common case. */
  otherNames: string[];
}

/**
 * Extract the profile's displayed name and any listed aliases.
 *
 * Never throws. A page with no profile header returns
 * `{ displayName: null, otherNames: [] }`, which the caller must treat as
 * "cannot verify" — not as "verified empty".
 */
export function parseScholarProfileIdentity(html: string): ScholarProfileIdentity {
  if (!html) return { displayName: null, otherNames: [] };

  const nameMatch = DISPLAY_NAME_RE.exec(html);
  const displayNameText = nameMatch ? htmlToTextSpaced(nameMatch[1]!) : '';
  const displayName = displayNameText.length > 0 ? displayNameText : null;

  const otherRaw =
    OTHER_NAMES_TXT_RE.exec(html)?.[1] ??
    OTHER_NAMES_ROW_RE.exec(html)?.[1]?.replace(OTHER_NAMES_LABEL_RE, '') ??
    '';
  const otherNames = htmlToTextSpaced(otherRaw)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return { displayName, otherNames };
}
