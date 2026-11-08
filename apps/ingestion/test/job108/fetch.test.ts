import { describe, expect, it, vi, afterEach } from 'vitest';
import { fetchJob108Page, Job108FetchError, JOB108_BASE_URL } from '../../src/job108/fetch';

describe('fetchJob108Page', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // robots.txt disallows /go.php and /url.php for every user-agent. This
  // must be checked BEFORE any network call, not merely trusted to work —
  // a global fetch mock that throws proves no request was ever attempted.
  it('refuses /go.php without making a network call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('network call attempted — should never happen for a disallowed path'),
    );
    await expect(fetchJob108Page(`${JOB108_BASE_URL}/go.php?id=1`)).rejects.toBeInstanceOf(Job108FetchError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses /url.php without making a network call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('network call attempted — should never happen for a disallowed path'),
    );
    await expect(fetchJob108Page(`${JOB108_BASE_URL}/url.php?x=1`)).rejects.toBeInstanceOf(Job108FetchError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('allows an ordinary announcement path through to fetch()', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html></html>', { status: 200 }),
    );
    await fetchJob108Page(`${JOB108_BASE_URL}/id20256.html`);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  // The last line of defence: this guard sits on the function that
  // actually makes the request, so it holds no matter how an off-origin
  // URL got here — a bad SystemSetting row, a bug upstream, anything.
  it('refuses an off-origin URL without making a network call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('network call attempted — should never happen for an off-origin URL'),
    );
    await expect(fetchJob108Page('https://evil.example.com/sitemap.xml')).rejects.toBeInstanceOf(
      Job108FetchError,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('fetchJob108Page identity', () => {
  it('uses the organisation user-agent', async () => {
    const { outboundUserAgent } = await import('@kku/shared');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html></html>', { status: 200 }));
    await fetchJob108Page(`${JOB108_BASE_URL}/id1.html`);
    const headers = (fetchSpy.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers['User-Agent']).toBe(outboundUserAgent('job-108'));
    fetchSpy.mockRestore();
  });
});
