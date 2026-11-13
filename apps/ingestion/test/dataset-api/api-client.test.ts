import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { ConnectorContext } from '@kku/shared';
import { ApiClient, connectorEnv } from '../../src/connectors/base/api-client';
import { NonRetryableError } from '../../src/connectors/base/base-connector';

function recorder(respond: (req: Request) => Response) {
  const requests: Request[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    requests.push(req);
    return respond(req);
  }) as typeof fetch;
  return { requests, fetchImpl };
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const Schema = z.object({ ok: z.boolean() });

afterEach(() => vi.unstubAllEnvs());

describe('ApiClient', () => {
  it('sends Authorization: Bearer <token> and the query string', async () => {
    const { requests, fetchImpl } = recorder(() => json({ ok: true }));
    const client = new ApiClient({ baseUrl: 'https://x.test/api/v1', token: 'tok', fetchImpl });
    await client.getJson('/sections', Schema, { year: 2025, cursor: 'abc', skip: undefined });
    expect(requests[0]!.url).toBe('https://x.test/api/v1/sections?year=2025&cursor=abc');
    expect(requests[0]!.headers.get('authorization')).toBe('Bearer tok');
  });

  it('uses a custom auth header when configured', async () => {
    const { requests, fetchImpl } = recorder(() => json({ ok: true }));
    const client = new ApiClient({
      baseUrl: 'https://x.test',
      token: 'tok',
      authHeader: { header: 'X-Api-Key' },
      fetchImpl,
    });
    await client.getJson('/a', Schema);
    expect(requests[0]!.headers.get('x-api-key')).toBe('tok');
    expect(requests[0]!.headers.get('authorization')).toBeNull();
  });

  it('paginate follows next until null and concatenates items', async () => {
    const Page = z.object({ rows: z.array(z.number()), cursor: z.string().nullable() });
    const { requests, fetchImpl } = recorder((req) => {
      const c = new URL(req.url).searchParams.get('cursor');
      if (c === null) return json({ rows: [1, 2], cursor: 'b' });
      if (c === 'b') return json({ rows: [3], cursor: 'c' });
      return json({ rows: [4, 5], cursor: null });
    });
    const client = new ApiClient({ baseUrl: 'https://x.test', fetchImpl });
    const out = await client.paginate('/rows', Page, {
      items: (p) => p.rows,
      next: (p) => (p.cursor ? { cursor: p.cursor } : null),
      query: { year: 2025 },
    });
    expect(out).toEqual([1, 2, 3, 4, 5]);
    expect(requests).toHaveLength(3);
    expect(requests[2]!.url).toBe('https://x.test/rows?year=2025&cursor=c');
  });

  it('paginate tolerates one empty page that still has a next cursor', async () => {
    const Page = z.object({ rows: z.array(z.number()), cursor: z.string().nullable() });
    const { fetchImpl } = recorder((req) => {
      const c = new URL(req.url).searchParams.get('cursor');
      if (c === null) return json({ rows: [], cursor: 'b' });
      return json({ rows: [7], cursor: null });
    });
    const client = new ApiClient({ baseUrl: 'https://x.test', fetchImpl });
    const out = await client.paginate('/rows', Page, {
      items: (p) => p.rows,
      next: (p) => (p.cursor ? { cursor: p.cursor } : null),
    });
    expect(out).toEqual([7]);
  });

  it('paginate refuses 3 empty pages in a row with a next cursor', async () => {
    const Page = z.object({ rows: z.array(z.number()), cursor: z.string().nullable() });
    const { requests, fetchImpl } = recorder(() => json({ rows: [], cursor: 'same' }));
    const client = new ApiClient({ baseUrl: 'https://x.test', fetchImpl });
    const err = await client
      .paginate('/rows', Page, {
        items: (p) => p.rows,
        next: (p) => (p.cursor ? { cursor: p.cursor } : null),
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NonRetryableError);
    expect((err as NonRetryableError).code).toBe('PAGINATION');
    expect((err as Error).message).toBe(
      'GET /rows returned 3 empty pages in a row with a next cursor',
    );
    expect(requests).toHaveLength(3);
  });

  it('401 throws NonRetryableError HTTP_401 without retry', async () => {
    const { requests, fetchImpl } = recorder(() => new Response('secret', { status: 401 }));
    const client = new ApiClient({ baseUrl: 'https://x.test', token: 'tok', fetchImpl });
    const err = await client.getJson('/a', Schema).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NonRetryableError);
    expect((err as NonRetryableError).code).toBe('HTTP_401');
    expect((err as Error).message).toBe('GET /a returned 401');
    expect(requests).toHaveLength(1);
  });

  it('500 throws a retryable Error', async () => {
    const { fetchImpl } = recorder(() => new Response('boom', { status: 500 }));
    const client = new ApiClient({ baseUrl: 'https://x.test', fetchImpl });
    const err = await client.getJson('/a', Schema).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(NonRetryableError);
    expect((err as Error).message).toBe('GET /a returned 500');
  });

  it('schema mismatch names the path and issue paths but not the body', async () => {
    const { fetchImpl } = recorder(() => json({ ok: 'สมชาย' }));
    const client = new ApiClient({ baseUrl: 'https://x.test', token: 'tok', fetchImpl });
    const err = await client.getJson('/a', Schema).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NonRetryableError);
    expect((err as NonRetryableError).code).toBe('SCHEMA');
    const msg = (err as Error).message;
    expect(msg).toContain('/a');
    expect(msg).toContain('ok');
    expect(msg).not.toContain('สมชาย');
    expect(msg).not.toContain('tok');
  });

  it('non-JSON body throws SCHEMA', async () => {
    const { fetchImpl } = recorder(() => new Response('<html>', { status: 200 }));
    const client = new ApiClient({ baseUrl: 'https://x.test', fetchImpl });
    const err = await client.getJson('/a', Schema).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NonRetryableError);
    expect((err as NonRetryableError).code).toBe('SCHEMA');
    expect((err as Error).message).not.toContain('<html>');
  });

  it('a timeout is a retryable error naming the path and the timeout', async () => {
    const fetchImpl = ((_i: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_res, rej) => {
        init?.signal?.addEventListener('abort', () =>
          rej(new DOMException('aborted', 'AbortError')),
        );
      })) as typeof fetch;
    const client = new ApiClient({ baseUrl: 'https://x.test', timeoutMs: 20, fetchImpl });
    const err = await client.getJson('/slow', Schema).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(NonRetryableError);
    expect((err as Error).message).toContain('/slow');
    expect((err as Error).message).toContain('20');
  });

  it('a stalled body triggers the timeout as a retryable error', async () => {
    const fetchImpl = (async (_i: RequestInfo | URL, init?: RequestInit) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener('abort', () =>
            controller.error(new DOMException('aborted', 'AbortError')),
          );
        },
      });
      return new Response(stream, { status: 200 });
    }) as typeof fetch;
    const client = new ApiClient({ baseUrl: 'https://x.test', timeoutMs: 20, fetchImpl });
    const err = await client.getJson('/stall', Schema).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(NonRetryableError);
    expect((err as Error).message).toContain('/stall');
    expect((err as Error).message).toContain('timed out');
  });

  it('a body stream that errors mid-read is retryable, not SCHEMA', async () => {
    const { fetchImpl } = recorder(() => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"ok":'));
          controller.error(new TypeError('socket reset'));
        },
      });
      return new Response(stream, { status: 200 });
    });
    const client = new ApiClient({ baseUrl: 'https://x.test', fetchImpl });
    const err = await client.getJson('/a', Schema).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(NonRetryableError);
    expect((err as Error).message).toContain('/a');
  });

  it('a 302 throws NonRetryableError HTTP_302 and the request used redirect manual', async () => {
    const { requests, fetchImpl } = recorder(
      () => new Response(null, { status: 302, headers: { location: 'https://evil.test/' } }),
    );
    const client = new ApiClient({
      baseUrl: 'https://x.test',
      token: 'tok',
      authHeader: { header: 'X-Api-Key' },
      fetchImpl,
    });
    const err = await client.getJson('/a', Schema).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NonRetryableError);
    expect((err as NonRetryableError).code).toBe('HTTP_302');
    expect((err as Error).message).toBe('GET /a redirected; set the base URL to the final address');
    expect(requests[0]!.redirect).toBe('manual');
    expect(requests).toHaveLength(1);
  });

  it('paginate stops at maxPages with an error', async () => {
    const Page = z.object({ rows: z.array(z.number()) });
    const { fetchImpl } = recorder(() => json({ rows: [1] }));
    const client = new ApiClient({ baseUrl: 'https://x.test', fetchImpl });
    await expect(
      client.paginate('/rows', Page, {
        items: (p) => p.rows,
        next: () => ({ cursor: 'again' }),
        maxPages: 3,
      }),
    ).rejects.toThrow(/maxPages|3 pages/);
  });
});

describe('connectorEnv / forConnector', () => {
  const ctx = (baseUrl: string | null): ConnectorContext =>
    ({ dataSource: { baseUrl } }) as unknown as ConnectorContext;

  it('maps slug to env name', () => {
    vi.stubEnv('CONNECTOR_API_MYUNI_CLASSES_TOKEN', 't1');
    expect(connectorEnv('api-myuni-classes', 'TOKEN')).toBe('t1');
    expect(connectorEnv('api-myuni-classes', 'BASE_URL')).toBeUndefined();
  });

  it('forConnector prefers CONNECTOR_<SLUG>_BASE_URL over the data source baseUrl', async () => {
    vi.stubEnv('CONNECTOR_API_MYUNI_CLASSES_BASE_URL', 'https://env.test');
    vi.stubEnv('CONNECTOR_API_MYUNI_CLASSES_TOKEN', 'tok');
    const { requests, fetchImpl } = recorder(() => json({ ok: true }));
    const client = ApiClient.forConnector(ctx('https://ds.test'), 'api-myuni-classes', fetchImpl);
    await client.getJson('/a', Schema);
    expect(requests[0]!.url).toBe('https://env.test/a');
    expect(requests[0]!.headers.get('authorization')).toBe('Bearer tok');
  });

  it('forConnector falls back to the data source baseUrl, no token means no header', async () => {
    const { requests, fetchImpl } = recorder(() => json({ ok: true }));
    const client = ApiClient.forConnector(ctx('https://ds.test'), 'api-none', fetchImpl);
    await client.getJson('/a', Schema);
    expect(requests[0]!.url).toBe('https://ds.test/a');
    expect(requests[0]!.headers.get('authorization')).toBeNull();
  });

  it('forConnector throws CONFIG when no base URL exists', () => {
    expect(() => ApiClient.forConnector(ctx(null), 'api-none')).toThrow(NonRetryableError);
    try {
      ApiClient.forConnector(ctx(null), 'api-none');
    } catch (e) {
      expect((e as NonRetryableError).code).toBe('CONFIG');
      expect((e as Error).message).toBe(
        'No base URL: set CONNECTOR_<SLUG>_BASE_URL or the data source base URL.',
      );
    }
  });
});
