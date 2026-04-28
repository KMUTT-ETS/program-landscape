// ─────────────────────────────────────────────────────────────────────────────
// Pure transforms for the kku-research connector. Side-effect-free; tests
// run without a live network.
// ─────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';
import type { ResearchOutputType } from '@kku/db';

// ── OpenAlex Work schema ──────────────────────────────────────────────────

export const OpenAlexAuthorshipSchema = z.object({
  author: z
    .object({
      id: z.string().nullish(),
      display_name: z.string().nullish(),
      orcid: z.string().nullish(),
    })
    .nullish(),
  institutions: z
    .array(
      z.object({
        id: z.string().nullish(),
        display_name: z.string().nullish(),
      }),
    )
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
      source: z
        .object({
          display_name: z.string().nullish(),
          type: z.string().nullish(),
        })
        .nullish(),
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

// ── Type mapping (OpenAlex → our enum) ─────────────────────────────────────
//
// Our ResearchOutputType has 4 values: JOURNAL / CONFERENCE / PATENT /
// BOOK. OpenAlex has ~25 type values; collapse to our enum and keep the
// raw type in run metadata for analysts who care.

export function openAlexTypeToOurs(type: string | null | undefined): ResearchOutputType {
  if (!type) return 'JOURNAL';
  // OpenAlex shipped a controlled vocabulary in 2024; values may
  // appear as bare strings (`article`, `book-chapter`) or as URLs
  // (`https://openalex.org/types/article`). Normalise both.
  const tail = type.includes('/') ? type.split('/').pop() ?? type : type;
  switch (tail) {
    case 'article':
    case 'review':
    case 'letter':
    case 'editorial':
    case 'erratum':
    case 'preprint':
      return 'JOURNAL';
    case 'conference-paper':
    case 'proceedings-article':
      return 'CONFERENCE';
    case 'book':
    case 'book-chapter':
    case 'reference-entry':
    case 'monograph':
      return 'BOOK';
    default:
      // Patents are rare in OpenAlex. Datasets / supplementary
      // materials / grants land in JOURNAL bucket — analyst triages
      // via run metadata if needed.
      return 'JOURNAL';
  }
}

// ── ID extractors ──────────────────────────────────────────────────────────
//
// OpenAlex IDs come as full URLs; we store the bare identifier for
// compactness. e.g. `https://openalex.org/W4231015464` → `W4231015464`.

export function tailOf(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  const idx = trimmed.lastIndexOf('/');
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

export function normaliseDoi(doi: string | null | undefined): string | null {
  if (!doi) return null;
  const trimmed = doi.trim();
  if (!trimmed) return null;
  // OpenAlex returns DOIs as full URLs (`https://doi.org/10.…`); our
  // schema field carries the bare DOI.
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('https://doi.org/')) return trimmed.slice('https://doi.org/'.length);
  if (lower.startsWith('http://doi.org/')) return trimmed.slice('http://doi.org/'.length);
  if (lower.startsWith('doi:')) return trimmed.slice(4);
  return trimmed;
}

export function normaliseOrcid(orcid: string | null | undefined): string | null {
  if (!orcid) return null;
  const trimmed = orcid.trim();
  if (!trimmed) return null;
  // OpenAlex returns ORCIDs as full URLs. Our column stores the bare
  // 19-char identifier (e.g. `0000-0001-2345-6789`).
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('https://orcid.org/')) return trimmed.slice('https://orcid.org/'.length);
  if (lower.startsWith('http://orcid.org/')) return trimmed.slice('http://orcid.org/'.length);
  return trimmed;
}

// ── Author resolution helpers ──────────────────────────────────────────────
//
// Returns an authorship object filtered to KKU-affiliated authors only.
// Multi-institution papers commonly list 30+ authors; we only care about
// the 1-3 KKU authors per paper.

export function kkuAffiliatedAuthors(
  work: OpenAlexWork,
  kkuInstitutionId: string,
): Array<{
  authorId: string | null;
  displayName: string | null;
  orcid: string | null;
}> {
  const out: Array<{ authorId: string | null; displayName: string | null; orcid: string | null }> = [];
  for (const a of work.authorships ?? []) {
    const isKku = (a.institutions ?? []).some(
      (inst) => tailOf(inst.id) === kkuInstitutionId,
    );
    if (!isKku) continue;
    out.push({
      authorId: tailOf(a.author?.id),
      displayName: a.author?.display_name?.trim() || null,
      orcid: normaliseOrcid(a.author?.orcid),
    });
  }
  return out;
}

// ── Faculty-member matching ────────────────────────────────────────────────
//
// Two-step lookup, using indexed columns on FacultyMember:
//   1. ORCID exact match
//   2. openalexAuthorId exact match (if previously stamped)
//   3. nameEn exact match (case-insensitive)
//   4. nameTh exact match
// No fuzzy / Levenshtein — common Thai given names ("Somchai", "Suriya")
// would mis-attribute. Exact match only; everything else queues for
// human triage.

export interface FacultyMemberLookup {
  byOrcid: Map<string, string>; // orcid → facultyMemberId
  byOpenalexAuthorId: Map<string, string>; // openalexAuthorId → facultyMemberId
  byNameEn: Map<string, string>; // lowercase nameEn → facultyMemberId
  byNameTh: Map<string, string>; // nameTh → facultyMemberId
}

export function buildFacultyMemberLookup(
  rows: Array<{
    id: string;
    orcid: string | null;
    openalexAuthorId: string | null;
    nameEn: string;
    nameTh: string;
  }>,
): FacultyMemberLookup {
  const byOrcid = new Map<string, string>();
  const byOpenalexAuthorId = new Map<string, string>();
  const byNameEn = new Map<string, string>();
  const byNameTh = new Map<string, string>();
  for (const r of rows) {
    if (r.orcid) byOrcid.set(r.orcid, r.id);
    if (r.openalexAuthorId) byOpenalexAuthorId.set(r.openalexAuthorId, r.id);
    const en = r.nameEn?.trim().toLowerCase();
    if (en) byNameEn.set(en, r.id);
    const th = r.nameTh?.trim();
    if (th) byNameTh.set(th, r.id);
  }
  return { byOrcid, byOpenalexAuthorId, byNameEn, byNameTh };
}

export function resolveFacultyMember(
  author: { authorId: string | null; displayName: string | null; orcid: string | null },
  lookup: FacultyMemberLookup,
): {
  facultyMemberId: string | null;
  matchedBy: 'orcid' | 'openalex_author_id' | 'name_en' | 'name_th' | 'unmatched';
} {
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
    if (en) return { facultyMemberId: en, matchedBy: 'name_en' };
    const th = lookup.byNameTh.get(author.displayName);
    if (th) return { facultyMemberId: th, matchedBy: 'name_th' };
  }
  return { facultyMemberId: null, matchedBy: 'unmatched' };
}
