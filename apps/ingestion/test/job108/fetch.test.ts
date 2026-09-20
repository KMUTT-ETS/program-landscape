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
});
