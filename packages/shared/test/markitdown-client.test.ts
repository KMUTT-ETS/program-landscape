import { describe, it, expect, vi, afterEach } from 'vitest';
import { MarkitdownClient } from '../src/markitdown/markitdown-client';

const cfg = { baseUrl: 'http://markitdown:8000', requestTimeoutMs: 1000 };
const input = { bytes: Buffer.from('x'), filename: 'a.docx' };

describe('MarkitdownClient', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns markdown + title on 200', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ markdown: '# Hi', title: 'Doc' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );
    const res = await new MarkitdownClient(cfg).convert(input);
    expect(res.markdown).toBe('# Hi');
    expect(res.title).toBe('Doc');
  });

  it('maps 4xx → MARKITDOWN_REJECTED', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad', { status: 422 })));
    await expect(new MarkitdownClient(cfg).convert(input)).rejects.toMatchObject({
      code: 'MARKITDOWN_REJECTED',
    });
  });

  it('maps 5xx → MARKITDOWN_UNAVAILABLE', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
    await expect(new MarkitdownClient(cfg).convert(input)).rejects.toMatchObject({
      code: 'MARKITDOWN_UNAVAILABLE',
    });
  });

  it('maps a network error → MARKITDOWN_UNAVAILABLE', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );
    await expect(new MarkitdownClient(cfg).convert(input)).rejects.toMatchObject({
      code: 'MARKITDOWN_UNAVAILABLE',
    });
  });

  it('maps an abort → MARKITDOWN_TIMEOUT', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const e = new Error('aborted');
        e.name = 'AbortError';
        throw e;
      }),
    );
    await expect(new MarkitdownClient(cfg).convert(input)).rejects.toMatchObject({
      code: 'MARKITDOWN_TIMEOUT',
    });
  });

  it('rejects an unexpected response shape', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ nope: true }), { status: 200 })));
    await expect(new MarkitdownClient(cfg).convert(input)).rejects.toMatchObject({
      code: 'MARKITDOWN_REJECTED',
    });
  });
});
