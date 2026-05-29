// ─────────────────────────────────────────────────────────────────────────────
// KkuResearchRealConnector — kku-publications mirror edition.
//
// Source: internal Postgres mirror at 10.130.2.151 (`kkuscholar` DB),
// curated by KKU Library / Research Office. Replaces the OpenAlex+Scopus
// API pathway (preserved alongside as connector.openalex.ts for one
// rollback cycle).
//
// What this connector reads, per run:
//   - Scopus: documents + author-paper join, filtered to KKU-resolved
//     authorships (scopus_author_documents.person_id IS NOT NULL).
//   - PubMed: documents + author-paper join, same shape.
//
// What it writes:
//   - One ResearchOutput row per (paper × resolved KKU author). Same as
//     the previous OpenAlex pathway. Source column is set to one of
//     'kku-publications:scopus' / 'kku-publications:pubmed' so analysts
//     can trace provenance and (later) safely deprecate the older
//     OpenAlex-sourced rows.
//
// What this connector does NOT do:
//   - ISI / TCI / NRIIS — ISI's last update_at is 2022-02 and TCI's is
//     2019-01. They're stale and not load-bearing for current decisions.
//     Wire them when KKU Library refreshes them (separate session).
//   - Auto-create FacultyMember rows from kku-publications `people`. Our
//     FacultyMember source-of-truth is kku-hr; we resolve against the
//     existing snapshot and surface unmatched as analyst triage. A
//     follow-up "FacultyMember backfill from kku-publications" is a
//     separate workstream.
//   - Read kku-publications `people.pid` (partial PII — sparse 13-digit
//     citizen IDs in some rows). Skipped at the SELECT projection.
//
// PDPA posture:
//   - Publication metadata is public per the data subject's act of
//     publishing. Author display names + per-paper position counts are
//     ingested. No emails, no addresses, no salaries.
//   - The kkuscholar mirror gates access via Postgres roles; our
//     read-only `kkuscholar` user has SELECT only on the `public`
//     schema. The connector's SQL is the trust boundary — review
//     carefully if you change either query.
// ─────────────────────────────────────────────────────────────────────────────

import { prisma, type PrismaClient } from '@kku/db';
import type {
  ConnectorContext,
  HealthStatus,
  LoadResult,
  NormalizedRecord,
  RawRecord,
} from '@kku/shared';

import { ApiConnector } from '../../base/api-connector';
import { NonRetryableError } from '../../base/base-connector';
import {
  configFromEnv,
  query,
  withConnection,
  type PostgresConfig,
} from '../../../lib/postgres-client';
import {
  buildFacultyMemberLookup,
  type FacultyMemberLookup,
  type KkuPubPubMedRow,
  type KkuPubScopusRow,
  normaliseDoi,
  pubmedPublicationTypeToOurs,
  resolveAuthor,
  scopusAggregationToOurs,
  yearOf,
} from './transforms';

const DEFAULT_YEAR_FROM = 2015;

// Source identifiers on ResearchOutput.source. Stable strings; downstream
// code (admin views, AI tools) can filter by them.
const SOURCE_SCOPUS = 'kku-publications:scopus';
const SOURCE_PUBMED = 'kku-publications:pubmed';

// ─────────────────────────────────────────────────────────────────────────
// Per-run state
// ─────────────────────────────────────────────────────────────────────────

interface MatchTotals {
  matchedByNameEn: number;
  matchedByNameTh: number;
  unmatched: number;
}

interface SourceBucket {
  papersFetched: number;
  authorshipsEmitted: number;
  match: MatchTotals;
  unmatchedAuthorSamples: Array<{
    authorName: string;
    paperId: string;
    paperTitle: string;
  }>;
  fetchError: string | null;
}

interface RunState {
  capturedAt: string;
  fetchTimestamp: Date;
  facultyMemberLookup: FacultyMemberLookup;
  scopus: SourceBucket;
  pubmed: SourceBucket;
}

// Discriminated raw shape so transform() can dispatch on `kind`.
type RawShape =
  | { kind: 'scopus'; row: KkuPubScopusRow }
  | { kind: 'pubmed'; row: KkuPubPubMedRow };

// ─────────────────────────────────────────────────────────────────────────
// Connector
// ─────────────────────────────────────────────────────────────────────────

export class KkuResearchRealConnector extends ApiConnector {
  readonly slug = 'kku-research';
  readonly mocked = false;

  private runState?: RunState;

  constructor(private readonly db: PrismaClient = prisma) {
    super();
  }

  private cfg(): PostgresConfig {
    return configFromEnv('KKU_PUBLICATIONS_DB');
  }

  override async healthCheck(_ctx: ConnectorContext): Promise<HealthStatus> {
    try {
      const cfg = this.cfg();
      await withConnection(cfg, async (client) => {
        await query(client, 'SELECT 1');
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  async fetch(ctx: ConnectorContext, _since?: Date): Promise<RawRecord[]> {
    const fetchTimestamp = new Date();
    const capturedAt = fetchTimestamp.toISOString();
    const yearFrom = Number(process.env.KKU_RESEARCH_YEAR_FROM ?? DEFAULT_YEAR_FROM);
    if (!Number.isInteger(yearFrom) || yearFrom < 1900 || yearFrom > 2100) {
      throw new NonRetryableError(
        'CONFIG',
        `KKU_RESEARCH_YEAR_FROM out of range: ${process.env.KKU_RESEARCH_YEAR_FROM}`,
      );
    }

    // 1. Snapshot FacultyMember for in-memory matching. ~1k rows is
    //    negligible memory; avoids hitting Prisma per author.
    const facultyMembers = await this.db.facultyMember.findMany({
      select: { id: true, nameEn: true, nameTh: true },
    });
    const facultyMemberLookup = buildFacultyMemberLookup(facultyMembers);
    ctx.log.info(
      `loaded ${facultyMembers.length} FacultyMember rows for matching (nameEn=${facultyMemberLookup.byNameEn.size}, nameTh=${facultyMemberLookup.byNameTh.size})`,
    );

    this.runState = {
      capturedAt,
      fetchTimestamp,
      facultyMemberLookup,
      scopus: emptyBucket(),
      pubmed: emptyBucket(),
    };

    const cfg = this.cfg();
    const raw: RawRecord[] = [];

    // 2. Two SELECTs in one connection. Each in its own try/catch so a
    //    PubMed failure doesn't lose Scopus results (and vice versa).
    await withConnection(cfg, async (client) => {
      // Scopus
      try {
        ctx.log.info(`fetching Scopus authorships from kku-publications (year >= ${yearFrom})…`);
        // Resolution path confirmed by KKU Library IT (2026-05-07):
        //   scopus_documents
        //     → scopus_author_documents       (paper × author appearance)
        //     → scopus_authors                (Scopus author entity that appeared on a paper)
        //     → scopus_author_people          (curator-validated bridge to KKU person)
        //     → people                        (KKU researcher master)
        // We previously joined people via `scopus_author_documents.person_id`,
        // but that column is a denormalised cache that lags ~3 years behind
        // the curator workflow. The canonical chain via scopus_author_people
        // recovers ~10x more 2022+ papers and reconciles to the library's
        // dashboard within 5-10%.
        const scopusRows = await query<KkuPubScopusRow>(
          client,
          // jm = journal metrics. LATERAL picks ONE scopus_citescores
          // row for the paper's journal (source_id, both varchar):
          // prefer the most recent metric year ≤ cover year, else the
          // closest year, and among that year's per-ASJC rows take the
          // BEST quartile (1 is best). source_id match covers ~94% of
          // enabled 2015+ docs; exact-year-only would be ~49%, hence
          // the nearest-year fallback. Journals with no CiteScore row
          // yield NULLs.
          `SELECT
             d.document_id,
             d.eid,
             d.title,
             d.publication_name,
             d.cover_date,
             d.cited_by_count,
             d.doi,
             d.aggregation_type,
             jm.quartile         AS quartile,
             jm.percentile       AS cite_score_percentile,
             jm.sjr              AS sjr,
             sa.author_id        AS scopus_author_id,
             sap.person_id       AS person_id,
             ad.seq              AS author_seq,
             p.firstname_en      AS person_firstname_en,
             p.lastname_en       AS person_lastname_en,
             p.firstname         AS person_firstname,
             p.lastname          AS person_lastname,
             p.faculty_id        AS person_faculty_id
           FROM scopus_documents d
           JOIN scopus_author_documents ad ON ad.document_id  = d.document_id
           JOIN scopus_authors          sa ON sa.author_id    = ad.author_id
           JOIN scopus_author_people   sap ON sap.scopus_author_id = sa.id
           JOIN people                  p  ON p.id            = sap.person_id
           LEFT JOIN LATERAL (
             SELECT cs.quartile, cs.percentile, cs.sjr
             FROM scopus_citescores cs
             WHERE cs.sourceid = d.source_id
               AND cs.quartile IS NOT NULL
             ORDER BY
               (cs.year <= EXTRACT(YEAR FROM d.cover_date)::int) DESC,
               abs(cs.year - EXTRACT(YEAR FROM d.cover_date)::int) ASC,
               cs.quartile ASC
             LIMIT 1
           ) jm ON true
           WHERE d.workflow_state = 'enabled'
             AND p.university_id  = 1
             AND d.cover_date IS NOT NULL
             AND d.cover_date >= make_date($1::int, 1, 1)`,
          [yearFrom],
        );
        ctx.log.info(`Scopus: ${scopusRows.length.toLocaleString()} (paper × KKU author) rows fetched`);
        this.runState!.scopus.papersFetched = scopusRows.length;
        for (const row of scopusRows) raw.push({
          externalId: `kku-research:scopus:${row.eid}:${row.person_id ?? 'np'}`,
          sourceTimestamp: fetchTimestamp,
          data: { kind: 'scopus', row } satisfies RawShape,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.log.error(`Scopus fetch failed: ${msg}`);
        this.runState!.scopus.fetchError = msg;
      }

      // PubMed
      try {
        ctx.log.info(`fetching PubMed authorships from kku-publications (year >= ${yearFrom})…`);
        const pubmedRows = await query<KkuPubPubMedRow>(
          client,
          `SELECT
             d.id            AS pubmed_document_id,
             d.pmid,
             d.title,
             d.journal_title,
             d.year,
             d.doi,
             pa.person_id    AS person_id,
             pa.sorting      AS author_seq,
             p.firstname_en  AS person_firstname_en,
             p.lastname_en   AS person_lastname_en,
             p.firstname     AS person_firstname,
             p.lastname      AS person_lastname,
             p.faculty_id    AS person_faculty_id
           FROM pubmed_documents d
           JOIN pubmed_authors pa
             ON pa.pubmed_document_id = d.id
           JOIN people p
             ON p.id = pa.person_id
           WHERE pa.person_id IS NOT NULL
             AND p.university_id = 1
             AND d.year IS NOT NULL
             AND d.year >= $1`,
          [yearFrom],
        );
        ctx.log.info(`PubMed: ${pubmedRows.length.toLocaleString()} (paper × KKU author) rows fetched`);
        this.runState!.pubmed.papersFetched = pubmedRows.length;
        for (const row of pubmedRows) raw.push({
          externalId: `kku-research:pubmed:${row.pmid}:${row.person_id ?? 'np'}`,
          sourceTimestamp: fetchTimestamp,
          data: { kind: 'pubmed', row } satisfies RawShape,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.log.error(`PubMed fetch failed: ${msg}`);
        this.runState!.pubmed.fetchError = msg;
      }
    });

    if (this.runState.scopus.fetchError && this.runState.pubmed.fetchError) {
      throw new Error(
        `both Scopus and PubMed fetches failed: scopus=${this.runState.scopus.fetchError}; pubmed=${this.runState.pubmed.fetchError}`,
      );
    }

    return raw;
  }

  async transform(
    _ctx: ConnectorContext,
    raw: RawRecord,
  ): Promise<NormalizedRecord[]> {
    const state = this.runState;
    if (!state) {
      throw new Error('transform() called before fetch() — connector lifecycle violated');
    }
    const data = raw.data as RawShape;

    if (data.kind === 'scopus') {
      const r = data.row;
      const year = yearOf(r.cover_date);
      if (!year) return [];
      const resolution = resolveAuthor(
        {
          firstname_en: r.person_firstname_en,
          lastname_en: r.person_lastname_en,
          firstname: r.person_firstname,
          lastname: r.person_lastname,
        },
        state.facultyMemberLookup,
      );
      tallyResolution(state.scopus, resolution, r.eid, r.title ?? '(untitled)');

      return [
        {
          target: 'research_outputs',
          externalId: `research_output:scopus:${r.eid}:${resolution.facultyMemberId ?? `np:${r.person_id ?? 'unknown'}`}`,
          payload: {
            source: SOURCE_SCOPUS,
            scopusEid: r.eid,
            doi: normaliseDoi(r.doi),
            year,
            type: scopusAggregationToOurs(r.aggregation_type),
            title: (r.title ?? r.publication_name ?? '(untitled)').trim(),
            venue: r.publication_name?.trim() ?? null,
            citations: r.cited_by_count ?? 0,
            quartile: r.quartile ?? null,
            citeScorePercentile: r.cite_score_percentile ?? null,
            sjr: r.sjr ?? null,
            facultyMemberId: resolution.facultyMemberId,
            kkuAuthorName: resolution.authorDisplayName,
          },
          freshnessDate: state.fetchTimestamp,
        },
      ];
    }

    // PubMed
    const r = data.row;
    const resolution = resolveAuthor(
      {
        firstname_en: r.person_firstname_en,
        lastname_en: r.person_lastname_en,
        firstname: r.person_firstname,
        lastname: r.person_lastname,
      },
      state.facultyMemberLookup,
    );
    tallyResolution(state.pubmed, resolution, r.pmid, r.title ?? '(untitled)');

    return [
      {
        target: 'research_outputs',
        externalId: `research_output:pubmed:${r.pmid}:${resolution.facultyMemberId ?? `np:${r.person_id ?? 'unknown'}`}`,
        payload: {
          source: SOURCE_PUBMED,
          pmid: r.pmid,
          doi: normaliseDoi(r.doi),
          year: r.year,
          type: pubmedPublicationTypeToOurs(null),
          title: (r.title ?? '(untitled)').trim(),
          venue: r.journal_title?.trim() ?? null,
          // PubMed citation counts aren't part of pubmed_documents in
          // this mirror; sparse pubmed_citedbies covers <1% of papers.
          // Set 0 as a deliberate placeholder, not a measurement.
          citations: 0,
          facultyMemberId: resolution.facultyMemberId,
          kkuAuthorName: resolution.authorDisplayName,
        },
        freshnessDate: state.fetchTimestamp,
      },
    ];
  }

  async load(
    ctx: ConnectorContext,
    normalized: NormalizedRecord[],
  ): Promise<LoadResult> {
    const state = this.runState;
    if (!state) {
      throw new Error('load() called before fetch() — connector lifecycle violated');
    }
    let loaded = 0;
    let failed = 0;

    // Chunked concurrent upserts. Sequential per-row writes are the
    // bottleneck when 65k+ rows need round-trips; chunk size 25 is the
    // same envelope as the kmitl-skill-mapping connector and keeps the
    // pg_pool happy on the program-landscape side.
    const CHUNK_SIZE = 25;
    const PROGRESS_INTERVAL = 5000;
    let nextProgressMark = PROGRESS_INTERVAL;

    for (let i = 0; i < normalized.length; i += CHUNK_SIZE) {
      const chunk = normalized.slice(i, i + CHUNK_SIZE);
      const results = await Promise.allSettled(
        chunk.map((rec) => this.upsertOne(rec, ctx.runId)),
      );
      for (const r of results) {
        if (r.status === 'fulfilled') loaded++;
        else {
          failed++;
          ctx.log.error(`upsert failed: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
        }
      }
      if (loaded + failed >= nextProgressMark) {
        ctx.log.info(`loaded ${loaded.toLocaleString()} / ${normalized.length.toLocaleString()} (${failed} failed)`);
        nextProgressMark += PROGRESS_INTERVAL;
      }
    }

    return {
      recordsFetched: normalized.length,
      recordsLoaded: loaded,
      recordsFailed: failed,
      metadata: {
        connectorMode: 'real',
        capturedAt: state.capturedAt,
        sourceMirror: 'kku-publications @ 10.130.2.151',
        sources: {
          scopus: bucketSummary(state.scopus, SOURCE_SCOPUS),
          pubmed: bucketSummary(state.pubmed, SOURCE_PUBMED),
        },
        notes:
          'kku-research.v2: pivoted from OpenAlex+Scopus API to internal kku-publications mirror. ' +
          'Author resolution by KKU Library curator-grade person_id → in-memory FacultyMember match (nameEn lowercased exact > nameTh exact). ' +
          'ISI + TCI deferred (last update 2022-02 / 2019-01). ' +
          'OpenAlex pathway preserved as connector.openalex.ts during 30-day green-history evaluation.',
      },
    };
  }

  // Upsert a single normalised record. Manual findFirst → update | create
  // because ResearchOutput's @@unique is (openalexId, facultyMemberId) —
  // not useful for our (scopusId, fmId) and (pmid, fmId) cases. NULL
  // handling on facultyMemberId means unmatched-author rows are
  // distinguished per call; that's the analyst-triage posture from the
  // OpenAlex pathway and we keep it.
  private async upsertOne(rec: NormalizedRecord, runId: string): Promise<void> {
    if (rec.target !== 'research_outputs') {
      throw new Error(`unknown target "${rec.target}"`);
    }
    const p = rec.payload as {
      source: string;
      scopusEid?: string;
      pmid?: string;
      doi: string | null;
      year: number;
      type: 'JOURNAL' | 'CONFERENCE' | 'PATENT' | 'BOOK';
      title: string;
      venue: string | null;
      citations: number;
      // Scopus journal metrics — present on Scopus rows, absent (→ null)
      // on PubMed rows.
      quartile?: number | null;
      citeScorePercentile?: number | null;
      sjr?: number | null;
      facultyMemberId: string | null;
      kkuAuthorName: string | null;
    };
    const where =
      p.source === SOURCE_SCOPUS
        ? { scopusId: p.scopusEid ?? null, facultyMemberId: p.facultyMemberId }
        : { pmid: p.pmid ?? null, facultyMemberId: p.facultyMemberId };
    const existing = await this.db.researchOutput.findFirst({
      where,
      select: { id: true },
    });
    const data = {
      year: p.year,
      type: p.type,
      title: p.title,
      venue: p.venue,
      citations: p.citations,
      doi: p.doi,
      source: p.source,
      // Journal quartile metrics — null on PubMed rows (and on Scopus
      // rows whose journal has no CiteScore record). Written on every
      // upsert so a re-run refreshes the quartile as the mirror's
      // CiteScore data is updated.
      quartile: p.quartile ?? null,
      citeScorePercentile: p.citeScorePercentile ?? null,
      sjr: p.sjr ?? null,
      kkuAuthorName: p.kkuAuthorName,
      ingestionRunId: runId,
      ...(p.source === SOURCE_SCOPUS
        ? { scopusId: p.scopusEid ?? null }
        : { pmid: p.pmid ?? null }),
    };
    if (existing) {
      await this.db.researchOutput.update({
        where: { id: existing.id },
        data,
      });
    } else {
      await this.db.researchOutput.create({
        data: { ...data, facultyMemberId: p.facultyMemberId },
      });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────

function emptyBucket(): SourceBucket {
  return {
    papersFetched: 0,
    authorshipsEmitted: 0,
    match: { matchedByNameEn: 0, matchedByNameTh: 0, unmatched: 0 },
    unmatchedAuthorSamples: [],
    fetchError: null,
  };
}

function tallyResolution(
  bucket: SourceBucket,
  resolution: { matchedBy: 'name_en' | 'name_th' | 'unmatched'; authorDisplayName: string | null },
  paperId: string,
  paperTitle: string,
): void {
  bucket.authorshipsEmitted++;
  if (resolution.matchedBy === 'name_en') bucket.match.matchedByNameEn++;
  else if (resolution.matchedBy === 'name_th') bucket.match.matchedByNameTh++;
  else {
    bucket.match.unmatched++;
    if (bucket.unmatchedAuthorSamples.length < 50) {
      bucket.unmatchedAuthorSamples.push({
        authorName: resolution.authorDisplayName ?? '(no name)',
        paperId,
        paperTitle: paperTitle.slice(0, 120),
      });
    }
  }
}

function bucketSummary(bucket: SourceBucket, sourceTag: string): Record<string, unknown> {
  return {
    source: sourceTag,
    papersFetched: bucket.papersFetched,
    authorshipsEmitted: bucket.authorshipsEmitted,
    match: bucket.match,
    unmatchedAuthorSamples: bucket.unmatchedAuthorSamples,
    fetchError: bucket.fetchError,
  };
}
