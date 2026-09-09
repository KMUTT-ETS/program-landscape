// ────────────────────────────────────────────────────────────────────────────
// ScrapingBee client helper — Google Scholar on-demand fetch.
//
// Used by:
//   - the SCHOLAR_FETCH ai-jobs handler in apps/ingestion, which hands the
//     page fetcher to the runner (packages/db/src/scholar-fetch.ts)
//   - the synchronous profile-bind endpoint in apps/api, which needs one
//     live page to verify the profile's name before it will link it
//
// It lives in `packages/shared` rather than in either app precisely because
// BOTH need it: apps/api has no dependency on apps/ingestion (api produces
// BullMQ jobs, ingestion consumes them), so a client that only one of them
// could import would force the bind to become an asynchronous poll for no
// reason. Nothing here touches a node builtin — `fetch` and `URL` only — so
// it is safe inside the @kku/shared barrel, which Next.js client components
// import from.
//
// ScrapingBee is a paid scraping proxy: we ask it to fetch a Google Scholar
// URL on our behalf so the request originates from ScrapingBee's rotating
// IP pool rather than KKU's. See docs/superpowers/specs/2026-09-08-google-scholar-on-demand-design.md.
//
// Shape follows oracle-client.ts: env-driven config, one job per call
// (one target URL in, one page out), explicit typed errors, no hidden
// retries beyond the single documented transient retry.
//
// `render_js=false` is deliberate, not an oversight: Scholar's HTML is
// server-rendered — there is no client-side hydration step that needs a
// headless browser. ScrapingBee bills JS rendering at ~5x the credit cost
// of a plain fetch, and turning it on here would buy nothing but a bigger
// bill. Leave it false unless a future Scholar layout change proves
// otherwise.
// ────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';

const DEFAULT_BASE_URL = 'https://app.scrapingbee.com/api/v1/';
const DEFAULT_TIMEOUT_MS = 30_000;

// HTTP statuses ScrapingBee (or the upstream it proxies) can return that are
// worth one retry: rate limiting and server-side failures. Anything else
// that isn't 2xx/401/403/402 is treated as a deterministic failure.
const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504]);

/**
 * ScrapingBee credits billed per Google page fetch.
 *
 * Google pages require `custom_google=true` (see buildRequestUrl), and that
 * carries its own price: ScrapingBee's docs quote 20 credits, the live API
 * billed **15** on every Scholar request measured on 2026-09-08 (profile page
 * and author search alike, with and without `render_js=false`, with and
 * without `premium_proxy`). 15 is what the `Spb-Cost` response header
 * actually reported, so 15 is what the estimator uses — and every run records
 * its real `Spb-Cost` in `ScholarFetchRun.creditsUsed`, so a drift between
 * this constant and reality is visible in the ledger rather than silent.
 *
 * This is NOT 1. A "select all" across a faculty is real money: at 15 credits
 * a page, the 250k-credit monthly plan is ~16,600 page fetches, and the admin
 * console's bulk confirmation must price a run with this number before
 * anything is enqueued.
 */
export const GOOGLE_PAGE_CREDIT_COST = 15;

/**
 * ScrapingBee credits billed per Google Scholar **search** (`/scholar?q=`).
 *
 * A search additionally needs `stealth_proxy=true` (see buildRequestUrl) and
 * that is what makes it five times the price of a profile page. Measured on
 * **2026-09-09 against our own account**: 75. The reference implementation
 * this design is taken from measured 50 on its account, and ScrapingBee's
 * published price for stealth is 75 — ours bills the published number, so use
 * 75 and do not "correct" it down to the reference's figure.
 *
 * Like GOOGLE_PAGE_CREDIT_COST this is a PRE-FLIGHT ESTIMATE only. The
 * authoritative number for any individual call is the `Spb-Cost` response
 * header, which every run records in `ScholarFetchRun.creditsUsed` — so drift
 * between this constant and reality shows up in the ledger rather than
 * silently mispricing every future run.
 *
 * The 5x gap is the whole reason the transport branches instead of sending
 * stealth everywhere: a bound person's routine sync is profile pages only, and
 * paying 75 for each of those would be 60 credits per page for nothing.
 */
export const GOOGLE_SEARCH_CREDIT_COST = 75;

/**
 * Which kind of Scholar page a target URL is, which decides both the flags
 * sent and the price paid.
 */
export type ScrapingBeeRequestKind = 'profile' | 'search';

/**
 * Classify a Scholar target URL.
 *
 * Derived from the URL rather than passed in by the caller on purpose: the
 * flags MUST match the page actually being fetched, and a parameter can be
 * passed wrongly (silently, at every call site, forever). The URL cannot
 * disagree with itself.
 *
 * `/citations` — a profile page — is the narrow case; everything else defaults
 * to `search`. That default is the safe direction: an unrecognised URL sent
 * WITH stealth costs 60 extra credits, while one sent WITHOUT it comes back as
 * the silent HTTP-500-hiding-a-403 that this whole branch exists to avoid.
 *
 * A malformed URL is classified as `search` too — it will fail at fetch time
 * either way, and this function must not be the thing that throws.
 */
export function classifyScrapingBeeRequest(targetUrl: string): ScrapingBeeRequestKind {
  try {
    return new URL(targetUrl).pathname.includes('/citations') ? 'profile' : 'search';
  } catch {
    return 'search';
  }
}

/**
 * Pre-flight credit estimate for one page of the given kind. Same caveat as
 * the constants: `Spb-Cost` is authoritative per call.
 */
export function creditCostForRequestKind(kind: ScrapingBeeRequestKind): number {
  return kind === 'search' ? GOOGLE_SEARCH_CREDIT_COST : GOOGLE_PAGE_CREDIT_COST;
}

export interface ScrapingBeeConfig {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
}

export interface ScrapingBeePageResult {
  html: string;
  status: number;
  /**
   * Credits ScrapingBee actually billed for this request, read from the
   * `Spb-Cost` response header. `null` when the header is absent — callers
   * must NOT substitute a guessed number; a missing header means "we don't
   * know", not "zero".
   */
  creditsUsed: number | null;
}

/**
 * Configuration is missing or blank. Distinct from every HTTP-level error
 * because there was no request to retry — the caller needs to go fix an
 * env var, not back off and try again.
 */
export class ScrapingBeeConfigError extends Error {
  override readonly name = 'ScrapingBeeConfigError';
}

/**
 * ScrapingBee rejected the request as unauthorized (401/403). This means
 * SCRAPINGBEE_API_KEY is wrong, revoked, or the account is suspended —
 * never a transient condition, never worth retrying.
 */
export class ScrapingBeeAuthError extends Error {
  override readonly name = 'ScrapingBeeAuthError';
  constructor(readonly status: number) {
    super(
      `ScrapingBee rejected the request as unauthorized (HTTP ${status}). ` +
        'This is a configuration problem (SCRAPINGBEE_API_KEY is wrong, revoked, ' +
        'or the account is suspended) — not retried.',
    );
  }
}

/**
 * ScrapingBee returned 402: the plan's credit balance is exhausted. Stated
 * plainly so an operator reading a log doesn't mistake "we ran out of
 * money" for "the code is broken" — those need very different responses.
 */
export class ScrapingBeeQuotaError extends Error {
  override readonly name = 'ScrapingBeeQuotaError';
  constructor() {
    super(
      'ScrapingBee plan credits are exhausted (HTTP 402). This is a quota ' +
        'problem, not a bug — no fetch will succeed until the plan renews or ' +
        'the credit cap is raised. Not retried.',
    );
  }
}

/**
 * A transient failure (429 rate limit, 5xx upstream error, or a network
 * failure such as a timeout) that was retried once and still failed.
 */
export class ScrapingBeeTransientError extends Error {
  override readonly name = 'ScrapingBeeTransientError';
  constructor(readonly status: number | null, detail: string) {
    super(`ScrapingBee request failed transiently after 1 retry (${detail}).`);
  }
}

/**
 * Any other non-2xx response — a deterministic failure not covered by the
 * three cases above. Carries the status so the caller can decide what to
 * do with it, but it is never retried by this client.
 */
export class ScrapingBeeRequestError extends Error {
  override readonly name = 'ScrapingBeeRequestError';
  constructor(
    readonly status: number,
    readonly detail?: string,
  ) {
    super(
      `ScrapingBee request failed with HTTP ${status} (not retried).` +
        (detail ? ` ${detail}` : ''),
    );
  }
}

export function configFromEnv(): ScrapingBeeConfig {
  // Truthy-placeholder trap: a shipped `SCRAPINGBEE_API_KEY=REPLACE_ME` must
  // behave exactly like an unset key. We only ever read the real value from
  // .env (never ship a placeholder in .env.prod.example — see that file),
  // but guard here too so "unset" and "blank" are the same code path as a
  // matter of policy, not accident.
  const apiKey = process.env.SCRAPINGBEE_API_KEY?.trim();
  if (!apiKey) {
    throw new ScrapingBeeConfigError(
      'SCRAPINGBEE_API_KEY is not set. Google Scholar fetch is not configured — set it in .env before calling.',
    );
  }
  const baseUrl = (process.env.SCRAPINGBEE_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/?$/, '/');
  const timeoutMsRaw = process.env.SCRAPINGBEE_TIMEOUT_MS?.trim();
  const timeoutMs = timeoutMsRaw ? Number(timeoutMsRaw) : DEFAULT_TIMEOUT_MS;
  return {
    apiKey,
    baseUrl,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS,
  };
}

// Builds the actual request URL, api_key included. This value MUST NEVER be
// logged, thrown, or otherwise surfaced — it is only ever handed to fetch().
// Every error path below builds its message from `targetUrl` (the Scholar
// page being fetched) or from the response status, never from this URL and
// never from `cfg.apiKey`.
function buildRequestUrl(targetUrl: string, cfg: ScrapingBeeConfig): URL {
  const url = new URL(cfg.baseUrl);
  url.searchParams.set('api_key', cfg.apiKey);
  url.searchParams.set('url', targetUrl);
  url.searchParams.set('render_js', 'false');
  // MANDATORY for any Google domain, Scholar included. Without it ScrapingBee
  // refuses the request outright — HTTP 400 with
  //   {"errors":{"query":{"custom_google":["If you wish to scrape Google, use
  //    the custom_google=True parameter! ..."]}}}
  // and never contacts Google at all. Measured against the live API on
  // 2026-09-08: every Scholar URL 400s without it and returns 200 with it,
  // on both the profile page and the author-search endpoint.
  // It is what makes each request cost GOOGLE_PAGE_CREDIT_COST rather than 1.
  url.searchParams.set('custom_google', 'true');

  // SEARCHES ONLY. `custom_google` alone is enough for a `/citations?user=`
  // profile page, but every `/scholar?q=` search comes back HTTP 500 without
  // stealth — and that 500 is a lie: its `reason` field says "Server responded
  // with 403" and `help` carries Google's block page. Google 403s ScrapingBee's
  // plain custom_google pool for searches specifically. ScrapingBee does not
  // bill those, so the symptom is a healthy-looking zero-credit account plus
  // every staff member recording "cannot reach Scholar" (measured 2026-09-09;
  // custom_google + stealth returns 200 on the same URL).
  //
  // We deliberately do NOT send it on profile pages, which is where this
  // departs from the reference implementation. That one sends both flags on
  // every request to keep a single code path, reasoning that it also survives
  // Google extending the block to profile pages. We branch because our account
  // bills 75 for stealth against their 50, and the common call by far is a
  // bound person's routine profile sync — 60 wasted credits on every page of
  // every sync. If Google ever does extend the block, the failure is loud (a
  // 500 whose `reason` now says 403 on a profile URL, surfaced by the error
  // path below) and the fix is deleting this branch.
  if (classifyScrapingBeeRequest(targetUrl) === 'search') {
    url.searchParams.set('stealth_proxy', 'true');
  }

  // `country_code` is deliberately NOT set, on either path. Measured against
  // the same query on 2026-09-09: `country_code=th` succeeds 2/4, omitting it
  // succeeds 7/7. Pinning the exit country shrinks the stealth pool to
  // whatever Thai IPs are available and Google 403s those at roughly a coin
  // flip. Result locale is already pinned by `hl=en` on the target URL. Do not
  // re-add without re-measuring.
  return url;
}

/**
 * The fields of a ScrapingBee error body that are worth anything.
 *
 * ScrapingBee wraps EVERY upstream failure in the same generic 500 envelope
 * whose visible text is "please try again" — the least useful part of it. The
 * discriminating fields ride alongside:
 *
 *   reason — the upstream's actual verdict, e.g. "Server responded with 403".
 *            This is the entire difference between "ScrapingBee is flaky,
 *            retry" and "Google is blocking this proxy pool for searches".
 *   help   — the upstream's own response, i.e. Google's block page. Long, and
 *            only ever corroborating, so it is truncated hard.
 *
 * `passthrough` because the envelope carries other keys we do not model, and
 * an unexpected shape must degrade to the raw-prefix fallback rather than
 * throw — this runs on an error path that is already failing.
 */
const scrapingBeeErrorBodySchema = z
  .object({
    reason: z.string().optional(),
    help: z.string().optional(),
    message: z.string().optional(),
  })
  .passthrough();

/** Longest slice of `reason` kept. Real values are ~25 chars; this is slack. */
const REASON_MAX_CHARS = 200;
/** `help` is Google's whole block page — corroboration only. */
const HELP_MAX_CHARS = 200;
/** Fallback when the body is not the JSON envelope at all. */
const RAW_BODY_MAX_CHARS = 300;

/**
 * Turn a ScrapingBee error body into one line fit for an exception message.
 *
 * Ordering is load-bearing: `reason` is emitted FIRST and truncated on its own
 * budget, so it can never be the thing that falls off the end when the message
 * is clipped. A `help` field 40 KB long must not be able to push the one useful
 * sentence out of the log.
 *
 * The key is redacted before anything else, defensively — ScrapingBee's own
 * envelopes do not echo it, but this string ends up in exception messages,
 * logs and, eventually, a screen.
 */
function summariseErrorBody(rawBody: string, apiKey: string): string {
  const redacted = rawBody.replaceAll(apiKey, '[REDACTED]');
  let parsed: z.infer<typeof scrapingBeeErrorBodySchema> | null = null;
  try {
    parsed = scrapingBeeErrorBodySchema.parse(JSON.parse(redacted));
  } catch {
    // Not the JSON envelope (an HTML error page, a bare string, a truncated
    // body). The raw prefix is still the best available evidence.
    parsed = null;
  }
  if (parsed) {
    const parts: string[] = [];
    if (parsed.reason) parts.push(`reason: ${collapseWhitespace(parsed.reason).slice(0, REASON_MAX_CHARS)}`);
    if (parsed.help) parts.push(`help: ${collapseWhitespace(parsed.help).slice(0, HELP_MAX_CHARS)}`);
    if (parts.length > 0) return parts.join(' | ');
    // A JSON envelope with neither field — e.g. {"message":"..."} — is still
    // better read as its message than as raw JSON punctuation.
    if (parsed.message) return collapseWhitespace(parsed.message).slice(0, RAW_BODY_MAX_CHARS);
  }
  return collapseWhitespace(redacted).slice(0, RAW_BODY_MAX_CHARS);
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Read an error body without letting the read itself become the failure. A
 * consumed or unreadable body still leaves the caller the status, which is
 * more than nothing.
 */
async function readErrorBody(response: Response, cfg: ScrapingBeeConfig): Promise<string> {
  try {
    return summariseErrorBody(await response.text(), cfg.apiKey);
  } catch {
    return '';
  }
}

function parseCreditsUsed(response: Response): number | null {
  const header = response.headers.get('Spb-Cost');
  if (header == null || header.trim() === '') return null;
  const parsed = Number(header);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Fetch one page through ScrapingBee. One job per call — no pagination, no
 * multi-URL batching; the caller (the scholar fetch runner) is responsible
 * for looping over search-result / profile pages and calling this once per
 * page.
 *
 * Retries exactly once, and only for the transient case (429 / 5xx /
 * network failure or timeout). Auth (401/403) and quota (402) failures are
 * never retried — retrying either just wastes a request against a
 * condition that will not change between attempts.
 */
export async function fetchScrapingBeePage(
  targetUrl: string,
  cfg: ScrapingBeeConfig = configFromEnv(),
): Promise<ScrapingBeePageResult> {
  return attempt(targetUrl, cfg, /* retriesRemaining */ 1, /* priorDetail */ '');
}

/**
 * `priorDetail` carries forward what an earlier attempt learned from its error
 * body. It exists because the retry can come back with a body we cannot read
 * (empty, or already consumed) — and losing a "Server responded with 403" we
 * had ALREADY seen, because the second attempt was less informative than the
 * first, would put us straight back to the bare "HTTP 500 (transient)" that
 * this whole error path exists to escape.
 */
async function attempt(
  targetUrl: string,
  cfg: ScrapingBeeConfig,
  retriesRemaining: number,
  priorDetail: string,
): Promise<ScrapingBeePageResult> {
  let response: Response;
  try {
    response = await performRequest(targetUrl, cfg);
  } catch (err) {
    // Network failure or timeout — transient by definition, retried once.
    if (retriesRemaining > 0) {
      return attempt(targetUrl, cfg, retriesRemaining - 1, priorDetail);
    }
    // Deliberately do not include err.message — Node's fetch occasionally
    // echoes low-level connection detail we haven't audited for URL leakage.
    // err.name (e.g. "AbortError", "TypeError") is safe and enough to
    // distinguish a timeout from a DNS/connection failure.
    const detail = err instanceof Error ? err.name : 'unknown network error';
    throw new ScrapingBeeTransientError(null, detail);
  }

  if (response.status === 401 || response.status === 403) {
    throw new ScrapingBeeAuthError(response.status);
  }
  if (response.status === 402) {
    throw new ScrapingBeeQuotaError();
  }
  if (TRANSIENT_STATUSES.has(response.status)) {
    // Read the body BEFORE deciding to retry. On a 500 this is the only place
    // the upstream's real verdict exists: a 500 whose `reason` is "Server
    // responded with 403" is Google blocking the proxy pool, not a blip, and
    // no number of retries will fix it. Throwing a bare "HTTP 500" here is
    // what turned that condition into a week of guessing once already.
    const detail = (await readErrorBody(response, cfg)) || priorDetail;
    if (retriesRemaining > 0) {
      return attempt(targetUrl, cfg, retriesRemaining - 1, detail);
    }
    throw new ScrapingBeeTransientError(
      response.status,
      detail ? `HTTP ${response.status} — ${detail}` : `HTTP ${response.status}`,
    );
  }
  if (!response.ok) {
    // Carry a slice of the response body. ScrapingBee reports parameter
    // mistakes only in the body — a missing `custom_google` is an opaque 400
    // otherwise, which is exactly how that bug survived a full test suite.
    // The body is ScrapingBee's own JSON error and does not contain the key,
    // but summariseErrorBody redacts defensively rather than trusting that.
    //
    // `priorDetail` is deliberately NOT consulted here: this response is a
    // deterministic verdict of its own, and pinning an earlier attempt's
    // "Server responded with 403" onto an HTTP 400 would describe the wrong
    // failure. If its body is unreadable, the status alone is the honest answer.
    const detail = await readErrorBody(response, cfg);
    throw new ScrapingBeeRequestError(response.status, detail || undefined);
  }

  const creditsUsed = parseCreditsUsed(response);
  const html = await response.text();
  return { html, status: response.status, creditsUsed };
}

async function performRequest(targetUrl: string, cfg: ScrapingBeeConfig): Promise<Response> {
  const requestUrl = buildRequestUrl(targetUrl, cfg);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    return await fetch(requestUrl, { method: 'GET', signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
