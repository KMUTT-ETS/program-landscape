// Direct Scopus pipeline — PROFILE PAGE ONLY. Do not use this from
// program-analysis / gap-analyzer / benchmarking / cockpit code
// paths: those iterate over thousands of KKU researchers and would
// hammer Scopus's rate limit (20k requests/week per institution).
// Bulk paths must continue to read from the kkuscholar mirror at
// 10.130.2.151 — the connector synchronises that nightly.
//
// Replaces kkuscholar as the primary publications source on the
// per-user `/profile` route only — much faster (1-3 s vs 30+ s)
// and broader coverage for most KKU faculty. Returns the same
// `KkuScholarPublication` shape so the existing merge/enrichment
// logic in profile-data.ts is unchanged.
//
// Two functions:
//   - `resolveScopusAuthorId(...)` — Scopus author search by name
//     + KKU affiliation, picks the best candidate by works count.
//     Cached on the FacultyMember row so we only resolve once.
//   - `fetchPublicationsByScopusAuthor(authorId)` — paginated
//     `query=AU-ID(...)` search with `field=author` for full
//     per-paper author breakdown.
//
// All calls server-side, with bounded timeouts. Failures degrade to
// empty arrays so the rest of the pipeline (kkuscholar fallback,
// external DOI lookups) can still pick up the slack.

import type {
  AuthorPosition,
  KkuScholarPublication,
} from './kku-publications';

const SCOPUS_SEARCH = 'https://api.elsevier.com/content/search/scopus';
const SCOPUS_AUTHOR_SEARCH = 'https://api.elsevier.com/content/search/author';
const TIMEOUT_MS = 15_000;

export interface ScopusAuthorResolution {
  authorId: string;
  worksCount: number;
}

/**
 * Find a Scopus author ID for a KKU staffer by name + affiliation.
 * Returns null when the API key is missing or no candidate is
 * confidently the right person.
 *
 * Disambiguation: there are typically multiple Scopus author IDs
 * sharing a name (Scopus's own author-merging is imperfect). We
 * pick the candidate with the most works AND a KKU-affiliation hit
 * so we don't accidentally bind to a homonymous researcher abroad.
 */
export async function resolveScopusAuthorId(input: {
  surnameEn: string;
  givenEn: string;
  affiliation?: string;
}): Promise<ScopusAuthorResolution | null> {
  const key = process.env.KKU_SCOPUS_API_KEY;
  if (!key || !input.surnameEn || !input.givenEn) return null;

  const affiliation = input.affiliation ?? 'Khon Kaen University';
  // Scopus author-search query DSL: AUTHLAST + AUTHFIRST + AFFIL.
  // Quotation handles spaces in affiliation strings.
  const query = `AUTHLAST(${input.surnameEn}) AND AUTHFIRST(${input.givenEn}) AND AFFIL("${affiliation}")`;
  const params = new URLSearchParams({
    query,
    count: '5',
    httpAccept: 'application/json',
  });
  const url = `${SCOPUS_AUTHOR_SEARCH}?${params.toString()}`;

  try {
    const res = await fetchWithTimeout(url, {
      headers: { 'X-ELS-APIKey': key, Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as ScopusAuthorSearchResponse;
    const entries = data['search-results']?.entry ?? [];
    const candidates: ScopusAuthorResolution[] = [];
    for (const e of entries) {
      const id = e['dc:identifier']?.replace('AUTHOR_ID:', '');
      const docCount = Number(e['document-count'] ?? '0');
      if (id && Number.isFinite(docCount)) {
        candidates.push({ authorId: id, worksCount: docCount });
      }
    }
    if (candidates.length === 0) return null;
    // Highest works count wins — proxy for "most active KKU author
    // matching this name". Tie-break is irrelevant; either works.
    candidates.sort((a, b) => b.worksCount - a.worksCount);
    return candidates[0]!;
  } catch (err) {
    console.warn(
      `[scopus-publications] author-id resolution failed for ${input.givenEn} ${input.surnameEn}:`,
      (err as Error).message,
    );
    return null;
  }
}

/**
 * Pull every paper for a Scopus author ID with full per-paper
 * author lists. Single API path — Scopus search with `field=author`
 * already returns the structured author breakdown, so no second
 * abstract-retrieval call is needed.
 *
 * Paginates 25 at a time; typical KKU faculty has < 200 papers so
 * 8 round trips is the upper bound.
 */
export async function fetchPublicationsByScopusAuthor(
  authorId: string,
): Promise<KkuScholarPublication[]> {
  const key = process.env.KKU_SCOPUS_API_KEY;
  if (!key) return [];

  const out: KkuScholarPublication[] = [];
  let start = 0;
  const count = 25;
  // Hard cap as a safety belt against runaway pagination loops.
  const MAX_PAGES = 20;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params = new URLSearchParams({
      query: `AU-ID(${authorId})`,
      count: String(count),
      start: String(start),
      httpAccept: 'application/json',
      // `author` carries the per-paper author list; the rest are
      // standard Scopus search fields we map into our shape.
      field:
        'dc:identifier,prism:doi,prism:coverDate,dc:title,prism:publicationName,citedby-count,pubmed-id,author',
    });
    const url = `${SCOPUS_SEARCH}?${params.toString()}`;

    let res: Response;
    try {
      res = await fetchWithTimeout(url, {
        headers: { 'X-ELS-APIKey': key, Accept: 'application/json' },
      });
    } catch (err) {
      console.warn(
        `[scopus-publications] search failed for AU-ID(${authorId}):`,
        (err as Error).message,
      );
      break;
    }
    if (!res.ok) break;

    const data = (await res.json()) as ScopusSearchResponse;
    const entries = data['search-results']?.entry ?? [];
    if (entries.length === 0) break;

    for (const e of entries) {
      const scopusId = e['dc:identifier']?.replace('SCOPUS_ID:', '') ?? null;
      const year = e['prism:coverDate']
        ? Number(e['prism:coverDate'].slice(0, 4))
        : null;
      if (!Number.isFinite(year)) continue;
      out.push({
        id: `scopus:${scopusId ?? e['dc:identifier'] ?? Math.random()}`,
        source: 'scopus',
        year: year as number,
        title: (e['dc:title'] ?? '').trim() || '(no title)',
        venue: e['prism:publicationName']?.trim() || null,
        citations: Number(e['citedby-count'] ?? '0'),
        doi: e['prism:doi']?.toLowerCase() ?? null,
        scopusDocId: scopusId,
        pmid: e['pubmed-id'] ?? null,
        authors: parseScopusAuthorList(e.author ?? []),
      });
    }

    const total = Number(data['search-results']?.['opensearch:totalResults'] ?? '0');
    start += entries.length;
    if (entries.length < count || (Number.isFinite(total) && start >= total)) break;
  }

  return out;
}

// ── Internals ───────────────────────────────────────────────────────────────

function parseScopusAuthorList(authors: ScopusAuthorRaw[]): AuthorPosition[] {
  return authors.map((a, idx) => {
    const seqRaw = a['@seq'];
    const seq = seqRaw ? Number(seqRaw) : null;
    return {
      position: Number.isFinite(seq) ? (seq as number) : idx + 1,
      surname: a.surname?.trim() ?? '',
      givenName: a['given-name']?.trim() ?? null,
      initials: a.initials?.trim() ?? null,
    };
  });
}

interface ScopusAuthorRaw {
  '@seq'?: string;
  authid?: string;
  authname?: string;
  surname?: string;
  'given-name'?: string;
  initials?: string;
  orcid?: string;
}

interface ScopusSearchEntry {
  'dc:identifier'?: string;
  'prism:doi'?: string;
  'prism:coverDate'?: string;
  'dc:title'?: string;
  'prism:publicationName'?: string;
  'citedby-count'?: string;
  'pubmed-id'?: string;
  author?: ScopusAuthorRaw[];
}

interface ScopusSearchResponse {
  'search-results'?: {
    entry?: ScopusSearchEntry[];
    'opensearch:totalResults'?: string;
  };
}

interface ScopusAuthorSearchEntry {
  'dc:identifier'?: string;
  'document-count'?: string;
}

interface ScopusAuthorSearchResponse {
  'search-results'?: { entry?: ScopusAuthorSearchEntry[] };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}
