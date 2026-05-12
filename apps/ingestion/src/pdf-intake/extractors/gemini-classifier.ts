import { Logger } from '@nestjs/common';
import {
  buildPdfClassifyMessages,
  PdfClassifyResultSchema,
  PDF_CLASSIFY_VERSION,
  type AiService,
  type ClassificationResult,
  type PdfClassifier,
  type PdfContext,
  type PdfLanguage,
  type PdfSourceCategory,
} from '@kku/shared';
import { StubClassifier } from './stub-classifier';

// ─────────────────────────────────────────────────────────────────────────
// Gemini-backed PDF classifier. Replaces the StubClassifier for intake.
//
// Behaviour:
//   - When ctx.ai is present, sends the first ~12k chars of the PDF text
//     through pdf-classify.v1 → returns the LLM's verdict.
//   - When ctx.ai is absent (no API key configured), falls back to the
//     StubClassifier so intake still completes — every PDF reaches the
//     review queue with whatever hint the operator provided.
//   - Same posture as CurriculumAiExtractor's stub-fallback.
//
// If the LLM call fails (parse error, network), we log + degrade to the
// stub. We never throw — a broken classifier shouldn't block intake.
// ─────────────────────────────────────────────────────────────────────────

export class GeminiPdfClassifier implements PdfClassifier {
  readonly methodVersion = PDF_CLASSIFY_VERSION;
  private readonly logger = new Logger(GeminiPdfClassifier.name);
  private readonly fallback = new StubClassifier();

  async classify(ctx: PdfContext): Promise<ClassificationResult> {
    if (!ctx.ai) {
      return this.fallback.classify(ctx);
    }
    return classifyWithAi({
      ai: ctx.ai,
      ctx,
      logger: this.logger,
      fallback: () => this.fallback.classify(ctx),
    });
  }
}

async function classifyWithAi(opts: {
  ai: AiService;
  ctx: PdfContext;
  logger: Logger;
  fallback: () => Promise<ClassificationResult>;
}): Promise<ClassificationResult> {
  // Head of doc — first ~3 pages or 12k chars, whichever comes first.
  const headPages = opts.ctx.pages.slice(0, 3);
  const headText = headPages
    .map((p) => p.textContent ?? '')
    .filter((t) => t.length > 0)
    .join('\n\n');
  if (headText.length === 0) {
    opts.logger.warn(
      `pdf-classify: no extractable text on ${opts.ctx.originalFilename} — falling back to stub`,
    );
    return opts.fallback();
  }

  try {
    const resp = await opts.ai.extractStructured(
      {
        ctx: { module: 'pdf-intake', kind: 'pdf-classify' },
        methodVersion: PDF_CLASSIFY_VERSION,
        messages: buildPdfClassifyMessages({
          originalFilename: opts.ctx.originalFilename,
          pageCount: opts.ctx.pageCount,
          headText,
          sourceCategoryHint: opts.ctx.sourceCategoryHint,
          sourceOrgHint: opts.ctx.sourceOrgHint,
        }),
        // 1500 — Pro models with thinking enabled spend a chunk of
        // tokens reasoning before they emit the JSON; 600 was clipping
        // mid-output and forcing the stub fallback.
        maxOutputTokens: 1500,
      },
      PdfClassifyResultSchema,
    );

    return {
      sourceCategory: resp.parsed.sourceCategory as PdfSourceCategory,
      language: resp.parsed.language as PdfLanguage,
      publishingOrg: resp.parsed.publishingOrg || undefined,
      documentDate: resp.parsed.documentDate
        ? safeParseDate(resp.parsed.documentDate)
        : undefined,
      confidence: resp.parsed.confidence,
      reasoning: resp.parsed.reasoning,
    };
  } catch (err) {
    opts.logger.warn(
      `pdf-classify failed for ${opts.ctx.originalFilename}: ${(err as Error).message} — falling back to stub`,
    );
    return opts.fallback();
  }
}

function safeParseDate(raw: string): Date | undefined {
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
