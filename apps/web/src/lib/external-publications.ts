// External-API fallback for resolving full author lists when kkuscholar
// + the local DOI bridge come up empty. Tried in order:
//
//   1. OpenAlex (free, polite-pool with OPENALEX_MAILTO) — broad
//      coverage of journal + conference papers.
//   2. Scopus (KKU_SCOPUS_API_KEY) — Elsevier-curated, deeper for
//      indexed papers but rate-limited (20k/week).
//
// Google Scholar is intentionally NOT used — no official API, the
// unofficial scrapers violate ToS, and IP-blocking risk is real.
//
// All calls are server-side (we run inside Next's Node runtime) and
// wrapped in try/catch so a network blip never breaks the page. The
// result feeds into `user_publications_cache` so the slow path runs
// at most once per 24h.

import type { AuthorPosition } from './kku-publications';

const OPENALEX_BASE = 'https://api.openalex.org';
const SCOPUS_BASE = 'https://api.elsevier.com/content/abstract/doi';

// Generous-but-bounded timeout — we'd rather drop a slow lookup than
// stall the cache-miss profile load past 30s.
const TIMEOUT_MS = 8_000;

export interface ExternalAuthorResult {
  authors: AuthorPosition[];
  source: 'openalex' | 'scopus';
}

export interface PaperMetadata {
  /** Full paper title (the strongest disambiguating signal). */
  title: string;
  /** English surname of the profile owner — used to filter search
   *  results AND verify the matched paper actually has them as an
   *  author. Required; without it metadata search would return
   *  arbitrary papers with similar titles. */
  ownerSurname: string;
  /** Given name (or first initial) — used as a secondary verifier
   *  when surname is common (e.g. "Smith"). Optional. */
  ownerGiven?: string | null;
  /** Publication year (±1 tolerance applied during verification). */
  year?: number | null;
  /** Journal / conference name — soft hint, not strict. */
  venue?: string | null;
}

/**
 * Resolve a paper's full author list from external APIs by DOI.
 * Tries OpenAlex first (free + broad), then Scopus (if key).
 * Returns null when nothing matches.
 */
export async function fetchExternalAuthors(
  doi: string,
): Promise<ExternalAuthorResult | null> {
  const normalised = doi.trim().toLowerCase();
  if (!normalised) return null;

  const fromOpenAlex = await tryOpenAlex(normalised);
  if (fromOpenAlex && fromOpenAlex.length > 0) {
    return { authors: fromOpenAlex, source: 'openalex' };
  }

  const fromScopus = await tryScopus(normalised);
  if (fromScopus && fromScopus.length > 0) {
    return { authors: fromScopus, source: 'scopus' };
  }

  return null;
}

/**
 * Resolve a paper's full author list when DOI is missing or didn't
 * match. Searches by title + author surname on OpenAlex (then
 * Scopus). Verifies the returned paper actually contains the
 * owner's surname before accepting — guards against generic-title
 * false positives.
 *
 * Last-resort path; returns null when nothing matches.
 */
export async function fetchExternalAuthorsByMetadata(
  meta: PaperMetadata,
): Promise<ExternalAuthorResult | null> {
  if (!meta.title.trim() || !meta.ownerSurname.trim()) return null;

  const fromOpenAlex = await tryOpenAlexSearch(meta);
  if (fromOpenAlex && fromOpenAlex.length > 0) {
    return { authors: fromOpenAlex, source: 'openalex' };
  }

  const fromScopus = await tryScopusSearch(meta);
  if (fromScopus && fromScopus.length > 0) {
    return { authors: fromScopus, source: 'scopus' };
  }

  return null;
}

// ── OpenAlex ─────────────────────────────────────────────────────────────────
//
// Endpoint: GET /works/doi:<doi>?mailto=<email>
// Returns:
//   {
//     authorships: [
//       { author: { display_name: "John Smith", orcid: "..." }, ... },
//       ...
//     ],
//     ...
//   }
//
// The polite pool (mailto param + matching User-Agent) gets 10 req/s
// vs 1 req/s for anonymous. We always include it when configured.

interface OpenAlexAuthor {
  display_name?: string;
  orcid?: string | null;
}

interface OpenAlexAuthorship {
  author?: OpenAlexAuthor;
  author_position?: 'first' | 'middle' | 'last';
}

interface OpenAlexWork {
  authorships?: OpenAlexAuthorship[];
}

async function tryOpenAlex(doi: string): Promise<AuthorPosition[] | null> {
  const mailto = process.env.OPENALEX_MAILTO;
  const url =
    `${OPENALEX_BASE}/works/doi:${encodeURIComponent(doi)}` +
    (mailto ? `?mailto=${encodeURIComponent(mailto)}` : '');

  try {
    const res = await fetchWithTimeout(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': mailto
          ? `kku-program-landscape (mailto:${mailto})`
          : 'kku-program-landscape',
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as OpenAlexWork;
    if (!Array.isArray(data.authorships)) return null;

    return data.authorships.map((a, idx) => splitDisplayName(
      a.author?.display_name ?? '',
      idx + 1,
    ));
  } catch (err) {
    console.warn(`[external-publications] openalex failed for ${doi}:`, (err as Error).message);
    return null;
  }
}

// ── Scopus ───────────────────────────────────────────────────────────────────
//
// Endpoint: GET /content/abstract/doi/<doi>?apiKey=<KEY>&httpAccept=application/json
// Authors live at:
//   abstracts-retrieval-response.authors.author[]
//     { @auid, @seq, ce:given-name, ce:surname, ce:initials }
//
// We strip the @ from JSON keys (Elsevier uses XML-flavoured JSON).

interface ScopusAuthorRaw {
  '@seq'?: string;
  'ce:given-name'?: string;
  'ce:surname'?: string;
  'ce:initials'?: string;
  preferred_name?: { 'ce:given-name'?: string; 'ce:surname'?: string };
}

interface ScopusResponse {
  'abstracts-retrieval-response'?: {
    authors?: { author?: ScopusAuthorRaw[] };
  };
}

async function tryScopus(doi: string): Promise<AuthorPosition[] | null> {
  const key = process.env.KKU_SCOPUS_API_KEY;
  if (!key) return null;

  const url = `${SCOPUS_BASE}/${encodeURIComponent(doi)}?httpAccept=application/json`;

  try {
    const res = await fetchWithTimeout(url, {
      headers: {
        'X-ELS-APIKey': key,
        Accept: 'application/json',
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as ScopusResponse;
    const authorsRaw = data['abstracts-retrieval-response']?.authors?.author;
    if (!Array.isArray(authorsRaw)) return null;

    return authorsRaw.map((a, idx) => {
      const seqRaw = a['@seq'];
      const seq = seqRaw ? Number(seqRaw) : null;
      const surname =
        a['ce:surname']?.trim() ||
        a.preferred_name?.['ce:surname']?.trim() ||
        '';
      const given =
        a['ce:given-name']?.trim() ||
        a.preferred_name?.['ce:given-name']?.trim() ||
        null;
      const initials = a['ce:initials']?.trim() || null;
      return {
        position: Number.isFinite(seq) ? seq : idx + 1,
        surname,
        givenName: given,
        initials,
      };
    });
  } catch (err) {
    console.warn(`[external-publications] scopus failed for ${doi}:`, (err as Error).message);
    return null;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Split a "Firstname Middle Lastname" display string into its parts.
 * Conservative — when in doubt the rightmost token is the surname,
 * everything before is the given name. Handles single-token names
 * (treats the whole token as surname) and "Lastname, F." comma forms.
 */
function splitDisplayName(display: string, position: number): AuthorPosition {
  const trimmed = display.trim();
  if (!trimmed) return { position, surname: '', givenName: null, initials: null };

  // Comma form: "Lastname, Firstname M."
  if (trimmed.includes(',')) {
    const [last, first] = trimmed.split(',', 2).map((s) => s.trim());
    return {
      position,
      surname: last ?? trimmed,
      givenName: first || null,
      initials: null,
    };
  }

  // Space-separated: rightmost token = surname.
  const tokens = trimmed.split(/\s+/);
  if (tokens.length === 1) {
    return { position, surname: tokens[0]!, givenName: null, initials: null };
  }
  const surname = tokens[tokens.length - 1]!;
  const given = tokens.slice(0, -1).join(' ');
  return { position, surname, givenName: given, initials: null };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── Metadata-based search (fallback for missing/unmatched DOIs) ─────────────

interface OpenAlexSearchHit extends OpenAlexWork {
  title?: string | null;
  publication_year?: number | null;
  doi?: string | null;
  host_venue?: { display_name?: string | null };
}

interface OpenAlexSearchResult {
  results?: OpenAlexSearchHit[];
}

async function tryOpenAlexSearch(
  meta: PaperMetadata,
): Promise<AuthorPosition[] | null> {
  const mailto = process.env.OPENALEX_MAILTO;

  // Build the query: title via `?search=`, narrow by author surname
  // via `filter=raw_author_name.search:` (matches any author position
  // — not just first). 5 results is enough for a manual verify step.
  const params = new URLSearchParams();
  params.set('search', meta.title);
  params.set('filter', `raw_author_name.search:${meta.ownerSurname}`);
  params.set('per-page', '5');
  if (mailto) params.set('mailto', mailto);
  const url = `${OPENALEX_BASE}/works?${params.toString()}`;

  try {
    const res = await fetchWithTimeout(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': mailto
          ? `kku-program-landscape (mailto:${mailto})`
          : 'kku-program-landscape',
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as OpenAlexSearchResult;
    const candidates = data.results ?? [];
    for (const work of candidates) {
      const ok = verifyOpenAlexCandidate(work, meta);
      if (!ok) continue;
      const authorships = work.authorships ?? [];
      if (authorships.length === 0) continue;
      return authorships.map((a, idx) =>
        splitDisplayName(a.author?.display_name ?? '', idx + 1),
      );
    }
    return null;
  } catch (err) {
    console.warn(
      `[external-publications] openalex search failed for "${meta.title.slice(0, 50)}":`,
      (err as Error).message,
    );
    return null;
  }
}

function verifyOpenAlexCandidate(
  work: OpenAlexSearchHit,
  meta: PaperMetadata,
): boolean {
  // 1. Owner's surname must actually appear in the candidate's author
  //    list. The OpenAlex filter is fuzzy; this is the hard check.
  const surnameLower = meta.ownerSurname.toLocaleLowerCase();
  const hasOwner = (work.authorships ?? []).some((a) => {
    const name = (a.author?.display_name ?? '').toLocaleLowerCase();
    return name.includes(surnameLower);
  });
  if (!hasOwner) return false;

  // 2. Year must match within ±1 (publication-date drift between
  //    "online first" and the print issue is a real problem).
  if (meta.year && work.publication_year) {
    if (Math.abs(work.publication_year - meta.year) > 1) return false;
  }
  return true;
}

interface ScopusSearchResult {
  'search-results'?: {
    entry?: Array<{
      'dc:identifier'?: string; // "SCOPUS_ID:..."
      'prism:doi'?: string;
      'dc:title'?: string;
      'prism:coverDate'?: string;
      'prism:publicationName'?: string;
      author?: Array<{
        '@seq'?: string;
        'authname'?: string;
        'given-name'?: string;
        surname?: string;
        initials?: string;
      }>;
    }>;
  };
}

async function tryScopusSearch(
  meta: PaperMetadata,
): Promise<AuthorPosition[] | null> {
  const key = process.env.KKU_SCOPUS_API_KEY;
  if (!key) return null;

  // Scopus query DSL: TITLE("…") narrows by title; AUTHLAST() by
  // surname. Quoted phrases let us pass titles with spaces /
  // punctuation as-is (Scopus handles word-stem matching internally).
  const titleQuoted = meta.title.replace(/"/g, '');
  const queryParts: string[] = [`TITLE("${titleQuoted}")`];
  queryParts.push(`AUTHLAST(${meta.ownerSurname})`);
  const params = new URLSearchParams({
    query: queryParts.join(' AND '),
    count: '5',
    httpAccept: 'application/json',
  });
  const url = `https://api.elsevier.com/content/search/scopus?${params.toString()}`;

  try {
    const res = await fetchWithTimeout(url, {
      headers: {
        'X-ELS-APIKey': key,
        Accept: 'application/json',
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as ScopusSearchResult;
    const entries = data['search-results']?.entry ?? [];
    for (const entry of entries) {
      // Verify owner is in the author list + year matches.
      const surnameLower = meta.ownerSurname.toLocaleLowerCase();
      const authorList = entry.author ?? [];
      const hasOwner = authorList.some((a) =>
        (a.authname ?? a.surname ?? '').toLocaleLowerCase().includes(surnameLower),
      );
      if (!hasOwner) continue;
      if (meta.year && entry['prism:coverDate']) {
        const candidateYear = Number(entry['prism:coverDate'].slice(0, 4));
        if (Number.isFinite(candidateYear) && Math.abs(candidateYear - meta.year) > 1) {
          continue;
        }
      }
      // Scopus search returns authors per-entry (good — no need for a
      // second abstract-retrieval call). Map them.
      if (authorList.length === 0) {
        // Some entries omit author breakdown; skip them — a Scopus
        // abstract-retrieval call would resolve, but adds latency.
        continue;
      }
      return authorList.map((a, idx) => {
        const seqRaw = a['@seq'];
        const seq = seqRaw ? Number(seqRaw) : null;
        return {
          position: Number.isFinite(seq) ? seq : idx + 1,
          surname: a.surname?.trim() ?? '',
          givenName: a['given-name']?.trim() ?? null,
          initials: a.initials?.trim() ?? null,
        };
      });
    }
    return null;
  } catch (err) {
    console.warn(
      `[external-publications] scopus search failed for "${meta.title.slice(0, 50)}":`,
      (err as Error).message,
    );
    return null;
  }
}
