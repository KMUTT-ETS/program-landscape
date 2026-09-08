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

const DISPLAY_NAME_RE = /<div[^>]*\bid="gsc_prf_in"[^>]*>([\s\S]*?)<\/div>/;
const OTHER_NAMES_TXT_RE = /<[a-z]+[^>]*\bid="gs_prf_ion_txt"[^>]*>([\s\S]*?)<\/[a-z]+>/i;
const OTHER_NAMES_ROW_RE = /<div[^>]*\bid="gsc_prf_ion"[^>]*>([\s\S]*?)<\/div>/i;
/** The grey "Other names" caption, stripped so it is not read as a name. */
const OTHER_NAMES_LABEL_RE = /<[a-z]+[^>]*\bid="gsc_prf_ion_lbl"[^>]*>[\s\S]*?<\/[a-z]+>/i;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  nbsp: ' ',
};

function decodeHtmlEntities(input: string): string {
  return input.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, entity: string) => {
    if (entity[0] === '#') {
      const isHex = entity[1] === 'x' || entity[1] === 'X';
      const code = parseInt(isHex ? entity.slice(2) : entity.slice(1), isHex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[entity] ?? whole;
  });
}

function cleanText(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

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
  const displayNameText = nameMatch ? cleanText(nameMatch[1]!) : '';
  const displayName = displayNameText.length > 0 ? displayNameText : null;

  const otherRaw =
    OTHER_NAMES_TXT_RE.exec(html)?.[1] ??
    OTHER_NAMES_ROW_RE.exec(html)?.[1]?.replace(OTHER_NAMES_LABEL_RE, '') ??
    '';
  const otherNames = cleanText(otherRaw)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return { displayName, otherNames };
}
