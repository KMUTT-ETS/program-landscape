import { PdfGenerationError } from './errors';
import type { GotenbergClient } from './gotenberg-client';
import type { TemplateRegistry } from './template-registry';
import type {
  MergeRequest,
  PdfResult,
  RenderHtmlOptions,
  RenderHtmlRequest,
} from './types';
import { RenderHtmlOptionsSchema } from './types';

// High-level PDF generation. One of these per process, wired in the
// NestJS PdfModule. The service:
//   1. Resolves the template by name
//   2. Validates the caller's `data` against the template's Zod schema
//   3. Renders the template to HTML (+ CSS + header/footer)
//   4. Calls Gotenberg to convert HTML → PDF
//   5. Retries once on UPSTREAM_UNAVAILABLE (fresh Chromium worker often
//      recovers on the next try); never retries RENDER_TIMEOUT (the
//      template itself is slow and will time out again).
//   6. Returns the buffer. Persistence + signed URLs happen one layer up
//      in the NestJS service so this core stays storage-agnostic.

export interface PdfGenerationServiceConfig {
  gotenberg: GotenbergClient;
  registry: TemplateRegistry;
  buildVersion: string;
}

export class PdfGenerationService {
  constructor(private readonly config: PdfGenerationServiceConfig) {}

  async renderHtml(req: RenderHtmlRequest): Promise<PdfResult> {
    const template = this.config.registry.get(req.templateName);
    const parseResult = template.schema.safeParse(req.data);
    if (!parseResult.success) {
      throw new PdfGenerationError(
        'PDF_TEMPLATE_DATA_INVALID',
        `Data for template "${template.name}" did not match its schema`,
        { issues: parseResult.error.issues },
      );
    }

    const rendered = await template.render(parseResult.data, {
      scope: req.scope
        ? { level: req.scope.level, id: req.scope.id }
        : undefined,
      app: {
        buildVersion: this.config.buildVersion,
        generatedAt: new Date(),
      },
    });

    const options = mergeOptions(template.defaultOptions, req.options);

    const indexHtml = buildIndexHtml({
      html: rendered.html,
      css: rendered.css,
      metadata: req.metadata,
    });

    const traceId = `${template.name}-${Date.now().toString(36)}`;

    const gotenbergResult = await this.withRetry(() =>
      this.config.gotenberg.convertHtml({
        indexHtml,
        options: {
          ...options,
          headerTemplate: rendered.headerHtml ?? options.headerTemplate,
          footerTemplate: rendered.footerHtml ?? options.footerTemplate,
        },
        traceId,
      }),
    );

    const pageCount = countPdfPages(gotenbergResult.buffer);

    return {
      buffer: gotenbergResult.buffer,
      byteSize: gotenbergResult.byteSize,
      pageCount,
      generationDurationMs: gotenbergResult.durationMs,
      templateName: template.name,
      templateVersion: template.version,
    };
  }

  async merge(req: MergeRequest): Promise<PdfResult> {
    const result = await this.withRetry(() => this.config.gotenberg.merge(req.pdfs));
    return {
      buffer: result.buffer,
      byteSize: result.byteSize,
      pageCount: countPdfPages(result.buffer),
      generationDurationMs: result.durationMs,
      templateName: '__merge__',
      templateVersion: '1',
    };
  }

  listTemplates() {
    return this.config.registry.list();
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      // Only retry transient upstream errors. Template/data errors are
      // deterministic and retrying would just waste resources.
      if (
        err instanceof PdfGenerationError &&
        err.code === 'PDF_UPSTREAM_UNAVAILABLE'
      ) {
        await new Promise((r) => setTimeout(r, 500));
        return fn();
      }
      throw err;
    }
  }
}

// Merges default + request options so every downstream field is populated.
function mergeOptions(
  defaults: Partial<RenderHtmlOptions> | undefined,
  requested: RenderHtmlOptions | undefined,
): RenderHtmlOptions {
  // Re-parse through the Zod schema to get defaults filled in consistently.
  return RenderHtmlOptionsSchema.parse({
    ...(defaults ?? {}),
    ...(requested ?? {}),
  });
}

// Builds the single `index.html` Gotenberg consumes. We inline the CSS
// rather than sending it as a separate file because:
//   - Chromium's HTML loader treats same-request file attachments as
//     same-origin only for specific paths; inlining avoids that quirk.
//   - It keeps the PDF reproducible — one HTML blob means one hash.
function buildIndexHtml(parts: {
  html: string;
  css?: string;
  metadata?: { title?: string; author?: string; subject?: string; keywords?: string[] };
}): string {
  const { html, css, metadata } = parts;
  const metaTags = [
    metadata?.title ? `<title>${escapeHtml(metadata.title)}</title>` : '',
    metadata?.author ? `<meta name="author" content="${escapeHtml(metadata.author)}">` : '',
    metadata?.subject ? `<meta name="subject" content="${escapeHtml(metadata.subject)}">` : '',
    metadata?.keywords?.length
      ? `<meta name="keywords" content="${escapeHtml(metadata.keywords.join(', '))}">`
      : '',
  ].filter(Boolean).join('\n    ');

  return `<!doctype html>
<html lang="th">
  <head>
    <meta charset="utf-8">
    ${metaTags}
    ${css ? `<style>${css}</style>` : ''}
  </head>
  <body>
${html}
  </body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Rough PDF page count. Counts `/Type /Page` occurrences in the raw
// stream — correct for every PDF Gotenberg produces in our tests. Not a
// general PDF parser; if we ever need more, pull in `pdf-lib`.
function countPdfPages(buffer: Buffer): number {
  const text = buffer.toString('latin1');
  const matches = text.match(/\/Type\s*\/Page[^s]/g);
  return matches?.length ?? 0;
}
