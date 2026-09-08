import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configFromEnv,
  fetchScrapingBeePage,
  ScrapingBeeAuthError,
  ScrapingBeeConfigError,
  ScrapingBeeQuotaError,
  ScrapingBeeTransientError,
} from '../src/scholar/scrapingbee';

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
  });
});
