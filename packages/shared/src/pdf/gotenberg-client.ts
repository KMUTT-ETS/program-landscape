import { PdfGenerationError } from './errors';
import type { RenderHtmlOptions } from './types';

// Low-level HTTP client for Gotenberg 8's multipart API. Uses native
// Node 20 fetch + FormData + Blob — no extra HTTP deps required.
//
// Endpoint reference:
//   https://gotenberg.dev/docs/routes
//
// We only wrap the three routes the app uses:
//   POST /forms/chromium/convert/html    — HTML → PDF
//   POST /forms/libreoffice/convert      — Office doc → PDF
//   POST /forms/pdfengines/merge         — merge multiple PDFs

export interface GotenbergClientConfig {
  baseUrl: string;
  requestTimeoutMs: number;
}

export interface ConvertHtmlInput {
  // index.html is required; additional files (CSS, fonts, images) can be
  // attached and referenced from index.html by relative path.
  indexHtml: string;
  assets?: Array<{ name: string; content: string | Buffer; contentType?: string }>;
  options: RenderHtmlOptions;
  // Forwarded as Gotenberg's trace id — useful for correlating app logs
  // with Gotenberg's own logs.
  traceId?: string;
}

export interface ConvertResult {
  buffer: Buffer;
  byteSize: number;
  gotenbergTraceId?: string;
  durationMs: number;
}

export class GotenbergClient {
  constructor(private readonly config: GotenbergClientConfig) {}

  async convertHtml(input: ConvertHtmlInput): Promise<ConvertResult> {
    const form = new FormData();
    // Gotenberg requires the main HTML file to be named exactly
    // "index.html" — don't change this.
    form.append(
      'files',
      new Blob([input.indexHtml], { type: 'text/html' }),
      'index.html',
    );
    for (const asset of input.assets ?? []) {
      const blob =
        typeof asset.content === 'string'
          ? new Blob([asset.content], { type: asset.contentType ?? 'text/plain' })
          : new Blob([new Uint8Array(asset.content)], {
              type: asset.contentType ?? 'application/octet-stream',
            });
      form.append('files', blob, asset.name);
    }

    // Paper size / margins
    const opts = input.options;
    appendPaperFormat(form, opts.paperFormat, opts.orientation);
    form.append('marginTop', mmToInches(opts.marginsMm.top));
    form.append('marginBottom', mmToInches(opts.marginsMm.bottom));
    form.append('marginLeft', mmToInches(opts.marginsMm.left));
    form.append('marginRight', mmToInches(opts.marginsMm.right));
    form.append('printBackground', String(opts.printBackground));

    if (opts.headerTemplate) {
      form.append(
        'files',
        new Blob([opts.headerTemplate], { type: 'text/html' }),
        'header.html',
      );
    }
    if (opts.footerTemplate) {
      form.append(
        'files',
        new Blob([opts.footerTemplate], { type: 'text/html' }),
        'footer.html',
      );
    }
    if (opts.waitForExpression) {
      form.append('waitForExpression', opts.waitForExpression);
    }

    return this.post('/forms/chromium/convert/html', form, input.traceId);
  }

  async convertOffice(file: {
    name: string;
    bytes: Buffer;
  }): Promise<ConvertResult> {
    const form = new FormData();
    form.append(
      'files',
      new Blob([new Uint8Array(file.bytes)], { type: 'application/octet-stream' }),
      file.name,
    );
    return this.post('/forms/libreoffice/convert', form);
  }

  async merge(pdfs: Buffer[]): Promise<ConvertResult> {
    const form = new FormData();
    pdfs.forEach((buf, i) => {
      form.append(
        'files',
        new Blob([new Uint8Array(buf)], { type: 'application/pdf' }),
        // Ordering in the merged PDF follows alphabetical filename sort.
        `${String(i).padStart(4, '0')}.pdf`,
      );
    });
    return this.post('/forms/pdfengines/merge', form);
  }

  private async post(path: string, form: FormData, traceId?: string): Promise<ConvertResult> {
    const url = `${this.config.baseUrl.replace(/\/$/, '')}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    const start = Date.now();

    const headers: Record<string, string> = {};
    if (traceId) headers['Gotenberg-Trace'] = traceId;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        body: form,
        headers,
        signal: controller.signal,
      });
    } catch (err) {
      const isAbort = (err as { name?: string })?.name === 'AbortError';
      throw new PdfGenerationError(
        isAbort ? 'PDF_RENDER_TIMEOUT' : 'PDF_UPSTREAM_UNAVAILABLE',
        isAbort
          ? `Gotenberg exceeded ${this.config.requestTimeoutMs}ms timeout`
          : `Gotenberg unreachable: ${(err as Error).message}`,
        { url },
      );
    } finally {
      clearTimeout(timeout);
    }

    const durationMs = Date.now() - start;

    if (!response.ok) {
      const body = await response.text().catch(() => '<no body>');
      const code =
        response.status >= 500 ? 'PDF_UPSTREAM_UNAVAILABLE' : 'PDF_UPSTREAM_REJECTED';
      throw new PdfGenerationError(code, `Gotenberg ${response.status}: ${body.slice(0, 500)}`, {
        url,
        status: response.status,
      });
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return {
      buffer,
      byteSize: buffer.byteLength,
      gotenbergTraceId: response.headers.get('Gotenberg-Trace') ?? undefined,
      durationMs,
    };
  }
}

// Gotenberg expects paperWidth/paperHeight in inches. Pre-set standards
// so callers use semantic names, not raw numbers.
function appendPaperFormat(
  form: FormData,
  format: 'A4' | 'A3' | 'Letter',
  orientation: 'portrait' | 'landscape',
) {
  const dims = PAPER_DIMS_IN[format];
  const [w, h] = orientation === 'landscape' ? [dims[1], dims[0]] : dims;
  form.append('paperWidth', w.toString());
  form.append('paperHeight', h.toString());
}

const PAPER_DIMS_IN: Record<'A4' | 'A3' | 'Letter', [number, number]> = {
  A4: [8.27, 11.69],
  A3: [11.69, 16.54],
  Letter: [8.5, 11],
};

function mmToInches(mm: number): string {
  return (mm / 25.4).toFixed(3);
}
