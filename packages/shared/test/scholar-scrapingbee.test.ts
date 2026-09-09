import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  classifyScrapingBeeRequest,
  configFromEnv,
  creditCostForRequestKind,
  fetchScrapingBeePage,
  GOOGLE_PAGE_CREDIT_COST,
  GOOGLE_SEARCH_CREDIT_COST,
  ScrapingBeeAuthError,
  ScrapingBeeConfigError,
  ScrapingBeeQuotaError,
  ScrapingBeeRequestError,
  ScrapingBeeTransientError,
} from '../src/scholar/scrapingbee';

const PROFILE_URL = 'https://scholar.google.com/citations?user=abc&hl=en&cstart=0&pagesize=100';
const SEARCH_URL = 'https://scholar.google.com/scholar?q=Denpong+Soodphakdee&hl=en&as_vis=1';

const ORIGINAL_ENV = { ...process.env };

function setEnv(overrides: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function fakeResponse(opts: {
  status: number;
  body?: string;
  spbCost?: string | null;
}): Response {
  const headers = new Headers();
  if (opts.spbCost !== null && opts.spbCost !== undefined) {
    headers.set('Spb-Cost', opts.spbCost);
  }
  return new Response(opts.body ?? '', {
    status: opts.status,
    headers,
  });
}

describe('scholar/scrapingbee', () => {
  beforeEach(() => {
    setEnv({
      SCRAPINGBEE_API_KEY: 'test-secret-key-do-not-leak',
      SCRAPINGBEE_BASE_URL: 'https://app.scrapingbee.com/api/v1/',
      SCRAPINGBEE_TIMEOUT_MS: '30000',
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...ORIGINAL_ENV };
  });

  describe('configFromEnv', () => {
    it('throws ScrapingBeeConfigError when SCRAPINGBEE_API_KEY is unset', () => {
      setEnv({ SCRAPINGBEE_API_KEY: undefined });
      expect(() => configFromEnv()).toThrow(ScrapingBeeConfigError);
    });

    it('throws ScrapingBeeConfigError when SCRAPINGBEE_API_KEY is empty/whitespace', () => {
      setEnv({ SCRAPINGBEE_API_KEY: '   ' });
      expect(() => configFromEnv()).toThrow(ScrapingBeeConfigError);
    });

    it('reads a valid config from env', () => {
      const cfg = configFromEnv();
      expect(cfg.apiKey).toBe('test-secret-key-do-not-leak');
      expect(cfg.baseUrl).toBe('https://app.scrapingbee.com/api/v1/');
      expect(cfg.timeoutMs).toBe(30000);
    });
  });

  describe('fetchScrapingBeePage', () => {
    it('throws a configuration error before any fetch when the key is missing', async () => {
      setEnv({ SCRAPINGBEE_API_KEY: undefined });
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      await expect(fetchScrapingBeePage('https://scholar.google.com/citations?user=abc')).rejects.toThrow(
        ScrapingBeeConfigError,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('parses credits used from the Spb-Cost header', async () => {
      const fetchMock = vi.fn().mockResolvedValue(fakeResponse({ status: 200, body: '<html>ok</html>', spbCost: '5' }));
      vi.stubGlobal('fetch', fetchMock);

      const result = await fetchScrapingBeePage('https://scholar.google.com/citations?user=abc');
      expect(result.html).toBe('<html>ok</html>');
      expect(result.creditsUsed).toBe(5);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('returns null credits used when the Spb-Cost header is absent', async () => {
      const fetchMock = vi.fn().mockResolvedValue(fakeResponse({ status: 200, body: '<html>ok</html>' }));
      vi.stubGlobal('fetch', fetchMock);

      const result = await fetchScrapingBeePage('https://scholar.google.com/citations?user=abc');
      expect(result.creditsUsed).toBeNull();
    });

    it('throws ScrapingBeeAuthError on 401 and does not retry', async () => {
      const fetchMock = vi.fn().mockResolvedValue(fakeResponse({ status: 401 }));
      vi.stubGlobal('fetch', fetchMock);

      await expect(fetchScrapingBeePage('https://scholar.google.com/citations?user=abc')).rejects.toThrow(
        ScrapingBeeAuthError,
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('throws ScrapingBeeAuthError on 403 and does not retry', async () => {
      const fetchMock = vi.fn().mockResolvedValue(fakeResponse({ status: 403 }));
      vi.stubGlobal('fetch', fetchMock);

      await expect(fetchScrapingBeePage('https://scholar.google.com/citations?user=abc')).rejects.toThrow(
        ScrapingBeeAuthError,
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('throws ScrapingBeeQuotaError on 402 with a plain message, and does not retry', async () => {
      const fetchMock = vi.fn().mockResolvedValue(fakeResponse({ status: 402 }));
      vi.stubGlobal('fetch', fetchMock);

      await expect(fetchScrapingBeePage('https://scholar.google.com/citations?user=abc')).rejects.toThrow(
        ScrapingBeeQuotaError,
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const fetchMock2 = vi.fn().mockResolvedValue(fakeResponse({ status: 402 }));
      vi.stubGlobal('fetch', fetchMock2);
      try {
        await fetchScrapingBeePage('https://scholar.google.com/citations?user=abc');
        expect.fail('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(ScrapingBeeQuotaError);
        expect((err as Error).message.toLowerCase()).toContain('credits');
        expect((err as Error).message.toLowerCase()).toContain('exhausted');
      }
    });

    it('retries exactly once on a 500 and throws ScrapingBeeTransientError if it keeps failing', async () => {
      const fetchMock = vi.fn().mockResolvedValue(fakeResponse({ status: 500 }));
      vi.stubGlobal('fetch', fetchMock);

      await expect(fetchScrapingBeePage('https://scholar.google.com/citations?user=abc')).rejects.toThrow(
        ScrapingBeeTransientError,
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('succeeds after one transient failure (one retry)', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(fakeResponse({ status: 503 }))
        .mockResolvedValueOnce(fakeResponse({ status: 200, body: '<html>recovered</html>', spbCost: '1' }));
      vi.stubGlobal('fetch', fetchMock);

      const result = await fetchScrapingBeePage('https://scholar.google.com/citations?user=abc');
      expect(result.html).toBe('<html>recovered</html>');
      expect(result.creditsUsed).toBe(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('retries exactly once on a 429 (rate limit)', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(fakeResponse({ status: 429 }))
        .mockResolvedValueOnce(fakeResponse({ status: 200, body: '<html>ok</html>' }));
      vi.stubGlobal('fetch', fetchMock);

      const result = await fetchScrapingBeePage('https://scholar.google.com/citations?user=abc');
      expect(result.html).toBe('<html>ok</html>');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('retries exactly once on a network failure, then throws ScrapingBeeTransientError', async () => {
      const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
      vi.stubGlobal('fetch', fetchMock);

      await expect(fetchScrapingBeePage('https://scholar.google.com/citations?user=abc')).rejects.toThrow(
        ScrapingBeeTransientError,
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('treats any other non-2xx status as non-retryable', async () => {
      const fetchMock = vi.fn().mockResolvedValue(fakeResponse({ status: 404 }));
      vi.stubGlobal('fetch', fetchMock);

      await expect(fetchScrapingBeePage('https://scholar.google.com/citations?user=abc')).rejects.toThrow(
        /HTTP 404/,
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('never sends the api key in a way that appears in a thrown error message', async () => {
      const fetchMock = vi.fn().mockResolvedValue(fakeResponse({ status: 401 }));
      vi.stubGlobal('fetch', fetchMock);

      try {
        await fetchScrapingBeePage('https://scholar.google.com/citations?user=abc');
        expect.fail('expected throw');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        expect(message).not.toContain('test-secret-key-do-not-leak');
      }

      // The request itself legitimately carries the key (that's how
      // ScrapingBee auth works) — assert it went out as a query param, not
      // that it was never sent.
      const calledUrl = String(fetchMock.mock.calls[0]?.[0]);
      expect(calledUrl).toContain('api_key=test-secret-key-do-not-leak');
    });

    // Regression guard. Without custom_google, ScrapingBee never contacts
    // Google at all: it rejects the request with a 400 whose body names the
    // missing parameter. Every mocked test above still passed while this was
    // missing, because a mock answers whatever it is asked — which is exactly
    // why this assertion is on the outgoing URL and not on a response.
    it('always sends custom_google=true — Google refuses the request without it', async () => {
      const fetchMock = vi.fn().mockResolvedValue(fakeResponse({ status: 200, body: '<html></html>' }));
      vi.stubGlobal('fetch', fetchMock);

      await fetchScrapingBeePage('https://scholar.google.com/citations?user=abc');

      const calledUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
      expect(calledUrl.searchParams.get('custom_google')).toBe('true');
    });

    // ── The stealth branch ────────────────────────────────────────────────
    //
    // These assert the OUTGOING URL, never a response. A mock answers whatever
    // it is asked, so a test that checks the reply proves only that the mock
    // works — which is how the client once shipped without `custom_google`
    // while all fifteen of its tests passed.

    it('sends stealth_proxy=true on a /scholar?q= SEARCH — plain custom_google 500s (a hidden 403)', async () => {
      const fetchMock = vi.fn().mockResolvedValue(fakeResponse({ status: 200, body: '<html></html>' }));
      vi.stubGlobal('fetch', fetchMock);

      await fetchScrapingBeePage(SEARCH_URL);

      const calledUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
      expect(calledUrl.searchParams.get('custom_google')).toBe('true');
      expect(calledUrl.searchParams.get('stealth_proxy')).toBe('true');
    });

    it('does NOT send stealth_proxy on a /citations profile page — it works plain, at a fifth of the price', async () => {
      const fetchMock = vi.fn().mockResolvedValue(fakeResponse({ status: 200, body: '<html></html>' }));
      vi.stubGlobal('fetch', fetchMock);

      await fetchScrapingBeePage(PROFILE_URL);

      const calledUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
      expect(calledUrl.searchParams.get('custom_google')).toBe('true');
      expect(calledUrl.searchParams.has('stealth_proxy')).toBe(false);
    });

    // Measured 2026-09-09: country_code=th succeeded 2/4, omitting it 7/7.
    // Pinning the exit country shrinks the stealth pool to Thai IPs, which
    // Google 403s at roughly a coin flip. hl=en already pins the locale.
    it.each([
      ['search', SEARCH_URL],
      ['profile', PROFILE_URL],
    ])('never sends country_code on a %s request', async (_kind, target) => {
      const fetchMock = vi.fn().mockResolvedValue(fakeResponse({ status: 200, body: '<html></html>' }));
      vi.stubGlobal('fetch', fetchMock);

      await fetchScrapingBeePage(target);

      const calledUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
      expect(calledUrl.searchParams.has('country_code')).toBe(false);
    });

    it('surfaces the response body on an otherwise-opaque 4xx, with the key redacted', async () => {
      const body = JSON.stringify({
        errors: { query: { custom_google: ['If you wish to scrape Google, use the custom_google=True parameter!'] } },
      });
      const fetchMock = vi.fn().mockResolvedValue(fakeResponse({ status: 400, body }));
      vi.stubGlobal('fetch', fetchMock);

      try {
        await fetchScrapingBeePage('https://scholar.google.com/citations?user=abc');
        expect.fail('expected throw');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        expect(message).toContain('HTTP 400');
        // The actionable part of the body must reach the caller — a bare
        // "HTTP 400" is what made this class of misconfiguration invisible.
        expect(message).toContain('custom_google');
        expect(message).not.toContain('test-secret-key-do-not-leak');
      }
    });

    it('redacts the api key if it ever appears in an error body', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        fakeResponse({ status: 400, body: 'bad key: test-secret-key-do-not-leak' }),
      );
      vi.stubGlobal('fetch', fetchMock);

      try {
        await fetchScrapingBeePage('https://scholar.google.com/citations?user=abc');
        expect.fail('expected throw');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        expect(message).not.toContain('test-secret-key-do-not-leak');
        expect(message).toContain('[REDACTED]');
      }
    });

    // ── The 500 that is really a 403 ──────────────────────────────────────

    it("surfaces `reason` from a 500 body — 'please try again' is the least useful part of it", async () => {
      const body = JSON.stringify({
        message: 'Something went wrong, please try again',
        reason: 'Server responded with 403',
        help: 'Our systems have detected unusual traffic from your computer network.',
      });
      // A fresh Response per attempt — a single instance would have an
      // already-consumed body on the retry, which is not how the real API
      // behaves.
      const fetchMock = vi.fn().mockImplementation(() => fakeResponse({ status: 500, body }));
      vi.stubGlobal('fetch', fetchMock);

      try {
        await fetchScrapingBeePage(SEARCH_URL);
        expect.fail('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(ScrapingBeeTransientError);
        const message = err instanceof Error ? err.message : String(err);
        // The one sentence that distinguishes "ScrapingBee is flaky" from
        // "Google is blocking this pool for searches".
        expect(message).toContain('Server responded with 403');
        expect(message).toContain('HTTP 500');
      }
    });

    it('keeps `reason` even when `help` carries the whole of Google\'s block page', async () => {
      const body = JSON.stringify({
        message: 'Something went wrong, please try again',
        reason: 'Server responded with 403',
        // The real `help` is Google's rendered block page — tens of KB. It
        // must not be able to push the useful sentence out of the message.
        help: '<html>'.padEnd(40_000, 'x') + '</html>',
      });
      // A fresh Response per attempt — a single instance would have an
      // already-consumed body on the retry, which is not how the real API
      // behaves.
      const fetchMock = vi.fn().mockImplementation(() => fakeResponse({ status: 500, body }));
      vi.stubGlobal('fetch', fetchMock);

      try {
        await fetchScrapingBeePage(SEARCH_URL);
        expect.fail('expected throw');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        expect(message).toContain('Server responded with 403');
        expect(message.length).toBeLessThan(1_000);
      }
    });

    it('keeps the reason the FIRST attempt saw when the retry comes back with nothing', async () => {
      // The retry is a second round trip: it can land on a different node and
      // return an empty envelope. Reporting "HTTP 500" because the second
      // attempt was less informative than the first would discard a verdict we
      // had already read.
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          fakeResponse({ status: 500, body: JSON.stringify({ reason: 'Server responded with 403' }) }),
        )
        .mockResolvedValueOnce(fakeResponse({ status: 500, body: '' }));
      vi.stubGlobal('fetch', fetchMock);

      try {
        await fetchScrapingBeePage(SEARCH_URL);
        expect.fail('expected throw');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        expect(message).toContain('Server responded with 403');
      }
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('falls back to a raw prefix when the error body is not the JSON envelope', async () => {
      const fetchMock = vi
        .fn()
        .mockImplementation(() => fakeResponse({ status: 500, body: '<html>Gateway blew up</html>' }));
      vi.stubGlobal('fetch', fetchMock);

      try {
        await fetchScrapingBeePage(SEARCH_URL);
        expect.fail('expected throw');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        expect(message).toContain('Gateway blew up');
      }
    });

    it('redacts the api key out of a 500 body too', async () => {
      const body = JSON.stringify({ reason: 'bad key test-secret-key-do-not-leak' });
      // A fresh Response per attempt — a single instance would have an
      // already-consumed body on the retry, which is not how the real API
      // behaves.
      const fetchMock = vi.fn().mockImplementation(() => fakeResponse({ status: 500, body }));
      vi.stubGlobal('fetch', fetchMock);

      try {
        await fetchScrapingBeePage(SEARCH_URL);
        expect.fail('expected throw');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        expect(message).not.toContain('test-secret-key-do-not-leak');
        expect(message).toContain('[REDACTED]');
      }
    });
    // ── An error dressed as a 200 ─────────────────────────────────────────
    //
    // The quietest failure this client can have. Returned as Scholar HTML it
    // parses to zero publications, for every person, and reports success.

    it('throws ScrapingBeeQuotaError on the HTTP 200 monthly-limit envelope', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        // The exact production body the reference implementation documents.
        fakeResponse({ status: 200, body: '{"message":"Monthly API calls limit reached: 1000"}', spbCost: '0' }),
      );
      vi.stubGlobal('fetch', fetchMock);

      try {
        await fetchScrapingBeePage(PROFILE_URL);
        expect.fail('expected throw — this body is not a Scholar page');
      } catch (err) {
        expect(err).toBeInstanceOf(ScrapingBeeQuotaError);
        const message = err instanceof Error ? err.message : String(err);
        expect(message).toContain('Monthly API calls limit reached');
        // It must not imply a 402 that never happened.
        expect(message).toContain('HTTP 200');
      }
      // Not retried: the allowance will not refill between two attempts.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('throws the generic request error for a 200 envelope that is not about quota', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(fakeResponse({ status: 200, body: '{"message":"Something went wrong"}' }));
      vi.stubGlobal('fetch', fetchMock);

      try {
        await fetchScrapingBeePage(PROFILE_URL);
        expect.fail('expected throw');
      } catch (err) {
        // Mis-typing this as a quota error would debit the wrong ledger.
        expect(err).not.toBeInstanceOf(ScrapingBeeQuotaError);
        expect(err).toBeInstanceOf(ScrapingBeeRequestError);
        expect((err as Error).message).toContain('Something went wrong');
      }
    });

    it('returns real Scholar HTML untouched — the guard must not eat healthy pages', async () => {
      const html = '<html><body><div id="gsc_a_b">{"not":"json"}</div></body></html>';
      const fetchMock = vi.fn().mockResolvedValue(fakeResponse({ status: 200, body: html, spbCost: '15' }));
      vi.stubGlobal('fetch', fetchMock);

      const result = await fetchScrapingBeePage(PROFILE_URL);
      expect(result.html).toBe(html);
      expect(result.creditsUsed).toBe(15);
    });

    it('returns a JSON body that is not the error envelope', async () => {
      // "Parses as JSON" alone is NOT the discriminator: the body must carry
      // the envelope's own narrative field. A JSON endpoint fetched through
      // this client one day must not start throwing on healthy responses.
      const body = '{"publications":[{"title":"A paper"}]}';
      const fetchMock = vi.fn().mockResolvedValue(fakeResponse({ status: 200, body }));
      vi.stubGlobal('fetch', fetchMock);

      const result = await fetchScrapingBeePage(PROFILE_URL);
      expect(result.html).toBe(body);
    });

    it('redacts the api key out of a 200 error envelope', async () => {
      const body = JSON.stringify({ message: 'quota rejected for key test-secret-key-do-not-leak' });
      const fetchMock = vi.fn().mockResolvedValue(fakeResponse({ status: 200, body }));
      vi.stubGlobal('fetch', fetchMock);

      try {
        await fetchScrapingBeePage(PROFILE_URL);
        expect.fail('expected throw');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        expect(message).not.toContain('test-secret-key-do-not-leak');
        expect(message).toContain('[REDACTED]');
      }
    });
  });

  describe('classifyScrapingBeeRequest', () => {
    it.each([
      ['https://scholar.google.com/citations?user=abc&hl=en', 'profile'],
      ['https://scholar.google.com/citations?user=abc&cstart=100&pagesize=100', 'profile'],
      ['https://scholar.google.com/scholar?q=Somchai+Jaidee&hl=en', 'search'],
      ['https://scholar.google.com/scholar?q=Somchai+Jaidee&hl=en&as_vis=1', 'search'],
    ])('classifies %s as %s', (url, expected) => {
      expect(classifyScrapingBeeRequest(url)).toBe(expected);
    });

    // An unrecognised or malformed URL defaults to `search`, i.e. WITH stealth.
    // That direction costs 60 extra credits; the other direction is the silent
    // 500-hiding-a-403 this branch exists to prevent.
    it('defaults an unknown Scholar path to search rather than profile', () => {
      expect(classifyScrapingBeeRequest('https://scholar.google.com/scholar_case?case=123')).toBe('search');
    });

    it('does not throw on a malformed URL — it classifies it as search', () => {
      expect(classifyScrapingBeeRequest('not a url')).toBe('search');
    });
  });

  describe('credit constants', () => {
    // These are pre-flight estimates only; `Spb-Cost` is authoritative per
    // call. Measured 2026-09-09 on our account.
    it('prices a profile page at 15 and a search at 75', () => {
      expect(GOOGLE_PAGE_CREDIT_COST).toBe(15);
      expect(GOOGLE_SEARCH_CREDIT_COST).toBe(75);
    });

    it('pairs each request kind with its own price', () => {
      expect(creditCostForRequestKind('profile')).toBe(GOOGLE_PAGE_CREDIT_COST);
      expect(creditCostForRequestKind('search')).toBe(GOOGLE_SEARCH_CREDIT_COST);
      // The gap is the entire justification for branching the flags. If these
      // ever converge, revisit whether the branch is still worth its cost.
      expect(GOOGLE_SEARCH_CREDIT_COST).toBeGreaterThan(GOOGLE_PAGE_CREDIT_COST);
    });
  });
});
