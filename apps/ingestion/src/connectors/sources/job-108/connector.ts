// ─────────────────────────────────────────────────────────────────────────────
// Job108Connector — Thai government and state-enterprise recruitment
// announcements from job-108.com.
//
// Discovery is the sitemap, not `now.html`: the sitemap is the complete
// dated list (2,000+ entries reaching back over a year), whereas `now.html`
// is a 30-item slice of currently-open posts. A sitemap that cannot be read
// fails the run outright — without it there is nothing to do, mirroring the
// "both sources failed" hard-stop in kku-research's fetch().
//
// Per-page failure isolation follows kku-research: one announcement's
// failure to fetch or extract is recorded against ITS OWN row via
// recordJob108Failure and the run continues — a single withdrawn posting,
// news item, or transient model hiccup must not sink 20-odd otherwise-good
// announcements in the same weekly run.
//
// No scraping proxy: fetch.ts identifies honestly as KKU and never requests
// /go.php or /url.php, the two paths robots.txt disallows for every agent.
// ─────────────────────────────────────────────────────────────────────────────

import {
  PUBLIC_DEMAND_SOURCE,
  parseSitemap,
  type Connector,
  type ConnectorContext,
  type DataSourceInputFormat,
  type HealthStatus,
  type LoadResult,
  type NormalizedRecord,
  type RawRecord,
  type SitemapEntry,
} from '@kku/shared';
import {
  heldAnnouncementLastmods,
  hashPage,
  planJob108Fetch,
  recordJob108Failure,
  toPostingRows,
  upsertJob108Announcement,
} from '@kku/db';

import { extractAnnouncement } from '../../../job108/extract';
import { fetchJob108Page, fetchJob108PagePolitely, job108SitemapUrl } from '../../../job108/fetch';
import { createIngestionAiService } from '../../../lib/ai-service';

/** Cap on one scheduled run. The steady state is ~22; the cap stops a
 *  sitemap anomaly from turning a weekly run into a 2,000-page backfill.
 *  A dedicated backfill path raises it deliberately, via the constructor
 *  argument, when one is needed. */
const DEFAULT_MAX_ANNOUNCEMENTS_PER_RUN = 60;

interface Job108SitemapPayload {
  announcementId: string;
  url: string;
  lastmod: Date;
}

export class Job108Connector implements Connector {
  readonly slug = PUBLIC_DEMAND_SOURCE;
  readonly mocked = false;
  readonly inputFormat: DataSourceInputFormat = 'HTML';

  constructor(private readonly maxPerRun: number = DEFAULT_MAX_ANNOUNCEMENTS_PER_RUN) {}

  async healthCheck(_ctx: ConnectorContext): Promise<HealthStatus> {
    try {
      const xml = await fetchJob108Page(job108SitemapUrl());
      const entries = parseSitemap(xml);
      return entries.length > 0
        ? { ok: true, message: `sitemap reachable, ${entries.length} announcements` }
        : { ok: false, message: 'sitemap reachable but contained no announcement pages' };
    } catch (err: unknown) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Discovery only. Failing to read the sitemap fails the run — without it
   * there is nothing to do. An individual page's failure does not, and is
   * recorded against its announcement row in load() instead.
   */
  async fetch(ctx: ConnectorContext, _since?: Date): Promise<RawRecord[]> {
    const xml = await fetchJob108Page(job108SitemapUrl());
    const entries: SitemapEntry[] = parseSitemap(xml);
    const held = await heldAnnouncementLastmods();
    const due = planJob108Fetch(entries, held, this.maxPerRun);
    ctx.log.info('job-108 discovery', {
      inSitemap: entries.length,
      alreadyHeld: held.size,
      due: due.length,
    });
    return due.map((e) => ({
      externalId: e.announcementId,
      data: { announcementId: e.announcementId, url: e.url, lastmod: e.lastmod } satisfies Job108SitemapPayload,
      sourceTimestamp: e.lastmod,
    }));
  }

  async transform(_ctx: ConnectorContext, raw: RawRecord): Promise<NormalizedRecord[]> {
    const entry = raw.data as Job108SitemapPayload;
    return [
      {
        target: 'job108_announcements',
        externalId: entry.announcementId,
        payload: { url: entry.url, lastmod: entry.lastmod },
        freshnessDate: entry.lastmod,
      },
    ];
  }

  async load(ctx: ConnectorContext, normalized: NormalizedRecord[]): Promise<LoadResult> {
    const ai = createIngestionAiService();
    let loaded = 0;
    let failed = 0;
    let postingsWritten = 0;
    let announcementsWithNoPositions = 0;

    for (const rec of normalized) {
      const url = String(rec.payload.url);
      const lastmod = rec.payload.lastmod as Date;
      // Hash starts empty so a failure before the fetch even lands can still
      // record a row — recordJob108Failure requires a contentHash, and
      // "failed before we had bytes" is a real, distinguishable state.
      let contentHash = '';
      try {
        const html = await fetchJob108PagePolitely(url);
        contentHash = hashPage(html);
        const extracted = await extractAnnouncement(ai, { announcementId: rec.externalId, html });
        if (extracted.positions.length === 0) announcementsWithNoPositions++;
        const rows = toPostingRows(extracted.header, extracted.positions);
        const result = await upsertJob108Announcement({
          announcementId: rec.externalId,
          url,
          contentHash,
          title: extracted.title,
          header: extracted.header,
          applicationOpenDate: extracted.applicationOpenDate,
          sourceLastmod: lastmod,
          rows,
          runId: ctx.runId,
        });
        postingsWritten += result.postingsWritten;
        loaded++;
      } catch (err: unknown) {
        failed++;
        const message = err instanceof Error ? err.message : String(err);
        ctx.log.warn('job-108 announcement failed', { announcementId: rec.externalId, message });
        await recordJob108Failure({
          announcementId: rec.externalId,
          url,
          contentHash: contentHash === '' ? `failed:${rec.externalId}` : contentHash,
          sourceLastmod: lastmod,
          error: message,
          runId: ctx.runId,
        });
      }
    }

    return {
      recordsFetched: normalized.length,
      recordsLoaded: loaded,
      recordsFailed: failed,
      metadata: { postingsWritten, announcementsWithNoPositions },
    };
  }
}
