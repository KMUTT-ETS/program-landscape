// Low-level HTTP client for the markitdown sidecar (infra/markitdown). Uses
// native Node 20 fetch + FormData + Blob — no extra HTTP deps. Mirrors the
// GotenbergClient pattern (packages/shared/src/pdf/gotenberg-client.ts).
//
// The single route we wrap:
//   POST /convert  — multipart `file` → { markdown, title }
//
// markitdown reads documents IN (→ Markdown); Gotenberg writes PDFs OUT.
// This client is server-only (Node APIs) — client components must
// `import type` only from @kku/shared.

export type MarkitdownErrorCode =
  | 'MARKITDOWN_UNAVAILABLE' // network error or 5xx — sidecar down/erroring
  | 'MARKITDOWN_TIMEOUT' // request exceeded the configured timeout
  | 'MARKITDOWN_REJECTED'; // 4xx — unsupported/corrupt input or bad response shape

export class MarkitdownConversionError extends Error {
  constructor(
    public readonly code: MarkitdownErrorCode,
    message: string,
    public readonly meta?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'MarkitdownConversionError';
  }
}

export interface MarkitdownClientConfig {
  baseUrl: string;
  requestTimeoutMs: number;
}

export interface MarkitdownConvertInput {
  bytes: Buffer;
  // Used by the sidecar to pick the right converter from the extension, so
  // pass a name with a meaningful suffix (e.g. "report.docx", "page.html").
  filename: string;
}

export interface MarkitdownResult {
  markdown: string;
  title?: string;
  durationMs: number;
}

export class MarkitdownClient {
  constructor(private readonly config: MarkitdownClientConfig) {}

  async convert(input: MarkitdownConvertInput): Promise<MarkitdownResult> {
    const url = `${this.config.baseUrl.replace(/\/$/, '')}/convert`;
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(input.bytes)], { type: 'application/octet-stream' }),
      input.filename,
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    const start = Date.now();

    let response: Response;
    try {
      response = await fetch(url, { method: 'POST', body: form, signal: controller.signal });
    } catch (err) {
      const isAbort = (err as { name?: string })?.name === 'AbortError';
      throw new MarkitdownConversionError(
        isAbort ? 'MARKITDOWN_TIMEOUT' : 'MARKITDOWN_UNAVAILABLE',
        isAbort
          ? `markitdown exceeded ${this.config.requestTimeoutMs}ms timeout`
          : `markitdown unreachable: ${(err as Error).message}`,
        { url },
      );
    } finally {
      clearTimeout(timeout);
    }

    const durationMs = Date.now() - start;

    if (!response.ok) {
      const body = await response.text().catch(() => '<no body>');
      const code: MarkitdownErrorCode =
        response.status >= 500 ? 'MARKITDOWN_UNAVAILABLE' : 'MARKITDOWN_REJECTED';
      throw new MarkitdownConversionError(code, `markitdown ${response.status}: ${body.slice(0, 500)}`, {
        url,
        status: response.status,
      });
    }

    const data = (await response.json().catch(() => null)) as
      | { markdown?: string; title?: string | null }
      | null;
    if (!data || typeof data.markdown !== 'string') {
      throw new MarkitdownConversionError(
        'MARKITDOWN_REJECTED',
        'markitdown returned an unexpected response shape',
        { url },
      );
    }

    return { markdown: data.markdown, title: data.title ?? undefined, durationMs };
  }
}
