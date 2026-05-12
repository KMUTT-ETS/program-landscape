import {
  buildExternalFeedSummaryMessages,
  EXTERNAL_FEED_SUMMARY_VERSION,
  ExternalFeedSummarySchema,
  type AiService,
  type ExternalFeedSummary,
} from '@kku/shared';
import { prisma } from './index';
import type { Prisma, SignalType } from '@prisma/client';

// ─────────────────────────────────────────────────────────────────────────
// External AI source runner (Phase 5 + cron wiring).
//
// Pure-ish function that:
//   1. Loads one ExternalAiSource by id
//   2. Fetches its configured URLs / runs its configured search queries
//   3. AI-summarises each item into a TrendSignal row (deduped against
//      the same source over the last 30 days)
//   4. Updates source.last* metadata
//
// Lives in @kku/db because BOTH apps/api (sync /run-now endpoint) and
// apps/ingestion (cron worker) call it — anything in apps/api can't be
// imported by apps/ingestion and vice versa, so the runner has to sit
// in a shared workspace package. Prisma is already here; the AI
// service handle is passed in from the caller.
// ─────────────────────────────────────────────────────────────────────────

export interface RunExternalAiSourceOptions {
  sourceId: string;
  ai: AiService;
  /** Triggering user — recorded on TrendSignal-producing AiInference rows. */
  userId?: string | null;
  /** Required for WEB_SEARCH-kind sources; ignored for URL_LIST. */
  googleCseApiKey?: string;
  googleCseCx?: string;
  /** Best-effort sink for diagnostic output. */
  logger?: { warn(msg: string): void; error?(msg: string): void };
}

export interface RunExternalAiSourceResult {
  fetched: number;
  summarised: number;
  skipped: number;
  failures: number;
  signals: Array<{ id: string; title: string; impactScore: number }>;
}

export async function runExternalAiSource(
  opts: RunExternalAiSourceOptions,
): Promise<RunExternalAiSourceResult> {
  const source = await prisma.externalAiSource.findUnique({ where: { id: opts.sourceId } });
  if (!source) {
    throw new Error(`ExternalAiSource not found: ${opts.sourceId}`);
  }

  const startedAt = new Date();
  let fetchedCount = 0;
  let summarisedCount = 0;
  let skippedCount = 0;
  let failureCount = 0;
  const createdSignals: RunExternalAiSourceResult['signals'] = [];
  let runError: string | null = null;

  try {
    const items = await fetchItems({
      kind: source.kind,
      configJson: source.configJson,
      googleCseApiKey: opts.googleCseApiKey,
      googleCseCx: opts.googleCseCx,
      logger: opts.logger,
    });
    fetchedCount = items.length;

    for (const item of items) {
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const dup = await prisma.trendSignal.findFirst({
        where: {
          externalAiSourceId: opts.sourceId,
          sourceUrl: item.url,
          createdAt: { gte: cutoff },
        },
        select: { id: true },
      });
      if (dup) {
        skippedCount += 1;
        continue;
      }

      try {
        const summary = await summariseOne({
          ai: opts.ai,
          sourceName: source.name,
          sourceDefaultSignalType: source.signalType,
          sourceDefaultImpact: source.defaultImpact,
          fetchedUrl: item.url,
          rawContent: item.text,
          userId: opts.userId ?? null,
        });
        if (summary == null || summary.confidence < 0.35) {
          skippedCount += 1;
          continue;
        }
        const created = await prisma.trendSignal.create({
          data: {
            signalType: (summary.signalType as SignalType | undefined) ?? source.signalType,
            title: summary.title.slice(0, 500),
            summaryTh: summary.summaryTh,
            summaryEn: summary.summaryEn,
            sourceUrl: item.url,
            detectedDate: new Date(),
            impactScore: summary.impactScore,
            affectedProgramIds: [],
            affectedSkillIds: [],
            externalAiSourceId: opts.sourceId,
          },
        });
        createdSignals.push({
          id: created.id,
          title: created.title,
          impactScore: created.impactScore,
        });
        summarisedCount += 1;
      } catch (err) {
        failureCount += 1;
        opts.logger?.warn?.(
          `external-feed summarise failed for ${item.url}: ${(err as Error).message}`,
        );
      }
    }
  } catch (err) {
    runError = (err as Error).message;
    opts.logger?.error?.(
      `external-feed runNow failed for source ${source.slug}: ${runError}`,
    );
  }

  await prisma.externalAiSource.update({
    where: { id: opts.sourceId },
    data: {
      lastFetchedAt: startedAt,
      lastFetchStatus: runError
        ? 'FAILED'
        : failureCount > 0
          ? 'PARTIAL'
          : fetchedCount === 0
            ? 'EMPTY'
            : 'OK',
      lastFetchError: runError,
      lastSignalCount: summarisedCount,
    },
  });

  if (runError) {
    throw new Error(runError);
  }
  return {
    fetched: fetchedCount,
    summarised: summarisedCount,
    skipped: skippedCount,
    failures: failureCount,
    signals: createdSignals,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────

async function fetchItems(opts: {
  kind: 'URL_LIST' | 'WEB_SEARCH';
  configJson: Prisma.JsonValue;
  googleCseApiKey?: string;
  googleCseCx?: string;
  logger?: { warn(msg: string): void };
}): Promise<Array<{ url: string; text: string }>> {
  if (opts.kind === 'URL_LIST') {
    const urls = readStringArray(opts.configJson, 'urls');
    if (urls.length === 0) throw new Error('URL_LIST source has empty `urls` config.');
    const out: Array<{ url: string; text: string }> = [];
    for (const url of urls) {
      try {
        const text = await fetchAndStrip(url);
        if (text.length > 0) out.push({ url, text });
      } catch (err) {
        opts.logger?.warn(`URL fetch failed for ${url}: ${(err as Error).message}`);
      }
    }
    return out;
  }

  const queries = readStringArray(opts.configJson, 'queries');
  if (queries.length === 0) throw new Error('WEB_SEARCH source has empty `queries` config.');
  const maxResultsPerQuery = readOptionalNumber(opts.configJson, 'maxResultsPerQuery') ?? 5;
  if (!opts.googleCseApiKey || !opts.googleCseCx) {
    throw new Error(
      'WEB_SEARCH requires GOOGLE_CSE_API_KEY + GOOGLE_CSE_CX env vars. Provider not configured.',
    );
  }
  const out: Array<{ url: string; text: string }> = [];
  for (const q of queries) {
    try {
      const items = await googleCseSearch(opts.googleCseApiKey, opts.googleCseCx, q, maxResultsPerQuery);
      for (const it of items) {
        try {
          const text = await fetchAndStrip(it.link);
          if (text.length > 0) out.push({ url: it.link, text });
        } catch (err) {
          opts.logger?.warn(
            `Search-result fetch failed for ${it.link}: ${(err as Error).message}`,
          );
        }
      }
    } catch (err) {
      opts.logger?.warn(`Search failed for query "${q}": ${(err as Error).message}`);
    }
  }
  return out;
}

async function summariseOne(input: {
  ai: AiService;
  sourceName: string;
  sourceDefaultSignalType: SignalType;
  sourceDefaultImpact: number;
  fetchedUrl: string;
  rawContent: string;
  userId: string | null;
}): Promise<ExternalFeedSummary | null> {
  const messages = buildExternalFeedSummaryMessages({
    sourceName: input.sourceName,
    sourceDefaultSignalType: input.sourceDefaultSignalType,
    sourceDefaultImpact: input.sourceDefaultImpact,
    fetchedUrl: input.fetchedUrl,
    fetchedAt: new Date().toISOString(),
    rawContent: input.rawContent,
  });
  try {
    const resp = await input.ai.extractStructured(
      {
        ctx: {
          module: 'external-ai',
          kind: 'external-feed-summary',
          userId: input.userId,
        },
        messages,
        methodVersion: EXTERNAL_FEED_SUMMARY_VERSION,
        maxOutputTokens: 1800,
      },
      ExternalFeedSummarySchema,
    );
    return resp.parsed;
  } catch {
    return null;
  }
}

function readStringArray(json: Prisma.JsonValue, key: string): string[] {
  if (typeof json !== 'object' || json == null || Array.isArray(json)) return [];
  const v = (json as Record<string, unknown>)[key];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && x.length > 0);
}

function readOptionalNumber(json: Prisma.JsonValue, key: string): number | undefined {
  if (typeof json !== 'object' || json == null || Array.isArray(json)) return undefined;
  const v = (json as Record<string, unknown>)[key];
  return typeof v === 'number' ? v : undefined;
}

async function fetchAndStrip(url: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        // Browser-like UA — many sites (OECD, WEF, others behind Akamai/
        // Cloudflare bot-management) block obviously-automated UAs at
        // the CDN layer regardless of intent. We're a research tool
        // doing rate-limited fetches; identifying as Chrome is honest
        // about the fact that we render the page like a browser would.
        'user-agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,application/rss+xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9,th;q=0.6',
        'accept-encoding': 'gzip, deflate, br',
      },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.text();
    return stripHtml(raw).slice(0, 50_000);
  } finally {
    clearTimeout(timer);
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function googleCseSearch(
  apiKey: string,
  cx: string,
  query: string,
  num: number,
): Promise<Array<{ title: string; link: string; snippet: string }>> {
  const params = new URLSearchParams({ key: apiKey, cx, q: query, num: String(Math.min(num, 10)) });
  const res = await fetch(`https://customsearch.googleapis.com/customsearch/v1?${params.toString()}`);
  if (!res.ok) throw new Error(`Google CSE HTTP ${res.status}`);
  const json = (await res.json()) as { items?: Array<{ title: string; link: string; snippet: string }> };
  return json.items ?? [];
}
