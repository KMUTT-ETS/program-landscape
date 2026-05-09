// Server-side fetcher for the kkuscholar publications mirror (Postgres
// at 10.130.2.151) — the institutional research warehouse curated by
// KKU Library / Research Office.
//
// Two access paths:
//
//   1) `fetchKkuScholarPublicationsByPerson()` — resolves a person via
//      kkuscholar.people (by people.id when known, else by English
//      name) and pulls ALL their papers from Scopus + PubMed with the
//      full author list each. This is the canonical "everything we
//      have for this staffer" path; it goes back to whatever year
//      kkuscholar has on file (often 1997+).
//
//   2) `fetchAuthorsByPaper()` — DOI/scopusId/pmid lookup for papers
//      we already have locally that didn't come through path #1
//      (e.g. IEEE conference papers from the legacy OpenAlex
//      connector). Falls back to single-author rendering when nothing
//      matches.
//
// Connection lifecycle: one Client per request, opened-and-closed
// inside a single function call. Failures degrade gracefully — a
// missing mirror just yields zero results, not an exception.

import pg from 'pg';

export interface AuthorPosition {
  position: number | null;
  surname: string;
  givenName: string | null;
  initials: string | null;
}

export interface KkuScholarPublication {
  /** Composite id for React keys + dedup — `<source>:<sourcePk>`. */
  id: string;
  source: 'scopus' | 'pubmed' | 'isi' | 'tci';
  /** Year (CE). */
  year: number;
  title: string;
  venue: string | null;
  citations: number;
  doi: string | null;
  scopusDocId: string | null;
  pmid: string | null;
  authors: AuthorPosition[];
}

export interface PaperLookupKey {
  id: string;
  scopusDocId: string | null;
  pmid: string | null;
  doi: string | null;
}

export interface PersonResolutionInput {
  /** Kkuscholar people.id when already known. Skips the name search. */
  kkuScholarPersonId?: number | null;
  /** English surname — required when kkuScholarPersonId is missing. */
  surnameEn?: string | null;
  /** English given name — required when kkuScholarPersonId is missing. */
  givenNameEn?: string | null;
  /** Thai surname/given names — used to disambiguate when an English
   *  name is shared by multiple people. */
  surnameTh?: string | null;
  givenNameTh?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pull all papers (Scopus + PubMed) attributed to a KKU staffer in
 * the kkuscholar mirror. Each paper carries its FULL author list.
 *
 * Resolution strategy:
 *   - If `kkuScholarPersonId` is provided, use it directly.
 *   - Otherwise resolve via `people.firstname_en + lastname_en`
 *     exact (case-insensitive) match. Tie-broken by Thai name when
 *     both Thai fields are provided.
 *   - On no match, returns [].
 *
 * Returns [] silently on connection / query failure (logged) so the
 * profile page still renders.
 */
export async function fetchKkuScholarPublicationsByPerson(
  ident: PersonResolutionInput,
): Promise<KkuScholarPublication[]> {
  const cfg = configFromEnv();
  if (!cfg) return [];
  const client = new pg.Client({
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    ssl: cfg.ssl ? { rejectUnauthorized: false } : false,
    statement_timeout: 60_000,
    query_timeout: 60_000,
    connectionTimeoutMillis: 10_000,
  });
  try {
    await client.connect();
  } catch (err) {
    console.warn('[kku-publications] connection failed:', (err as Error).message);
    return [];
  }
  try {
    const personId = await resolvePersonId(client, ident);
    if (!personId) return [];

    // Use the denormalised `scopus_document_with_authors` view as the
    // single source of truth for Scopus papers — kkuscholar's
    // `author_names_with_link` HTML embeds `/researchers/<personId>`
    // for every KKU author on every paper, so a LIKE-match here is
    // both the most permissive AND the cleanest path. Bypasses the
    // sparse `scopus_author_documents` bridge table.
    // Sequential, NOT Promise.all — a single pg.Client is one TCP
    // connection and can only execute one query at a time. Running
    // them concurrently would queue inside pg with the deprecation
    // warning "Calling client.query() when the client is already
    // executing a query". Serial execution is correct AND barely
    // slower at this scale (each fetch is < 200ms on the LAN).
    const scopusPapers = await fetchScopusPapersByPersonId(client, personId);
    const pubmedPapers = await fetchPubmedPapersByPersonId(client, personId);
    const isiPapers = await fetchIsiPapersByPersonId(client, personId);
    const tciPapers = await fetchTciPapersByPersonId(client, personId);

    return [...scopusPapers, ...pubmedPapers, ...isiPapers, ...tciPapers];
  } catch (err) {
    console.warn('[kku-publications] query failed:', (err as Error).message);
    return [];
  } finally {
    try { await client.end(); } catch { /* not actionable */ }
  }
}

/**
 * Bulk-resolve full author lists for a batch of papers we already have
 * locally. Used as a fallback for papers NOT returned by
 * `fetchKkuScholarPublicationsByPerson` — e.g. legacy OpenAlex-imported
 * rows whose author identity wasn't captured.
 *
 * Lookup paths: scopus → pubmed → DOI (against either source).
 */
export async function fetchAuthorsByPaper(
  keys: PaperLookupKey[],
): Promise<Map<string, AuthorPosition[]>> {
  const result = new Map<string, AuthorPosition[]>();
  if (keys.length === 0) return result;
  const cfg = configFromEnv();
  if (!cfg) return result;

  const client = new pg.Client({
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    ssl: cfg.ssl ? { rejectUnauthorized: false } : false,
    statement_timeout: 30_000,
    query_timeout: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  try {
    await client.connect();
  } catch (err) {
    console.warn('[kku-publications] connection failed (authors):', (err as Error).message);
    return result;
  }
  try {
    const scopusKeys = keys.filter((k) => k.scopusDocId);
    const pmidKeys = keys.filter((k) => !k.scopusDocId && k.pmid);
    const doiKeys = keys.filter((k) => !k.scopusDocId && !k.pmid && k.doi);

    if (scopusKeys.length > 0) {
      const docIds = scopusKeys.map((k) => k.scopusDocId!);
      const rows = await query<{ document_id: string; author_names: string | null }>(
        client,
        `SELECT document_id, author_names FROM scopus_document_with_authors
          WHERE document_id = ANY($1::text[])`,
        [docIds],
      );
      const byDoc = new Map<string, AuthorPosition[]>();
      for (const r of rows) {
        const parsed = parseScopusAuthorNamesString(r.author_names);
        if (parsed.length > 0) byDoc.set(r.document_id, parsed);
      }
      for (const k of scopusKeys) {
        const a = byDoc.get(k.scopusDocId!);
        if (a) result.set(k.id, a);
      }
    }

    if (pmidKeys.length > 0) {
      const pmids = pmidKeys.map((k) => k.pmid!);
      const rows = await query<PubmedAuthorRow>(client, PUBMED_AUTHORS_BY_PMID_SQL, [pmids]);
      const byPmid = groupPubmedAuthors(rows);
      for (const k of pmidKeys) {
        const a = byPmid.get(k.pmid!);
        if (a) result.set(k.id, a);
      }
    }

    if (doiKeys.length > 0) {
      const dois = doiKeys.map((k) => k.doi!.toLowerCase());
      // Try scopus first — broader coverage for our context.
      const scopusBridge = await query<{ doi: string; document_id: string }>(
        client,
        // Drop the workflow_state filter — we only need the document_id
        // to fetch authors; whether the row is "enabled" for kkuscholar's
        // own UI doesn't affect citation accuracy.
        `SELECT LOWER(doi) AS doi, document_id
           FROM scopus_documents
          WHERE LOWER(doi) = ANY($1::text[])`,
        [dois],
      );
      if (scopusBridge.length > 0) {
        const rows = await query<{ document_id: string; author_names: string | null }>(
          client,
          `SELECT document_id, author_names FROM scopus_document_with_authors
            WHERE document_id = ANY($1::text[])`,
          [scopusBridge.map((b) => b.document_id)],
        );
        const byDoc = new Map<string, AuthorPosition[]>();
        for (const r of rows) {
          const parsed = parseScopusAuthorNamesString(r.author_names);
          if (parsed.length > 0) byDoc.set(r.document_id, parsed);
        }
        const doiToDoc = new Map(scopusBridge.map((b) => [b.doi, b.document_id]));
        for (const k of doiKeys) {
          const docId = doiToDoc.get(k.doi!.toLowerCase());
          if (docId) {
            const a = byDoc.get(docId);
            if (a) result.set(k.id, a);
          }
        }
      }

      // PubMed bridge for whatever's still missing.
      const stillMissing = doiKeys.filter((k) => !result.has(k.id));
      if (stillMissing.length > 0) {
        const dois2 = stillMissing.map((k) => k.doi!.toLowerCase());
        const pubmedBridge = await query<{ doi: string; pmid: string }>(
          client,
          `SELECT LOWER(doi) AS doi, pmid FROM pubmed_documents WHERE LOWER(doi) = ANY($1::text[])`,
          [dois2],
        );
        if (pubmedBridge.length > 0) {
          const rows = await query<PubmedAuthorRow>(
            client,
            PUBMED_AUTHORS_BY_PMID_SQL,
            [pubmedBridge.map((b) => b.pmid)],
          );
          const byPmid = groupPubmedAuthors(rows);
          const doiToPmid = new Map(pubmedBridge.map((b) => [b.doi, b.pmid]));
          for (const k of stillMissing) {
            const pmid = doiToPmid.get(k.doi!.toLowerCase());
            if (pmid) {
              const a = byPmid.get(pmid);
              if (a) result.set(k.id, a);
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn('[kku-publications] author query failed:', (err as Error).message);
  } finally {
    try { await client.end(); } catch { /* not actionable */ }
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────────────

async function resolvePersonId(
  client: pg.Client,
  ident: PersonResolutionInput,
): Promise<number | null> {
  if (ident.kkuScholarPersonId) return ident.kkuScholarPersonId;

  const surnameEn = ident.surnameEn?.trim();
  const givenEn = ident.givenNameEn?.trim();
  if (!surnameEn || !givenEn) return null;

  // Match on lowercased English first/last. When the Thai names are
  // also provided, prefer the row that matches both — it disambiguates
  // homographic English transliterations (e.g. multiple "Denpong"s).
  const rows = await query<{ id: number; firstname: string | null; lastname: string | null }>(
    client,
    `SELECT id, firstname, lastname
       FROM people
      WHERE LOWER(firstname_en) = LOWER($1)
        AND LOWER(lastname_en) = LOWER($2)
      LIMIT 10`,
    [givenEn, surnameEn],
  );
  if (rows.length === 0) return null;
  if (rows.length === 1) return rows[0]!.id;

  if (ident.surnameTh && ident.givenNameTh) {
    const matched = rows.find(
      (r) => r.firstname?.trim() === ident.givenNameTh && r.lastname?.trim() === ident.surnameTh,
    );
    if (matched) return matched.id;
  }
  // Multiple matches and no Thai disambiguator — pick the first to
  // avoid silent failure, but log the ambiguity for follow-up.
  console.warn(`[kku-publications] ambiguous person match (${rows.length} candidates) for ${givenEn} ${surnameEn}; using first`);
  return rows[0]!.id;
}

async function fetchScopusPapersByPersonId(
  client: pg.Client,
  personId: number,
): Promise<KkuScholarPublication[]> {
  // `scopus_document_with_authors` is the denormalised view — it
  // bundles per-paper metadata + the comma-separated `author_names`
  // string + the HTML-encoded `author_names_with_link` containing
  // `/researchers/<personId>` for every linked KKU author. The view
  // is what kkuscholar's web UI uses for citation rendering, so its
  // author strings are the authoritative pre-formatted citation
  // bylines (already in "Surname I., Surname I." order).
  //
  // Citation count comes from `scopus_documents.cited_by_count` (not
  // exposed on the view) — a small extra join keeps that field.
  const papers = await query<{
    document_id: string; title: string | null; cover_date: Date | null;
    year: number | null; publication_name: string | null;
    author_names: string | null; doi: string | null;
    citation_count: number | null;
  }>(
    client,
    `SELECT v.document_id, v.title, v.cover_date, v.year::int AS year,
            v.publication_name, v.author_names,
            sd.doi, sd.cited_by_count AS citation_count
       FROM scopus_document_with_authors v
       LEFT JOIN scopus_documents sd ON sd.document_id = v.document_id
      WHERE v.author_names_with_link LIKE $1
        AND v.workflow_state = 'enabled'
      ORDER BY v.cover_date DESC NULLS LAST`,
    [`%/researchers/${personId}%`],
  );

  const out: KkuScholarPublication[] = [];
  for (const p of papers) {
    const year = p.year ?? (p.cover_date ? p.cover_date.getUTCFullYear() : null);
    if (!year) continue;
    out.push({
      id: `scopus:${p.document_id}`,
      source: 'scopus',
      year,
      title: p.title?.trim() || '(no title)',
      venue: p.publication_name?.trim() || null,
      citations: p.citation_count ?? 0,
      doi: p.doi?.trim() || null,
      scopusDocId: p.document_id,
      pmid: null,
      authors: parseScopusAuthorNamesString(p.author_names),
    });
  }
  return out;
}

/**
 * Parse the `author_names` field of `scopus_document_with_authors`,
 * which kkuscholar formats as `"Surname I., Surname I.J., …"`.
 * Returns ordered AuthorPosition entries.
 *
 * Tolerant parser:
 *   - Splits on `, ` (with the comma-then-period sequences as the
 *     internal author punctuation).
 *   - For each entry, splits at the LAST space — anything before is
 *     the surname (which may itself contain hyphens or particles
 *     like "de la"), anything after is the initials.
 *   - When no space is present (shouldn't happen, but defensive),
 *     treats the whole token as the surname.
 */
export function parseScopusAuthorNamesString(s: string | null): AuthorPosition[] {
  if (!s || !s.trim()) return [];
  const tokens = s
    .split(/,\s*/)
    .map((t) => t.trim())
    .filter(Boolean);
  return tokens.map((tok, i) => {
    const lastSpace = tok.lastIndexOf(' ');
    if (lastSpace < 0) {
      return { position: i + 1, surname: tok, givenName: null, initials: null };
    }
    const surname = tok.slice(0, lastSpace).trim();
    const initialsRaw = tok.slice(lastSpace + 1).trim().replace(/\.$/, '');
    return {
      position: i + 1,
      surname,
      givenName: null,
      initials: initialsRaw || null,
    };
  });
}

async function fetchPubmedPapersByPersonId(
  client: pg.Client,
  personId: number,
): Promise<KkuScholarPublication[]> {
  // pubmed_authors carries the resolved person_id directly (no bridge
  // table needed). Each row is one (paper × author) — same row shape
  // as scopus_author_documents.
  const pmidRows = await query<{ pmid: string }>(
    client,
    `SELECT DISTINCT pmid FROM pubmed_authors WHERE person_id = $1::int`,
    [personId],
  );
  if (pmidRows.length === 0) return [];

  const pmids = pmidRows.map((r) => r.pmid);
  // Pubmed_documents has `year` directly + the journal title. No
  // per-document citation count; we use 0 for unknown.
  const papers = await query<{
    pmid: string;
    title: string | null;
    year: number | null;
    journal_title: string | null;
    doi: string | null;
  }>(
    client,
    `SELECT pmid, title, year, journal_title, doi
       FROM pubmed_documents
      WHERE pmid = ANY($1::text[])
      ORDER BY year DESC NULLS LAST`,
    [pmids],
  );
  const authorRows = await query<PubmedAuthorRow>(
    client,
    PUBMED_AUTHORS_BY_PMID_SQL,
    [pmids],
  );
  const byPmid = groupPubmedAuthors(authorRows);

  const out: KkuScholarPublication[] = [];
  for (const p of papers) {
    if (!p.year) continue;
    out.push({
      id: `pubmed:${p.pmid}`,
      source: 'pubmed',
      year: p.year,
      title: p.title?.trim() || '(no title)',
      venue: p.journal_title?.trim() || null,
      citations: 0,
      doi: p.doi?.trim() || null,
      scopusDocId: null,
      pmid: p.pmid,
      authors: byPmid.get(p.pmid) ?? [],
    });
  }
  return out;
}

async function fetchIsiPapersByPersonId(
  client: pg.Client,
  personId: number,
): Promise<KkuScholarPublication[]> {
  // ISI = Web of Science / Clarivate. Mostly carries pre-2010 KKU
  // papers + Thai-affiliated Web-of-Science-only journals.
  const docIdRows = await query<{ doc_id: number }>(
    client,
    `SELECT DISTINCT isi_document_id AS doc_id FROM isi_authors WHERE person_id = $1::int`,
    [personId],
  );
  if (docIdRows.length === 0) return [];
  const docIds = docIdRows.map((r) => r.doc_id);

  const papers = await query<{
    id: number; title: string | null;
    publication_year: number | null; source_title: string | null;
    doi: string | null; volume: string | null; issue: string | null;
    beginning_page: string | null; ending_page: string | null;
    total_citations: number | null;
  }>(
    client,
    `SELECT id, title, publication_year, source_title, doi,
            volume, issue, beginning_page, ending_page, total_citations
       FROM isi_documents
      WHERE id = ANY($1::int[])
      ORDER BY publication_year DESC NULLS LAST`,
    [docIds],
  );
  const authorRows = await query<{
    isi_document_id: number; sorting: number | null;
    firstname: string | null; lastname: string | null;
    firstname_en: string | null; lastname_en: string | null;
  }>(
    client,
    `SELECT isi_document_id, sorting, firstname, lastname, firstname_en, lastname_en
       FROM isi_authors
      WHERE isi_document_id = ANY($1::int[])
      ORDER BY isi_document_id, sorting ASC NULLS LAST`,
    [docIds],
  );
  const byDoc = new Map<number, AuthorPosition[]>();
  for (const r of authorRows) {
    const arr = byDoc.get(r.isi_document_id) ?? [];
    // Prefer English name when present; fall back to Thai. ISI is
    // English-language and English fields are usually populated.
    arr.push({
      position: r.sorting,
      surname: (r.lastname_en?.trim() || r.lastname?.trim() || ''),
      givenName: r.firstname_en?.trim() || r.firstname?.trim() || null,
      initials: null,
    });
    byDoc.set(r.isi_document_id, arr);
  }

  const out: KkuScholarPublication[] = [];
  for (const p of papers) {
    if (!p.publication_year) continue;
    out.push({
      id: `isi:${p.id}`,
      source: 'isi',
      year: p.publication_year,
      title: p.title?.trim() || '(no title)',
      venue: p.source_title?.trim() || null,
      citations: p.total_citations ?? 0,
      doi: p.doi?.trim() || null,
      scopusDocId: null,
      pmid: null,
      authors: byDoc.get(p.id) ?? [],
    });
  }
  return out;
}

async function fetchTciPapersByPersonId(
  client: pg.Client,
  personId: number,
): Promise<KkuScholarPublication[]> {
  // TCI = Thai Citation Index. Thai-language journals; usually no DOI.
  // The schema has `year` (int) directly — no need to parse a date.
  const docIdRows = await query<{ doc_id: number }>(
    client,
    `SELECT DISTINCT tci_document_id AS doc_id FROM tci_authors WHERE person_id = $1::int`,
    [personId],
  );
  if (docIdRows.length === 0) return [];
  const docIds = docIdRows.map((r) => r.doc_id);

  const papers = await query<{
    id: number; title: string | null; year: number | null;
    journal_name: string | null; source_name: string | null;
    volume: string | null; issue: string | null; pages: string | null;
  }>(
    client,
    `SELECT id, title, year, journal_name, source_name, volume, issue, pages
       FROM tci_documents
      WHERE id = ANY($1::int[])
      ORDER BY year DESC NULLS LAST`,
    [docIds],
  );
  const authorRows = await query<{
    tci_document_id: number; sorting: number | null;
    firstname: string | null; lastname: string | null;
    firstname_en: string | null; lastname_en: string | null;
  }>(
    client,
    `SELECT tci_document_id, sorting, firstname, lastname, firstname_en, lastname_en
       FROM tci_authors
      WHERE tci_document_id = ANY($1::int[])
      ORDER BY tci_document_id, sorting ASC NULLS LAST`,
    [docIds],
  );
  const byDoc = new Map<number, AuthorPosition[]>();
  for (const r of authorRows) {
    // TCI papers are Thai-primary — prefer Thai author names so the
    // citation matches the journal's actual byline. Fall back to EN
    // when only EN is populated.
    const surname = r.lastname?.trim() || r.lastname_en?.trim() || '';
    const given = r.firstname?.trim() || r.firstname_en?.trim() || null;
    const arr = byDoc.get(r.tci_document_id) ?? [];
    arr.push({ position: r.sorting, surname, givenName: given, initials: null });
    byDoc.set(r.tci_document_id, arr);
  }

  const out: KkuScholarPublication[] = [];
  for (const p of papers) {
    if (!p.year) continue;
    out.push({
      id: `tci:${p.id}`,
      source: 'tci',
      year: p.year,
      title: p.title?.trim() || '(no title)',
      venue: p.journal_name?.trim() || p.source_name?.trim() || null,
      citations: 0,
      doi: null,
      scopusDocId: null,
      pmid: null,
      authors: byDoc.get(p.id) ?? [],
    });
  }
  return out;
}

// ── Shared SQL + grouping helpers ────────────────────────────────────────────

interface PubmedAuthorRow {
  pmid: string;
  position: number | null;
  firstname: string | null;
  lastname: string | null;
  initials: string | null;
}

// `sorting` is pubmed_authors' position column (1-based author order).
const PUBMED_AUTHORS_BY_PMID_SQL = `
  SELECT pmid, sorting AS position, firstname, lastname, initials
    FROM pubmed_authors
   WHERE pmid = ANY($1::text[])
   ORDER BY pmid, sorting ASC NULLS LAST, lastname ASC
`;

function groupPubmedAuthors(rows: PubmedAuthorRow[]): Map<string, AuthorPosition[]> {
  const m = new Map<string, AuthorPosition[]>();
  for (const r of rows) {
    const arr = m.get(r.pmid) ?? [];
    arr.push({
      position: r.position,
      surname: r.lastname ?? '',
      givenName: r.firstname,
      initials: r.initials,
    });
    m.set(r.pmid, arr);
  }
  return m;
}

// ── Config ───────────────────────────────────────────────────────────────────

interface KkuPublicationsConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
}

function configFromEnv(): KkuPublicationsConfig | null {
  const required = ['HOST', 'PORT', 'DATABASE', 'USER', 'PASSWORD'];
  const missing = required.filter((k) => !process.env[`KKU_PUBLICATIONS_DB_${k}`]);
  if (missing.length > 0) return null;
  return {
    host: process.env.KKU_PUBLICATIONS_DB_HOST!,
    port: Number(process.env.KKU_PUBLICATIONS_DB_PORT),
    database: process.env.KKU_PUBLICATIONS_DB_DATABASE!,
    user: process.env.KKU_PUBLICATIONS_DB_USER!,
    password: process.env.KKU_PUBLICATIONS_DB_PASSWORD!,
    ssl: /^(true|1|yes)$/i.test(process.env.KKU_PUBLICATIONS_DB_SSL ?? ''),
  };
}

async function query<T extends pg.QueryResultRow>(
  client: pg.Client,
  sql: string,
  binds: unknown[] = [],
): Promise<T[]> {
  const r = await client.query<T>(sql, binds);
  return r.rows;
}
