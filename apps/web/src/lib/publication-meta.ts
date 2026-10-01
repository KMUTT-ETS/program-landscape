// Labels and links for one publication's metadata row on /profile.
// Client-safe: pure functions, type-only imports.
import type { AuthorName } from '@/lib/profile-types';

type Lang = 'th' | 'en';

const TYPE_LABELS: Record<string, { en: string; th: string }> = {
  JOURNAL: { en: 'Journal article', th: 'บทความวารสาร' },
  CONFERENCE: { en: 'Conference paper', th: 'บทความประชุมวิชาการ' },
  BOOK: { en: 'Book', th: 'หนังสือ' },
  PATENT: { en: 'Patent', th: 'สิทธิบัตร' },
};

/** Null when the type is unknown, is really a source name, or the record is a
 *  Google Scholar row (Scholar states no type; the stored JOURNAL is a placeholder). */
export function publicationTypeLabel(type: string, source: string | null, lang: Lang): string | null {
  if (source === 'google-scholar') return null;
  return TYPE_LABELS[type]?.[lang] ?? null;
}

const SOURCE_LABELS: Record<string, string> = {
  'google-scholar': 'Google Scholar',
  scopus: 'Scopus',
  pubmed: 'PubMed',
  isi: 'Web of Science',
  tci: 'TCI',
  openalex: 'OpenAlex',
};

/** Human name of the system a record came from. Strips the `live:` and
 *  `kku-publications:` prefixes; an unknown key is shown as-is. */
export function sourceLabel(source: string | null): string | null {
  if (!source) return null;
  const key = source.replace(/^live:/, '').replace(/^kku-publications:/, '');
  return SOURCE_LABELS[key] ?? key;
}

/** Scopus record page for either a bare id or a full `2-s2.0-` EID. */
export function scopusRecordUrl(scopusId: string): string {
  const eid = scopusId.startsWith('2-s2.0-') ? scopusId : `2-s2.0-${scopusId}`;
  return `https://www.scopus.com/record/display.uri?eid=${eid}&origin=resultslist`;
}

export type AuthorStatus = 'complete' | 'shortened' | 'unavailable';

export function authorStatus(p: { authors: AuthorName[]; authorsAreComplete: boolean; source: string | null }): AuthorStatus {
  if (p.authors.length === 0) return 'unavailable';
  return p.authorsAreComplete ? 'complete' : 'shortened';
}
