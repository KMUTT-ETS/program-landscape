// Client-safe profile types + pure helpers. Split out from
// `profile-data.ts` so the client component (`profile-view.tsx`) can
// import the type definitions + `formatApa` without dragging the
// Prisma + @kku/db barrel — the latter pulls `node:crypto`, which
// webpack can't bundle for the browser.

export type FacultyRankCode =
  | 'PROF'
  | 'ASSOC_PROF'
  | 'ASST_PROF'
  | 'LECTURER';

export interface ProfileBasicInfo {
  fullNameTh: string;
  fullNameEn: string;
  rankLabelTh: string;
  rankLabelEn: string;
  facultyNameTh: string | null;
  facultyNameEn: string | null;
  departmentNameTh: string | null;
  departmentNameEn: string | null;
  email: string;
  orcid: string | null;
  scopusAuthorId: string | null;
  openalexAuthorId: string | null;
  /** URL to the user's uploaded profile photo (served via the
   *  `/api/profile/avatar/[userId]` route). Null when the user
   *  has not uploaded one yet — the hero falls back to initials. */
  avatarUrl: string | null;
}

export interface EducationEntry {
  /** Curriculum / degree-level title — Thai or English as it appears
   *  in the source row (DS2003.GRAD_CURR or the parsed
   *  FacultyMember.academicQualification fallback). */
  qualification: string;
  /** Source row level — e.g. "ปริญญาเอก", "Doctor of Philosophy". */
  level: string | null;
  /** Major / program — DS2003.GRAD_PROG. */
  major: string | null;
  /** Awarding institution — DS2003.GRAD_UNIV. */
  institute: string | null;
  /** ISO 3166-1 alpha-2 country code from DS2003. */
  countryCode: string | null;
  /** Graduation year as it appears in source. BE format from DS2003;
   *  null when unknown. */
  year: number | null;
  /** Indicates the source. 'unicon-ds2003' rows are authoritative;
   *  'fallback' rows come from the legacy
   *  FacultyMember.academicQualification parser. */
  source: 'unicon-ds2003' | 'fallback';
}

export interface ResearchSummary {
  totalPapers: number;
  totalCitations: number;
  peakYear: number | null;
  peakYearCount: number;
  topVenues: Array<{ venue: string; count: number }>;
  earliestYear: number | null;
  latestYear: number | null;
  yearsActive: number | null;
}

export interface CurriculumProgram {
  programId: string;
  code: string;
  nameTh: string;
  nameEn: string;
  level: string;
  facultyNameTh: string;
  facultyNameEn: string;
  role: 'COORDINATOR' | 'CORE' | 'SUPPORT';
}

export interface AuthorName {
  /** Family name — surname / lastname. */
  family: string;
  /** Given name — full given name when present, otherwise initials. */
  given: string | null;
  /** Initials only (when given_name was not stored). */
  initials: string | null;
}

export interface PublicationEntry {
  id: string;
  year: number;
  title: string;
  venue: string | null;
  citations: number;
  doi: string | null;
  scopusId: string | null;
  pmid: string | null;
  openalexId: string | null;
  type: string;
  /** Backwards-compat — KKU co-authors recorded against the local
   *  ResearchOutput row. The full author list (including non-KKU
   *  collaborators) lives on `authors`. */
  kkuAuthors: string[];
  /** Full ordered author list. Resolved from kkuscholar (Scopus +
   *  PubMed); empty when kkuscholar didn't carry the paper. */
  authors: AuthorName[];
  /** True iff `authors` came from the kkuscholar mirror — affects
   *  the APA caveat shown in the UI. */
  authorsAreComplete: boolean;
}

export interface CachedExpertiseNarrative {
  narrativeTh: string;
  narrativeEn: string;
  expertiseKeywordsTh: string[];
  expertiseKeywordsEn: string[];
  confidence: number;
  /** ISO timestamp — used to show "updated 2 days ago" hints. */
  generatedAt: string;
  methodVersion: string;
}

export interface ProfileData {
  hasFacultyMemberRecord: boolean;
  basic: ProfileBasicInfo;
  education: EducationEntry[];
  research: ResearchSummary;
  curriculum: CurriculumProgram[];
  publications: PublicationEntry[];
  /** Pre-computed AI expertise summary, when one has been generated.
   *  Null when never generated — the client component auto-fires the
   *  generation request on first mount in that case. */
  cachedNarrative: CachedExpertiseNarrative | null;
}

/**
 * Format one author per APA 7: "Lastname, F. M." — given names are
 * collapsed to initials with periods. When only initials are stored,
 * they're already in the right shape and reused as-is.
 *
 *   ("Soodphakdee", "Denpong", null)         → "Soodphakdee, D."
 *   ("Soodphakdee", "Denpong John", null)    → "Soodphakdee, D. J."
 *   ("Smith", null, "J.K.")                  → "Smith, J. K."
 *   ("Smith", null, null)                    → "Smith"  (graceful)
 */
export function formatAuthorApa(a: AuthorName): string {
  const family = (a.family ?? '').trim();
  if (a.given && a.given.trim()) {
    const initials = a.given
      .trim()
      .split(/[\s.\-]+/)
      .filter(Boolean)
      .map((part) => {
        // Hyphenated given names: "Jean-Pierre" → "J.-P." per APA 7.
        if (part.includes('-')) {
          return part
            .split('-')
            .map((sub) => (sub[0] ? sub[0].toUpperCase() + '.' : ''))
            .join('-');
        }
        return part[0] ? part[0].toUpperCase() + '.' : '';
      })
      .join(' ');
    return family ? `${family}, ${initials}` : initials;
  }
  if (a.initials && a.initials.trim()) {
    // Insert periods + spaces if missing: "JK" → "J. K.", "J.K." → "J. K."
    const cleaned = a.initials.replace(/[.\s]+/g, '').toUpperCase();
    const spaced = cleaned.split('').map((c) => `${c}.`).join(' ');
    return family ? `${family}, ${spaced}` : spaced;
  }
  return family;
}

/**
 * APA 7 citation string with full author list.
 *
 *   1 author:    "Smith, J. K. (2024). Title. *Venue*. https://doi.org/..."
 *   2 authors:   "Smith, J. K., & Lee, A. (2024). ..."
 *   3-20 authors:"A, B., B, C., & C, D. (2024). ..."
 *   21+ authors: first 19 + ", ..., " + last (per APA 7 §9.8)
 */
export function formatApa(p: PublicationEntry): string {
  const authors = p.authors.length > 0 ? p.authors : kkuAuthorsAsAuthorNames(p);
  const authorBlock = formatApaAuthorList(authors);
  const venue = p.venue ? ` *${p.venue}*.` : '';
  const link = p.doi ? ` https://doi.org/${p.doi}` : '';
  const trailingDot = /[.!?]$/.test(p.title) ? '' : '.';
  const head = authorBlock ? `${authorBlock} ` : '';
  return `${head}(${p.year}). ${p.title}${trailingDot}${venue}${link}`.trim();
}

/** Convert legacy `kkuAuthors` (display strings) to the AuthorName
 *  shape so the formatter has a single code path. */
function kkuAuthorsAsAuthorNames(p: PublicationEntry): AuthorName[] {
  return p.kkuAuthors.map((display) => {
    // Heuristic: assume "Surname, F. M." or "Family Given" — try comma split first.
    if (display.includes(',')) {
      const [family, given] = display.split(',', 2).map((s) => s.trim());
      return { family: family ?? display, given: given || null, initials: null };
    }
    const tokens = display.trim().split(/\s+/).filter(Boolean);
    if (tokens.length >= 2) {
      const family = tokens[tokens.length - 1]!;
      const given = tokens.slice(0, -1).join(' ');
      return { family, given, initials: null };
    }
    return { family: display, given: null, initials: null };
  });
}

function formatApaAuthorList(authors: AuthorName[]): string {
  if (authors.length === 0) return '';
  const formatted = authors.map(formatAuthorApa).filter(Boolean);
  if (formatted.length === 0) return '';
  // APA's serial period: each author block ends with a "." iff the
  // last token is an initial. `withTrailingDot()` collapses any
  // duplicate periods (e.g. "Smith, D." + "." → "Smith, D." not "..").
  if (formatted.length === 1) return withTrailingDot(formatted[0]!);
  if (formatted.length === 2) {
    return withTrailingDot(`${formatted[0]}, & ${formatted[1]}`);
  }
  if (formatted.length > 20) {
    // APA 7 §9.8 — list first 19 authors, an ellipsis, then the final author.
    const first19 = formatted.slice(0, 19).join(', ');
    const last = formatted[formatted.length - 1]!;
    return withTrailingDot(`${first19}, ... ${last}`);
  }
  const head = formatted.slice(0, -1).join(', ');
  const tail = formatted[formatted.length - 1]!;
  return withTrailingDot(`${head}, & ${tail}`);
}

function withTrailingDot(s: string): string {
  return s.endsWith('.') ? s : s + '.';
}
