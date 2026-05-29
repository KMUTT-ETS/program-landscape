// ─────────────────────────────────────────────────────────────────────────────
// kku-research transforms — pure functions, used by both the connector and
// the per-source unit tests.
//
// Source: kku-publications mirror (PostgreSQL @ 10.130.2.151). The mirror
// is curator-grade — KKU author resolution is already done via
// `<source>_authors.person_id → people.id`. Our connector just maps each
// already-resolved authorship to a ResearchOutput row.
//
// We DO NOT do name-matching; that's the kku-publications upstream's job.
// We DO match its `people.id` to our `FacultyMember.id` once per run via
// nameEn + nameTh exact match, so cross-system FKs land cleanly.
// ─────────────────────────────────────────────────────────────────────────────

import type { ResearchOutputType } from '@kku/db';

// ─────────────────────────────────────────────────────────────────────
// Row shapes from kkuscholar (only fields we read; trimmed for clarity)
// ─────────────────────────────────────────────────────────────────────

export interface KkuPubScopusRow {
  // From scopus_documents
  document_id: string;
  eid: string;
  title: string | null;
  publication_name: string | null;
  cover_date: Date | null;
  cited_by_count: number | null;
  doi: string | null;
  aggregation_type: string | null;
  // From scopus_citescores via LATERAL — best quartile for the
  // journal in the nearest metric year ≤ cover year. Null when the
  // journal carries no CiteScore record.
  quartile: number | null;
  cite_score_percentile: number | null;
  sjr: number | null;
  // From scopus_author_documents
  scopus_author_id: string | null;
  person_id: number | null;
  author_seq: number | null;
  // From people (joined)
  person_firstname_en: string | null;
  person_lastname_en: string | null;
  person_firstname: string | null;
  person_lastname: string | null;
  person_faculty_id: number | null;
}

export interface KkuPubPubMedRow {
  // From pubmed_documents
  pubmed_document_id: number;
  pmid: string;
  title: string | null;
  journal_title: string | null;
  year: number;
  doi: string | null;
  // From pubmed_authors
  person_id: number | null;
  author_seq: number | null;
  person_firstname_en: string | null;
  person_lastname_en: string | null;
  person_firstname: string | null;
  person_lastname: string | null;
  person_faculty_id: number | null;
}

// ─────────────────────────────────────────────────────────────────────
// Faculty-member lookup (built once at fetch start, used in transform).
// ─────────────────────────────────────────────────────────────────────

export interface FacultyMemberLookup {
  byNameEn: Map<string, string>; // lowercased "first last" → FacultyMember.id
  byNameTh: Map<string, string>; // exact "first last" → FacultyMember.id
}

export interface FacultyMemberSnapshot {
  id: string;
  nameEn: string;
  nameTh: string;
}

export function buildFacultyMemberLookup(
  members: readonly FacultyMemberSnapshot[],
): FacultyMemberLookup {
  const byNameEn = new Map<string, string>();
  const byNameTh = new Map<string, string>();
  for (const m of members) {
    const en = m.nameEn.trim().toLowerCase();
    if (en && !byNameEn.has(en)) byNameEn.set(en, m.id);
    const th = m.nameTh.trim();
    if (th && !byNameTh.has(th)) byNameTh.set(th, m.id);
  }
  return { byNameEn, byNameTh };
}

// ─────────────────────────────────────────────────────────────────────
// Author resolution
// ─────────────────────────────────────────────────────────────────────

export type ResolutionMatch = 'name_en' | 'name_th' | 'unmatched';

export interface AuthorResolution {
  facultyMemberId: string | null;
  matchedBy: ResolutionMatch;
  authorDisplayName: string | null;
}

export function resolveAuthor(
  parts: {
    firstname_en: string | null;
    lastname_en: string | null;
    firstname: string | null;
    lastname: string | null;
  },
  lookup: FacultyMemberLookup,
): AuthorResolution {
  const fnEn = (parts.firstname_en ?? '').trim();
  const lnEn = (parts.lastname_en ?? '').trim();
  const fnTh = (parts.firstname ?? '').trim();
  const lnTh = (parts.lastname ?? '').trim();

  const displayEn = (fnEn && lnEn) ? `${fnEn} ${lnEn}` : null;
  const displayTh = (fnTh && lnTh) ? `${fnTh} ${lnTh}` : null;
  const display = displayEn ?? displayTh;

  if (displayEn) {
    const id = lookup.byNameEn.get(displayEn.toLowerCase());
    if (id) return { facultyMemberId: id, matchedBy: 'name_en', authorDisplayName: display };
  }
  if (displayTh) {
    const id = lookup.byNameTh.get(displayTh);
    if (id) return { facultyMemberId: id, matchedBy: 'name_th', authorDisplayName: display };
  }
  return { facultyMemberId: null, matchedBy: 'unmatched', authorDisplayName: display };
}

// ─────────────────────────────────────────────────────────────────────
// Type mapping — source aggregation type → ResearchOutputType
// ─────────────────────────────────────────────────────────────────────

// Scopus uses ~6 aggregation_type values; we collapse to our 4-value enum
// (JOURNAL / CONFERENCE / PATENT / BOOK). When in doubt, fall back to
// JOURNAL — it's the modal type and the safest "indexed publication"
// catch-all for analyst review.
export function scopusAggregationToOurs(
  aggregationType: string | null,
): ResearchOutputType {
  const t = (aggregationType ?? '').toLowerCase();
  if (t.includes('conference')) return 'CONFERENCE';
  if (t.includes('book')) return 'BOOK';
  // 'journal', 'trade journal', 'report', 'series' → JOURNAL fallback.
  return 'JOURNAL';
}

// PubMed papers are journal-published by definition. publication_type can
// further distinguish (Review, Letter, Editorial) but those are sub-types
// of journal publications and ResearchOutputType doesn't model them.
export function pubmedPublicationTypeToOurs(
  _publicationType: string | null,
): ResearchOutputType {
  return 'JOURNAL';
}

// ─────────────────────────────────────────────────────────────────────
// DOI normalisation — same posture as the OpenAlex pathway. Strip the
// https://doi.org/ prefix and lowercase. Empty → null.
// ─────────────────────────────────────────────────────────────────────

export function normaliseDoi(doi: string | null | undefined): string | null {
  if (!doi) return null;
  const trimmed = doi.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────
// Year extraction — Scopus papers carry cover_date (DATE); we want the
// year only. Returns null when the date is missing — caller skips.
// ─────────────────────────────────────────────────────────────────────

export function yearOf(date: Date | null): number | null {
  if (!date) return null;
  const y = date.getUTCFullYear();
  // Sanity: KKU hasn't existed pre-1964; anything before 1900 is corrupt.
  if (y < 1900 || y > 2100) return null;
  return y;
}
