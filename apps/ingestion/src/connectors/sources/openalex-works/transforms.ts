// Pure transforms for the openalex-works connector. No network, no database.

import { z } from 'zod';

// ── OpenAlex works response ────────────────────────────────────────────────

export const OpenAlexAuthorshipSchema = z.object({
  author: z
    .object({
      id: z.string().nullish(),
      display_name: z.string().nullish(),
      orcid: z.string().nullish(),
    })
    .nullish(),
  institutions: z
    .array(z.object({ id: z.string().nullish(), display_name: z.string().nullish() }))
    .nullish(),
});

export const OpenAlexWorkSchema = z.object({
  id: z.string(),
  doi: z.string().nullish(),
  title: z.string().nullish(),
  display_name: z.string().nullish(),
  publication_year: z.number().int().nullish(),
  type: z.string().nullish(),
  cited_by_count: z.number().int().nullish(),
  authorships: z.array(OpenAlexAuthorshipSchema).nullish(),
  primary_location: z
    .object({
      source: z.object({ display_name: z.string().nullish(), type: z.string().nullish() }).nullish(),
    })
    .nullish(),
});
export type OpenAlexWork = z.infer<typeof OpenAlexWorkSchema>;

export const OpenAlexWorksResponseSchema = z.object({
  results: z.array(OpenAlexWorkSchema),
  meta: z.object({
    count: z.number().int().nonnegative(),
    next_cursor: z.string().nullish(),
  }),
});

export type OutputType = 'JOURNAL' | 'CONFERENCE' | 'PATENT' | 'BOOK';

/** OpenAlex has ~25 work types; collapse them onto the four the table holds. */
export function openAlexTypeToOurs(type: string | null | undefined): OutputType {
  if (!type) return 'JOURNAL';
  const tail = type.includes('/') ? (type.split('/').pop() ?? type) : type;
  switch (tail) {
    case 'conference-paper':
    case 'proceedings-article':
      return 'CONFERENCE';
    case 'book':
    case 'book-chapter':
    case 'reference-entry':
    case 'monograph':
      return 'BOOK';
    default:
      return 'JOURNAL';
  }
}

/** `https://openalex.org/W123` → `W123`. */
export function tailOf(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  const idx = trimmed.lastIndexOf('/');
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

/**
 * A bare, lower-case DOI. DOIs are case-insensitive, so lower-casing is what
 * lets a spreadsheet row ("10.1234/ABC") and an OpenAlex row
 * ("https://doi.org/10.1234/abc") recognise each other.
 */
export function normaliseDoi(doi: string | null | undefined): string | null {
  if (!doi) return null;
  let v = doi.trim().toLowerCase();
  v = v.replace(/^https?:\/\/(dx\.)?doi\.org\//, '').replace(/^doi:\s*/, '');
  return v ? v : null;
}

export function normaliseOrcid(orcid: string | null | undefined): string | null {
  if (!orcid) return null;
  const v = orcid.trim().replace(/^https?:\/\/orcid\.org\//i, '');
  return v ? v : null;
}

export interface InstitutionAuthor {
  authorId: string | null;
  displayName: string | null;
  orcid: string | null;
}

/** The authorships of a work that list the given institution. */
export function institutionAuthors(work: OpenAlexWork, institutionId: string): InstitutionAuthor[] {
  const out: InstitutionAuthor[] = [];
  for (const a of work.authorships ?? []) {
    if (!(a.institutions ?? []).some((inst) => tailOf(inst.id) === institutionId)) continue;
    out.push({
      authorId: tailOf(a.author?.id),
      displayName: a.author?.display_name?.trim() || null,
      orcid: normaliseOrcid(a.author?.orcid),
    });
  }
  return out;
}

// ── Staff matching: exact only ─────────────────────────────────────────────
//
// ORCID → OpenAlex author id → English name (lower-cased) → Thai name. A name
// held by more than one staff member is recorded as AMBIGUOUS and never
// matches: attributing a paper to the wrong person is worse than leaving it
// for triage.

const AMBIGUOUS = Symbol('ambiguous');
type Slot = string | typeof AMBIGUOUS;

export interface StaffLookup {
  byOrcid: Map<string, string>;
  byOpenalexAuthorId: Map<string, string>;
  byNameEn: Map<string, Slot>;
  byNameTh: Map<string, Slot>;
}

export interface StaffRow {
  id: string;
  orcid: string | null;
  openalexAuthorId: string | null;
  nameEn: string;
  nameTh: string;
}

function put(map: Map<string, Slot>, key: string, id: string): void {
  const held = map.get(key);
  map.set(key, held === undefined || held === id ? id : AMBIGUOUS);
}

export function buildStaffLookup(rows: readonly StaffRow[]): StaffLookup {
  const lookup: StaffLookup = {
    byOrcid: new Map(),
    byOpenalexAuthorId: new Map(),
    byNameEn: new Map(),
    byNameTh: new Map(),
  };
  for (const r of rows) {
    if (r.orcid) lookup.byOrcid.set(r.orcid, r.id);
    if (r.openalexAuthorId) lookup.byOpenalexAuthorId.set(r.openalexAuthorId, r.id);
    const en = r.nameEn?.trim().toLowerCase();
    if (en) put(lookup.byNameEn, en, r.id);
    const th = r.nameTh?.trim();
    if (th) put(lookup.byNameTh, th, r.id);
  }
  return lookup;
}

export type MatchedBy = 'orcid' | 'openalex_author_id' | 'name_en' | 'name_th' | 'ambiguous' | 'unmatched';

export function resolveStaff(
  author: InstitutionAuthor,
  lookup: StaffLookup,
): { facultyMemberId: string | null; matchedBy: MatchedBy } {
  if (author.orcid) {
    const id = lookup.byOrcid.get(author.orcid);
    if (id) return { facultyMemberId: id, matchedBy: 'orcid' };
  }
  if (author.authorId) {
    const id = lookup.byOpenalexAuthorId.get(author.authorId);
    if (id) return { facultyMemberId: id, matchedBy: 'openalex_author_id' };
  }
  if (author.displayName) {
    const en = lookup.byNameEn.get(author.displayName.toLowerCase());
    if (en === AMBIGUOUS) return { facultyMemberId: null, matchedBy: 'ambiguous' };
    if (en) return { facultyMemberId: en, matchedBy: 'name_en' };
    const th = lookup.byNameTh.get(author.displayName);
    if (th === AMBIGUOUS) return { facultyMemberId: null, matchedBy: 'ambiguous' };
    if (th) return { facultyMemberId: th, matchedBy: 'name_th' };
  }
  return { facultyMemberId: null, matchedBy: 'unmatched' };
}
