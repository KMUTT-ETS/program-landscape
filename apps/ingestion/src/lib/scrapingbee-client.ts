// ────────────────────────────────────────────────────────────────────────────
// ScrapingBee client helper — Google Scholar on-demand fetch.
//
// Used by:
//   - the scholar fetch runner (packages/db/src/scholar-fetch.ts, Task 6)
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
  return url;
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
  return attempt(targetUrl, cfg, /* retriesRemaining */ 1);
}

async function attempt(
  targetUrl: string,
  cfg: ScrapingBeeConfig,
  retriesRemaining: number,
): Promise<ScrapingBeePageResult> {
  let response: Response;
  try {
    response = await performRequest(targetUrl, cfg);
  } catch (err) {
    // Network failure or timeout — transient by definition, retried once.
    if (retriesRemaining > 0) {
      return attempt(targetUrl, cfg, retriesRemaining - 1);
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
    if (retriesRemaining > 0) {
      return attempt(targetUrl, cfg, retriesRemaining - 1);
    }
    throw new ScrapingBeeTransientError(response.status, `HTTP ${response.status}`);
  }
  if (!response.ok) {
    // Carry a slice of the response body. ScrapingBee reports parameter
    // mistakes only in the body — a missing `custom_google` is an opaque 400
    // otherwise, which is exactly how that bug survived a full test suite.
    // The body is ScrapingBee's own JSON error and does not contain the key,
    // but redact defensively rather than trusting that.
    let detail = '';
    try {
      detail = (await response.text()).replaceAll(cfg.apiKey, '[REDACTED]').slice(0, 300);
    } catch {
      // Body already consumed or unreadable — the status alone still tells
      // the caller what happened.
    }
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
