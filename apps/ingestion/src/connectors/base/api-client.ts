import type { z } from 'zod';
import type { ConnectorContext } from '@kku/shared';
import { NonRetryableError } from './base-connector';

type EnvName = 'TOKEN' | 'BASE_URL' | 'MAX_ROWS' | 'ALLOW_SHRINK';

/** Reads `CONNECTOR_<SLUG>_<NAME>` (slug upper-cased, `-` → `_`). */
export function connectorEnv(connectorSlug: string, name: EnvName): string | undefined {
  const key = `CONNECTOR_${connectorSlug.toUpperCase().replace(/-/g, '_')}_${name}`;
  const value = process.env[key];
  return value === undefined || value === '' ? undefined : value;
}

export interface ApiClientOptions {
  baseUrl: string;
  token?: string;
  authHeader?: 'bearer' | { header: string };
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

type Query = Record<string, string | number | undefined>;

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_PAGES = 1_000;

/**
 * Small JSON-over-HTTP helper for dataset API connectors. Error messages never
 * contain the response body or the token.
 */
export class ApiClient {
  private readonly baseUrl: string;
  private readonly token: string | undefined;
  private readonly authHeader: 'bearer' | { header: string };
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: ApiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.token = opts.token;
    this.authHeader = opts.authHeader ?? 'bearer';
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  static forConnector(
    ctx: ConnectorContext,
    connectorSlug: string,
    fetchImpl?: typeof fetch,
  ): ApiClient {
    const baseUrl = connectorEnv(connectorSlug, 'BASE_URL') ?? ctx.dataSource.baseUrl;
    if (!baseUrl) {
      throw new NonRetryableError(
        'CONFIG',
        'No base URL: set CONNECTOR_<SLUG>_BASE_URL or the data source base URL.',
      );
    }
    return new ApiClient({
      baseUrl,
      token: connectorEnv(connectorSlug, 'TOKEN'),
      fetchImpl,
    });
  }

  async getJson<T>(path: string, schema: z.ZodType<T>, query?: Query): Promise<T> {
    const url = new URL(`${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.token) {
      if (this.authHeader === 'bearer') headers['Authorization'] = `Bearer ${this.token}`;
      else headers[this.authHeader.header] = this.token;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const fail = (err: unknown): Error =>
      err instanceof Error && err.name === 'AbortError'
        ? new Error(`GET ${path} timed out after ${this.timeoutMs} ms`)
        : new Error(`GET ${path} failed: ${err instanceof Error ? err.name : 'network error'}`);

    let text: string;
    try {
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method: 'GET',
          headers,
          signal: controller.signal,
          redirect: 'manual',
        });
      } catch (err) {
        throw fail(err);
      }

      if (res.status >= 300 && res.status < 400) {
        throw new NonRetryableError(
          `HTTP_${res.status}`,
          `GET ${path} redirected; set the base URL to the final address`,
        );
      }
      if (!res.ok) {
        const message = `GET ${path} returned ${res.status}`;
        if (res.status === 401 || res.status === 403 || res.status === 404) {
          throw new NonRetryableError(`HTTP_${res.status}`, message);
        }
        throw new Error(message);
      }

      // The timer stays armed until the body has been fully read.
      try {
        text = await res.text();
      } catch (err) {
        throw fail(err);
      }
    } finally {
      clearTimeout(timer);
    }

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new NonRetryableError('SCHEMA', `${path}: response was not valid JSON`);
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      const paths = [
        ...new Set(parsed.error.issues.map((i) => (i.path.length ? i.path.join('.') : '(root)'))),
      ].join(', ');
      throw new NonRetryableError(
        'SCHEMA',
        `${path}: response did not match the expected shape (${paths})`,
      );
    }
    return parsed.data;
  }

  async paginate<P, T>(
    path: string,
    pageSchema: z.ZodType<P>,
    opts: {
      items: (page: P) => readonly T[];
      next: (page: P) => Record<string, string | number> | null;
      query?: Record<string, string | number>;
      maxPages?: number;
    },
  ): Promise<T[]> {
    const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;
    const out: T[] = [];
    let query: Query = { ...opts.query };
    for (let page = 1; ; page++) {
      const data = await this.getJson(path, pageSchema, query);
      out.push(...opts.items(data));
      const next = opts.next(data);
      if (next === null) return out;
      if (page >= maxPages) {
        throw new Error(`GET ${path}: still more data after maxPages (${maxPages} pages)`);
      }
      query = { ...opts.query, ...next };
    }
  }
}
