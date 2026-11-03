// ─────────────────────────────────────────────────────────────────────────────
// OpenAlex publications — every work whose authorships list this
// institution, pulled by the institution id on the organisation profile.
//
//   - Needs the institution id (admin/organization) and a free OpenAlex API
//     key (OPENALEX_API_KEY): without a key the cursor budget is tiny. With
//     either missing the run is SKIPPED with the reason, nothing is fetched.
//   - Author match is exact only — ORCID, OpenAlex author id, English name,
//     Thai name — and a name shared by two staff is left unmatched.
//   - One research_outputs row per (work, matched author); unmatched
//     institution authors land with faculty_member_id NULL for triage.
//   - A row the spreadsheet import (or any source) already holds for the same
//     person and DOI is enriched (openalex id, citations raised, never
//     lowered), not duplicated, and keeps its own provenance.
//   - Name matches write the author's ORCID / OpenAlex id back to the staff
//     row, only into a null column no other staff member holds (both are
//     unique).
//
// PDPA: only public bibliographic metadata is read; author names and ORCIDs
// are public by the act of publishing.
// ─────────────────────────────────────────────────────────────────────────────

import { prisma, type PrismaClient } from '@kku/db';
import {
  getInstitution,
  outboundUserAgent,
  type ConnectorContext,
  type HealthStatus,
  type LoadResult,
  type NormalizedRecord,
  type RawRecord,
} from '@kku/shared';

import { ApiConnector } from '../../base/api-connector';
import { NonRetryableError } from '../../base/base-connector';
import {
  OpenAlexWorksResponseSchema,
  buildStaffLookup,
  institutionAuthors,
  normaliseDoi,
  openAlexTypeToOurs,
  resolveStaff,
  tailOf,
  type OpenAlexWork,
  type OutputType,
  type StaffLookup,
} from './transforms';

const OPENALEX_BASE = 'https://api.openalex.org';
const DEFAULT_YEAR_FROM = 2015;
const PER_PAGE = 200;
const PAGE_DELAY_MS = 120;
const MAX_PAGES = 500; // 100k works; beyond that something is wrong upstream.

/** Why a run cannot start, or null when it can. Exported for tests. */
export function openAlexSkipReason(
  institutionId: string | null | undefined,
  apiKey: string | undefined,
): string | null {
  if (!institutionId) {
    return 'OpenAlex institution ID is not set. Add it at /admin/organization (find it at openalex.org by searching your university).';
  }
  if (!apiKey?.trim()) {
    return 'OPENALEX_API_KEY is not set. Create a free key at https://openalex.org/settings/api and add it to the environment.';
  }
  return null;
}

interface RunState {
  fetchedAt: Date;
  lookup: StaffLookup;
  institutionId: string;
  enrichments: Map<string, { orcid?: string; openalexAuthorId?: string }>;
  totals: Record<string, number>;
  unmatchedSamples: Array<{ authorName: string; workId: string; title: string }>;
  pagesFetched: number;
  apiTotalCount: number;
}

interface WorkRaw {
  work: OpenAlexWork;
}

interface OutputPayload {
  openalexId: string;
  facultyMemberId: string | null;
  year: number;
  type: OutputType;
  title: string;
  venue: string | null;
  citations: number;
  doi: string | null;
  kkuAuthorName: string | null;
}

function redact(url: string): string {
  return url.replace(/api_key=[^&]*/, 'api_key=***');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class OpenAlexWorksConnector extends ApiConnector {
  readonly slug = 'openalex-works';
  readonly mocked = false;

  private runState?: RunState;

  constructor(
    private readonly db: PrismaClient = prisma,
    private readonly pageDelayMs: number = PAGE_DELAY_MS,
  ) {
    super();
  }

  private skipReason(): string | null {
    return openAlexSkipReason(getInstitution().openalexInstitutionId, process.env.OPENALEX_API_KEY);
  }

  private async httpGet(url: string): Promise<Response> {
    try {
      return await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': outboundUserAgent() },
      });
    } catch (err) {
      const cause = (err as Error & { cause?: unknown }).cause;
      const detail = cause instanceof Error ? `${cause.name}: ${cause.message}` : cause === undefined ? '' : String(cause);
      throw new Error(
        `HTTP GET ${redact(url)} failed: ${err instanceof Error ? err.message : String(err)}${detail ? ` (cause: ${detail})` : ''}`,
      );
    }
  }

  /** kku-research (the publication mirror) already fills research_outputs on KKU installs. */
  private async overlapReason(): Promise<string | null> {
    const runs = await this.db.ingestionRun.count({
      where: { status: 'SUCCEEDED', dataSource: { slug: 'kku-research' } },
    });
    return runs > 0
      ? 'kku-research is live on this install; its publication mirror already fills research_outputs.'
      : null;
  }

  override async healthCheck(_ctx: ConnectorContext): Promise<HealthStatus> {
    const reason = this.skipReason() ?? (await this.overlapReason());
    if (reason) return { ok: false, message: reason };
    try {
      const id = getInstitution().openalexInstitutionId;
      const key = encodeURIComponent(process.env.OPENALEX_API_KEY!.trim());
      const res = await this.httpGet(`${OPENALEX_BASE}/institutions/${id}?api_key=${key}`);
      return res.ok ? { ok: true } : { ok: false, message: `OpenAlex healthcheck HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  async fetch(ctx: ConnectorContext, _since?: Date): Promise<RawRecord[]> {
    const reason = this.skipReason() ?? (await this.overlapReason());
    if (reason) throw new NonRetryableError('CONFIG', reason);
    const institutionId = getInstitution().openalexInstitutionId!;
    const apiKey = process.env.OPENALEX_API_KEY!.trim();

    const rawYear = process.env.OPENALEX_YEAR_FROM?.trim();
    const yearFrom = rawYear ? Number(rawYear) : DEFAULT_YEAR_FROM;
    if (!Number.isInteger(yearFrom) || yearFrom < 1900 || yearFrom > 2100) {
      throw new NonRetryableError('CONFIG', `OPENALEX_YEAR_FROM out of range: ${rawYear}`);
    }

    const staff = await this.db.facultyMember.findMany({
      select: { id: true, orcid: true, openalexAuthorId: true, nameEn: true, nameTh: true },
    });
    const fetchedAt = new Date();
    this.runState = {
      fetchedAt,
      lookup: buildStaffLookup(staff),
      institutionId,
      enrichments: new Map(),
      totals: { orcid: 0, openalex_author_id: 0, name_en: 0, name_th: 0, ambiguous: 0, unmatched: 0 },
      unmatchedSamples: [],
      pagesFetched: 0,
      apiTotalCount: 0,
    };
    ctx.log.info(`loaded ${staff.length} staff rows for matching`);

    const works: OpenAlexWork[] = [];
    let cursor: string | null = '*';
    let page = 0;
    while (cursor && page < MAX_PAGES) {
      const url =
        `${OPENALEX_BASE}/works` +
        `?filter=${encodeURIComponent(`authorships.institutions.id:${institutionId},publication_year:>${yearFrom - 1}`)}` +
        `&per-page=${PER_PAGE}` +
        `&cursor=${encodeURIComponent(cursor)}` +
        `&api_key=${encodeURIComponent(apiKey)}`;
      if (page === 0) ctx.log.info(`first page url: ${redact(url)}`);

      let res = await this.httpGet(url);
      if (res.status === 429) {
        ctx.log.warn(`OpenAlex 429 on page ${page + 1}; backing off and retrying once`);
        await sleep(Math.max(this.pageDelayMs * 40, 0));
        res = await this.httpGet(url);
        if (res.status === 429) throw new Error(`OpenAlex 429 persisted on page ${page + 1}`);
      }
      if (!res.ok) throw new Error(`OpenAlex HTTP ${res.status} on page ${page + 1}`);

      const parsed = OpenAlexWorksResponseSchema.safeParse(await res.json());
      if (!parsed.success) {
        throw new NonRetryableError('OPENALEX_VALIDATION', `page ${page + 1} schema mismatch: ${parsed.error.message}`);
      }
      works.push(...parsed.data.results);
      cursor = parsed.data.meta.next_cursor ?? null;
      this.runState.apiTotalCount = parsed.data.meta.count;
      page++;
      this.runState.pagesFetched = page;
      if (cursor) await sleep(this.pageDelayMs);
    }
    if (page >= MAX_PAGES) ctx.log.warn(`hit MAX_PAGES (${MAX_PAGES}); fetched ${works.length}/${this.runState.apiTotalCount}`);

    return works.map((work) => ({
      externalId: `openalex-works:${tailOf(work.id) ?? work.id}`,
      sourceTimestamp: fetchedAt,
      data: { work } satisfies WorkRaw,
    }));
  }

  async transform(_ctx: ConnectorContext, raw: RawRecord): Promise<NormalizedRecord[]> {
    const state = this.runState;
    if (!state) throw new Error('transform() called before fetch() — connector lifecycle violated');
    const { work } = raw.data as WorkRaw;

    const openalexId = tailOf(work.id);
    const year = work.publication_year ?? null;
    if (!openalexId || !year) return [];

    const authors = institutionAuthors(work, state.institutionId);
    const title = (work.title ?? work.display_name ?? '(untitled)').trim();
    const venue = work.primary_location?.source?.display_name?.trim() || null;
    const doi = normaliseDoi(work.doi);

    const records: NormalizedRecord[] = [];
    const seen = new Set<string>();
    for (const author of authors) {
      const { facultyMemberId, matchedBy } = resolveStaff(author, state.lookup);
      const dedupKey = facultyMemberId ?? `unmatched:${author.displayName ?? '(no name)'}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);

      state.totals[matchedBy] = (state.totals[matchedBy] ?? 0) + 1;
      if (facultyMemberId === null && state.unmatchedSamples.length < 50) {
        state.unmatchedSamples.push({
          authorName: author.displayName ?? '(no name)',
          workId: openalexId,
          title: title.slice(0, 120),
        });
      }

      if (facultyMemberId && (matchedBy === 'name_en' || matchedBy === 'name_th') && (author.orcid || author.authorId)) {
        const held = state.enrichments.get(facultyMemberId) ?? {};
        if (author.orcid && !held.orcid) held.orcid = author.orcid;
        if (author.authorId && !held.openalexAuthorId) held.openalexAuthorId = author.authorId;
        state.enrichments.set(facultyMemberId, held);
      }

      const payload: OutputPayload = {
        openalexId,
        facultyMemberId,
        year,
        type: openAlexTypeToOurs(work.type),
        title,
        venue,
        citations: work.cited_by_count ?? 0,
        doi,
        kkuAuthorName: author.displayName,
      };
      records.push({
        target: 'research_outputs',
        externalId: `research_output:${openalexId}:${dedupKey}`,
        payload: payload as unknown as Record<string, unknown>,
        freshnessDate: state.fetchedAt,
      });
    }
    return records;
  }

  async load(ctx: ConnectorContext, normalized: NormalizedRecord[]): Promise<LoadResult> {
    const state = this.runState;
    if (!state) throw new Error('load() called before fetch() — connector lifecycle violated');
    let loaded = 0;
    let failed = 0;
    let enrichedExisting = 0;

    for (const rec of normalized) {
      const p = rec.payload as unknown as OutputPayload;
      try {
        if (await this.writeOutput(p, ctx.runId)) enrichedExisting++;
        loaded++;
      } catch (err) {
        failed++;
        ctx.log.error(`failed to load ${rec.externalId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    let enrichmentsApplied = 0;
    for (const [facultyMemberId, info] of state.enrichments) {
      try {
        if (await this.writeBackIds(facultyMemberId, info)) enrichmentsApplied++;
      } catch (err) {
        ctx.log.warn(`id write-back for ${facultyMemberId} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return {
      recordsFetched: normalized.length,
      recordsLoaded: loaded,
      recordsFailed: failed,
      metadata: {
        connectorMode: 'real',
        institutionId: state.institutionId,
        pagesFetched: state.pagesFetched,
        apiTotalCount: state.apiTotalCount,
        matchTotals: state.totals,
        enrichedExistingRows: enrichedExisting,
        idWriteBacks: enrichmentsApplied,
        unmatchedAuthorSamples: state.unmatchedSamples,
      },
    };
  }

  /** Returns true when an existing row of another source was enriched. */
  private async writeOutput(p: OutputPayload, runId: string): Promise<boolean> {
    // A row already holding this work for this person: refresh it.
    const own = await this.db.researchOutput.findFirst({
      where: { openalexId: p.openalexId, facultyMemberId: p.facultyMemberId, ...(p.facultyMemberId ? {} : { kkuAuthorName: p.kkuAuthorName }) },
      select: { id: true, source: true, citations: true },
    });
    if (own) {
      if (own.source !== 'openalex') {
        // A row another source wrote that an earlier run enriched: raise the
        // citation count and touch nothing else (title, provenance, source).
        if (p.citations > own.citations) {
          await this.db.researchOutput.update({ where: { id: own.id }, data: { citations: p.citations } });
        }
        return false;
      }
      await this.db.researchOutput.update({
        where: { id: own.id },
        data: {
          year: p.year, type: p.type, title: p.title, venue: p.venue,
          citations: Math.max(p.citations, own.citations),
          doi: p.doi, kkuAuthorName: p.kkuAuthorName, ingestionRunId: runId,
        },
      });
      return false;
    }

    // Same person, same DOI, any source: enrich, never duplicate.
    if (p.facultyMemberId && p.doi) {
      const existing = await this.db.researchOutput.findFirst({
        where: { facultyMemberId: p.facultyMemberId, doi: { equals: p.doi, mode: 'insensitive' } },
        select: { id: true, openalexId: true, citations: true },
        orderBy: { createdAt: 'asc' },
      });
      if (existing) {
        await this.db.researchOutput.update({
          where: { id: existing.id },
          data: {
            ...(existing.openalexId === null ? { openalexId: p.openalexId } : {}),
            ...(p.citations > existing.citations ? { citations: p.citations } : {}),
          },
        });
        return true;
      }
    }

    await this.db.researchOutput.create({
      data: {
        openalexId: p.openalexId, facultyMemberId: p.facultyMemberId, year: p.year, type: p.type,
        title: p.title, venue: p.venue, citations: p.citations, doi: p.doi,
        source: 'openalex', kkuAuthorName: p.kkuAuthorName, ingestionRunId: runId,
      },
    });
    return false;
  }

  /** Writes ORCID / OpenAlex id into null columns no one else holds. */
  private async writeBackIds(
    facultyMemberId: string,
    info: { orcid?: string; openalexAuthorId?: string },
  ): Promise<boolean> {
    let wrote = false;
    if (info.orcid) {
      const holder = await this.db.facultyMember.findFirst({ where: { orcid: info.orcid }, select: { id: true } });
      if (!holder) {
        const r = await this.db.facultyMember.updateMany({ where: { id: facultyMemberId, orcid: null }, data: { orcid: info.orcid } });
        wrote ||= r.count > 0;
      }
    }
    if (info.openalexAuthorId) {
      const holder = await this.db.facultyMember.findFirst({
        where: { openalexAuthorId: info.openalexAuthorId }, select: { id: true },
      });
      if (!holder) {
        const r = await this.db.facultyMember.updateMany({
          where: { id: facultyMemberId, openalexAuthorId: null }, data: { openalexAuthorId: info.openalexAuthorId },
        });
        wrote ||= r.count > 0;
      }
    }
    return wrote;
  }
}
