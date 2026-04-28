// ─────────────────────────────────────────────────────────────────────────────
// Real KkuResearchConnector — flips kku-research from mock to live.
//
// Wire-up:
//   - OpenAlex (FREE, no API key) is the primary source. Cursor-paginated
//     query for all KKU works ≥ KKU_RESEARCH_YEAR_FROM (default 2015).
//   - Scopus is documented but not yet wired — connector is structured
//     for it; landing the API key is a separate one-line addition.
//   - Author resolution: ORCID > openalexAuthorId > nameEn (lowercased
//     exact) > nameTh (exact). No fuzzy match.
//   - Per (paper × matched KKU author) → one ResearchOutput row.
//     Unmatched-but-KKU-affiliated papers also land (faculty_member_id = NULL)
//     for analyst triage.
//   - Lazy author-ID enrichment: when a paper resolves via name match
//     and has an OpenAlex author ID + ORCID, those get stamped onto
//     the FacultyMember row so subsequent runs match on the stable IDs
//     instead of name strings.
//
// Cadence: quarterly (env CONNECTOR_KKU_RESEARCH_MODE=real). Pagination
// throttled to OpenAlex polite-pool rate (10 req/s) via a tiny await
// between pages; full backfill of ~22k recent KKU works takes ~22 min.
//
// PDPA: only public publication metadata is read. Author names + ORCIDs
// are public per the data subject's act of publishing.
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
  buildFacultyMemberLookup,
  type FacultyMemberLookup,
  kkuAffiliatedAuthors,
  normaliseDoi,
  normaliseOrcid,
  openAlexTypeToOurs,
  OpenAlexWorksResponseSchema,
  type OpenAlexWork,
  resolveFacultyMember,
  tailOf,
} from './transforms';

// ─────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────

const OPENALEX_BASE = 'https://api.openalex.org';
// Verified via `pnpm research:capture openalex-discover` 2026-04-28.
// If KKU's OpenAlex institution ID ever changes (rare but possible),
// override with KKU_OPENALEX_INSTITUTION_ID env.
const DEFAULT_KKU_OPENALEX_ID = 'I179193067';
const DEFAULT_YEAR_FROM = 2015;
const PER_PAGE = 100;
// Polite-pool gives us 10 req/s; we sleep 100ms between pages to stay
// well under the limit and avoid being demoted to anonymous tier.
const POLITE_DELAY_MS = 120;
// Cap pages per run as a safety belt — at 100/page * 1000 pages =
// 100k papers, well above KKU's ~35k total. If we hit this, something
// is wrong upstream.
const MAX_PAGES = 1000;

// ─────────────────────────────────────────────────────────────────────────
// Per-run state
// ─────────────────────────────────────────────────────────────────────────

interface BucketTotals {
  matchedByOrcid: number;
  matchedByOpenalexAuthorId: number;
  matchedByNameEn: number;
  matchedByNameTh: number;
  unmatched: number;
}

interface RunState {
  capturedAt: string;
  fetchTimestamp: Date;
  facultyMemberLookup: FacultyMemberLookup;
  // Author IDs to back-fill onto FacultyMember rows after the run.
  // Map: facultyMemberId → { orcid?, openalexAuthorId? }
  enrichments: Map<string, { orcid?: string; openalexAuthorId?: string }>;
  totals: BucketTotals;
  unmatchedAuthorSamples: Array<{
    authorName: string;
    paperId: string;
    paperTitle: string;
    orcid: string | null;
  }>;
  pagesFetched: number;
  apiTotalCount: number;
}

interface KkuResearchRawWork {
  kind: 'work';
  work: OpenAlexWork;
}

export class KkuResearchRealConnector extends ApiConnector {
  readonly slug = 'kku-research';
  readonly mocked = false;

  private runState?: RunState;

  constructor(private readonly db: PrismaClient = prisma) {
    super();
  }

  // Centralised wrapper so we can attach better error context than the
  // default "fetch failed" — node:undici's TypeError swallows the
  // underlying cause in the message when it's a connection-reset etc.
  private async httpGet(url: string, headers: Record<string, string>): Promise<Response> {
    try {
      return await fetch(url, { headers });
    } catch (err) {
      const cause = (err as Error & { cause?: unknown }).cause;
      const detail =
        cause instanceof Error
          ? `${cause.name}: ${cause.message}`
          : cause === undefined
            ? ''
            : String(cause);
      throw new Error(
        `HTTP GET ${url} failed: ${err instanceof Error ? err.message : String(err)}${detail ? ` (cause: ${detail})` : ''}`,
      );
    }
  }

  override async healthCheck(_ctx: ConnectorContext): Promise<HealthStatus> {
    try {
      // Simple ping — institutions endpoint is the cheapest healthful
      // probe. Doesn't burn rate-limit budget meaningfully.
      const url = `${OPENALEX_BASE}/institutions/${this.kkuInstitutionId()}`;
      const headers = this.openAlexHeaders();
      const res = await this.httpGet(url, headers);
      if (!res.ok) {
        return { ok: false, message: `OpenAlex healthcheck HTTP ${res.status}` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  private kkuInstitutionId(): string {
    return (process.env.KKU_OPENALEX_INSTITUTION_ID ?? DEFAULT_KKU_OPENALEX_ID).trim();
  }

  private openAlexHeaders(): Record<string, string> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    const mailto = process.env.OPENALEX_MAILTO?.trim();
    if (mailto) headers['User-Agent'] = `KKU-Curriculum-Landscape/1.0 (mailto:${mailto})`;
    return headers;
  }

  private mailtoQs(): string {
    const mailto = process.env.OPENALEX_MAILTO?.trim();
    return mailto ? `&mailto=${encodeURIComponent(mailto)}` : '';
  }

  async fetch(ctx: ConnectorContext, _since?: Date): Promise<RawRecord[]> {
    const fetchTimestamp = new Date();
    const capturedAt = fetchTimestamp.toISOString();
    const yearFrom = Number(process.env.KKU_RESEARCH_YEAR_FROM ?? DEFAULT_YEAR_FROM);
    const kkuId = this.kkuInstitutionId();
    if (!Number.isInteger(yearFrom) || yearFrom < 1900 || yearFrom > 2100) {
      throw new NonRetryableError(
        'CONFIG',
        `KKU_RESEARCH_YEAR_FROM out of range: ${process.env.KKU_RESEARCH_YEAR_FROM}`,
      );
    }

    // 1. Snapshot the FacultyMember table for in-memory matching.
    //    ~1k rows is negligible memory; avoids hitting Prisma per author.
    const facultyMembers = await this.db.facultyMember.findMany({
      select: {
        id: true,
        orcid: true,
        openalexAuthorId: true,
        nameEn: true,
        nameTh: true,
      },
    });
    const facultyMemberLookup = buildFacultyMemberLookup(facultyMembers);
    ctx.log.info(
      `loaded ${facultyMembers.length} FacultyMember rows for matching (orcid=${facultyMemberLookup.byOrcid.size}, openalex=${facultyMemberLookup.byOpenalexAuthorId.size})`,
    );

    // 2. Init run state.
    this.runState = {
      capturedAt,
      fetchTimestamp,
      facultyMemberLookup,
      enrichments: new Map(),
      totals: {
        matchedByOrcid: 0,
        matchedByOpenalexAuthorId: 0,
        matchedByNameEn: 0,
        matchedByNameTh: 0,
        unmatched: 0,
      },
      unmatchedAuthorSamples: [],
      pagesFetched: 0,
      apiTotalCount: 0,
    };

    // 3. Cursor-paginated OpenAlex fetch.
    const works: OpenAlexWork[] = [];
    let cursor: string | null = '*';
    let page = 0;
    while (cursor && page < MAX_PAGES) {
      const url =
        `${OPENALEX_BASE}/works` +
        `?filter=${encodeURIComponent(`authorships.institutions.id:${kkuId},publication_year:>${yearFrom - 1}`)}` +
        `&per_page=${PER_PAGE}` +
        `&cursor=${encodeURIComponent(cursor)}` +
        this.mailtoQs();
      if (page === 0) ctx.log.info(`first page url: ${url}`);
      const res = await this.httpGet(url, this.openAlexHeaders());
      if (!res.ok) {
        // 429 = throttled; retry once after a longer pause. Anything
        // else (5xx, schema 4xx) should bubble up to the runner so
        // BullMQ retries (or NonRetryableError stops it).
        if (res.status === 429) {
          ctx.log.warn(`OpenAlex 429 on page ${page + 1}; backing off 5s and retrying once`);
          await sleep(5000);
          const retry = await this.httpGet(url, this.openAlexHeaders());
          if (!retry.ok) {
            throw new Error(`OpenAlex 429 persisted on page ${page + 1}`);
          }
          const json = await retry.json();
          const parsed = OpenAlexWorksResponseSchema.safeParse(json);
          if (!parsed.success) {
            throw new NonRetryableError(
              'OPENALEX_VALIDATION',
              `page ${page + 1} schema mismatch: ${parsed.error.message}`,
            );
          }
          works.push(...parsed.data.results);
          cursor = parsed.data.meta.next_cursor ?? null;
          this.runState.apiTotalCount = parsed.data.meta.count;
        } else {
          throw new Error(`OpenAlex HTTP ${res.status} on page ${page + 1}`);
        }
      } else {
        const json = await res.json();
        const parsed = OpenAlexWorksResponseSchema.safeParse(json);
        if (!parsed.success) {
          throw new NonRetryableError(
            'OPENALEX_VALIDATION',
            `page ${page + 1} schema mismatch: ${parsed.error.message}`,
          );
        }
        works.push(...parsed.data.results);
        cursor = parsed.data.meta.next_cursor ?? null;
        this.runState.apiTotalCount = parsed.data.meta.count;
      }
      page++;
      this.runState.pagesFetched = page;
      if (page % 10 === 0) {
        ctx.log.info(`OpenAlex page ${page}: ${works.length.toLocaleString()} works fetched of ~${this.runState.apiTotalCount.toLocaleString()}`);
      }
      if (cursor) await sleep(POLITE_DELAY_MS);
    }
    ctx.log.info(
      `OpenAlex done: ${works.length.toLocaleString()} works in ${page} pages`,
    );
    if (page >= MAX_PAGES) {
      ctx.log.warn(
        `hit MAX_PAGES safety cap (${MAX_PAGES}); fetched ${works.length}/${this.runState.apiTotalCount}`,
      );
    }

    // 4. Emit one RawRecord per work.
    return works.map((work) => ({
      externalId: `kku-research:openalex:${tailOf(work.id) ?? work.id}`,
      sourceTimestamp: fetchTimestamp,
      data: { kind: 'work', work } satisfies KkuResearchRawWork,
    }));
  }

  async transform(
    _ctx: ConnectorContext,
    raw: RawRecord,
  ): Promise<NormalizedRecord[]> {
    const state = this.runState;
    if (!state) {
      throw new Error('transform() called before fetch() — connector lifecycle violated');
    }
    const data = raw.data as KkuResearchRawWork;
    const work = data.work;
    const kkuId = this.kkuInstitutionId();

    const openalexId = tailOf(work.id);
    if (!openalexId) return [];

    const kkuAuthors = kkuAffiliatedAuthors(work, kkuId);
    if (kkuAuthors.length === 0) return [];

    const baseTitle = (work.title ?? work.display_name ?? '(untitled)').trim();
    const venue = work.primary_location?.source?.display_name?.trim() ?? null;
    const year = work.publication_year ?? null;
    if (!year) {
      // Skip works missing publication_year — Prisma column is NOT NULL.
      return [];
    }

    const records: NormalizedRecord[] = [];
    const seenAuthorIds = new Set<string>();
    let producedAtLeastOne = false;

    for (const author of kkuAuthors) {
      const resolution = resolveFacultyMember(author, state.facultyMemberLookup);
      const facultyMemberId = resolution.facultyMemberId;
      // Avoid duplicate rows when the same FacultyMember is somehow
      // listed twice on a paper (rare but happens with corrigenda).
      const dedupKey = facultyMemberId ?? `unmatched:${author.displayName ?? '(no name)'}`;
      if (seenAuthorIds.has(dedupKey)) continue;
      seenAuthorIds.add(dedupKey);

      // Tally.
      if (resolution.matchedBy === 'orcid') state.totals.matchedByOrcid++;
      else if (resolution.matchedBy === 'openalex_author_id') state.totals.matchedByOpenalexAuthorId++;
      else if (resolution.matchedBy === 'name_en') state.totals.matchedByNameEn++;
      else if (resolution.matchedBy === 'name_th') state.totals.matchedByNameTh++;
      else {
        state.totals.unmatched++;
        if (state.unmatchedAuthorSamples.length < 50) {
          state.unmatchedAuthorSamples.push({
            authorName: author.displayName ?? '(no name)',
            paperId: openalexId,
            paperTitle: baseTitle.slice(0, 120),
            orcid: author.orcid,
          });
        }
      }

      // Lazy author-ID enrichment: if we matched via name, schedule
      // an update on the FacultyMember row to stamp ORCID +
      // openalex_author_id for next run's faster lookup.
      if (
        facultyMemberId &&
        (resolution.matchedBy === 'name_en' || resolution.matchedBy === 'name_th') &&
        (author.orcid || author.authorId)
      ) {
        const existing = state.enrichments.get(facultyMemberId) ?? {};
        if (author.orcid && !existing.orcid) existing.orcid = author.orcid;
        if (author.authorId && !existing.openalexAuthorId) existing.openalexAuthorId = author.authorId;
        state.enrichments.set(facultyMemberId, existing);
      }

      records.push({
        target: 'research_outputs',
        externalId: `research_output:${openalexId}:${facultyMemberId ?? 'unmatched'}:${dedupKey}`,
        payload: {
          openalexId,
          facultyMemberId,
          year,
          type: openAlexTypeToOurs(work.type),
          title: baseTitle,
          venue,
          citations: work.cited_by_count ?? 0,
          doi: normaliseDoi(work.doi),
          source: 'openalex',
          kkuAuthorName: author.displayName,
        },
        freshnessDate: state.fetchTimestamp,
      });
      producedAtLeastOne = true;
    }

    return producedAtLeastOne ? records : [];
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

    for (const rec of normalized) {
      if (rec.target !== 'research_outputs') {
        ctx.log.warn(`unknown target "${rec.target}", skipping`);
        failed++;
        continue;
      }
      const p = rec.payload as {
        openalexId: string;
        facultyMemberId: string | null;
        year: number;
        type: 'JOURNAL' | 'CONFERENCE' | 'PATENT' | 'BOOK';
        title: string;
        venue: string | null;
        citations: number;
        doi: string | null;
        source: string;
        kkuAuthorName: string | null;
      };
      try {
        // Manual upsert via findFirst because the compound unique
        // (openalexId, facultyMemberId) carries a NULL in the
        // unmatched case and Postgres treats NULL ≠ NULL on unique
        // indexes (Prisma's compound where can't accept null).
        const existing = await this.db.researchOutput.findFirst({
          where: {
            openalexId: p.openalexId,
            facultyMemberId: p.facultyMemberId,
          },
          select: { id: true },
        });
        if (existing) {
          await this.db.researchOutput.update({
            where: { id: existing.id },
            data: {
              year: p.year,
              type: p.type,
              title: p.title,
              venue: p.venue,
              citations: p.citations,
              doi: p.doi,
              source: p.source,
              kkuAuthorName: p.kkuAuthorName,
            },
          });
        } else {
          await this.db.researchOutput.create({
            data: {
              openalexId: p.openalexId,
              facultyMemberId: p.facultyMemberId,
              year: p.year,
              type: p.type,
              title: p.title,
              venue: p.venue,
              citations: p.citations,
              doi: p.doi,
              source: p.source,
              kkuAuthorName: p.kkuAuthorName,
            },
          });
        }
        loaded++;
      } catch (err) {
        failed++;
        ctx.log.error(
          `failed to load ${rec.target}/${rec.externalId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Lazy author-ID back-fill on FacultyMember. Only stamps when the
    // target column is currently NULL — never overwrites an existing
    // value (could differ across name variants).
    let enrichmentsApplied = 0;
    for (const [facultyMemberId, info] of state.enrichments) {
      try {
        await this.db.facultyMember.updateMany({
          where: {
            id: facultyMemberId,
            ...(info.orcid ? { orcid: null } : {}),
          },
          data: { ...(info.orcid ? { orcid: info.orcid } : {}) },
        });
        if (info.openalexAuthorId) {
          await this.db.facultyMember.updateMany({
            where: { id: facultyMemberId, openalexAuthorId: null },
            data: { openalexAuthorId: info.openalexAuthorId },
          });
        }
        enrichmentsApplied++;
      } catch (err) {
        // Best-effort; an enrichment failure shouldn't fail the run.
        ctx.log.warn(
          `enrichment for FacultyMember ${facultyMemberId} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return {
      recordsFetched: normalized.length,
      recordsLoaded: loaded,
      recordsFailed: failed,
      metadata: {
        connectorMode: 'real',
        capturedAt: state.capturedAt,
        openAlexInstitutionId: this.kkuInstitutionId(),
        yearFrom: Number(process.env.KKU_RESEARCH_YEAR_FROM ?? DEFAULT_YEAR_FROM),
        pagesFetched: state.pagesFetched,
        apiTotalCount: state.apiTotalCount,
        worksFetched: normalized.length === 0 ? 0 : Math.max(...[normalized.length, 0]),
        matchTotals: state.totals,
        enrichmentsApplied,
        unmatchedAuthorSamples: state.unmatchedAuthorSamples,
        notes:
          'kku-research.v1: OpenAlex-only (free, no API key). Scopus enrichment Q2 deferred until KKU_SCOPUS_API_KEY lands. ' +
          'Author resolution: ORCID > openalex_author_id > nameEn (lowercased exact) > nameTh (exact). No fuzzy match.',
      },
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
