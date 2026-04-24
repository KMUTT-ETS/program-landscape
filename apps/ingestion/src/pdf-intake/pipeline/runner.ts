import { Logger } from '@nestjs/common';
import { Prisma, prisma } from '@kku/db';
import {
  S3Storage,
  type AiService,
  type PdfClassifier,
  type PdfContext,
  type PdfExtractor,
  type PipelineConfig,
  type PipelineOutcome,
} from '@kku/shared';
import { extractNativeText } from './native-text-extractor';
import { extractorsFor } from '../extractors';

// Orchestrates the intake pipeline for one PdfDocument.
//
// Lifecycle:
//   1. Mark PdfDocument.processingStatus = PROCESSING
//   2. Fetch bytes from MinIO
//   3. Native text extraction (pdfjs-dist) → per-page rows + fullText
//   4. If likely scanned: leave processingStatus = PROCESSING and mark
//      ocrApplied = false. Prompt 04 wires Claude vision to finish this
//      path. Today scanned PDFs park there visibly in the admin UI.
//   5. Classify (stub today)
//   6. Pick extractors for classification.sourceCategory
//   7. Run each extractor → write PdfExtraction rows with reviewStatus
//      chosen by confidence threshold
//   8. Mark PdfDocument.processingStatus = COMPLETED
//   9. Return PipelineOutcome (queue writer logs it)
//
// Every step is instrumented — a failure anywhere marks processingStatus
// = FAILED with processingError set, and re-throws so BullMQ retries.

export interface PipelineDeps {
  classifier: PdfClassifier;
  storage: S3Storage;
  rawBucket: string;
  config: PipelineConfig;
  // Optional AI handle — AI-backed extractors (curriculum) consume it via
  // PdfContext.ai. Undefined when no provider is configured; extractors
  // fall back to heuristics.
  ai?: AiService;
}

export class PdfIntakePipeline {
  private readonly logger = new Logger('PdfIntakePipeline');

  constructor(private readonly deps: PipelineDeps) {}

  async process(pdfDocumentId: string): Promise<PipelineOutcome> {
    const startedAt = Date.now();

    // Load + flip to PROCESSING in one call so two workers can't race on
    // the same row. If the update returns zero rows (already PROCESSING
    // or beyond), bail out with SKIPPED-style behaviour.
    const pdf = await prisma.pdfDocument.findUnique({ where: { id: pdfDocumentId } });
    if (!pdf) {
      throw new Error(`PdfDocument ${pdfDocumentId} not found`);
    }
    if (pdf.processingStatus !== 'PENDING') {
      this.logger.warn(`Skipping ${pdfDocumentId} — status is ${pdf.processingStatus}`);
      // Not an error — just a no-op. Return a minimal outcome.
      return {
        pdfDocumentId,
        classification: {
          sourceCategory: pdf.sourceCategory,
          language: pdf.language,
          confidence: pdf.classificationConfidence ?? 0,
        },
        extractionCount: 0,
        autoApproved: 0,
        pendingReview: 0,
        durationMs: 0,
      };
    }

    await prisma.pdfDocument.update({
      where: { id: pdfDocumentId },
      data: { processingStatus: 'PROCESSING', processingError: null },
    });

    try {
      // 1. Fetch bytes from MinIO.
      const bytes = await this.fetchBytes(pdf.storageUrl);

      // 2. Native text extraction.
      const extraction = await extractNativeText(bytes);

      // Persist pages. Upsert per (pdfDocumentId, pageNumber) so
      // re-extraction overwrites instead of duplicating.
      await prisma.pdfPage.deleteMany({ where: { pdfDocumentId } });
      await prisma.pdfPage.createMany({
        data: extraction.pages.map((p) => ({
          pdfDocumentId,
          pageNumber: p.pageNumber,
          textContent: p.textContent ?? null,
          hasImages: p.hasImages,
          hasTables: p.hasTables,
        })),
      });

      // 3. Scanned check — park PDF visibly and return. The review UI
      // surfaces "awaiting OCR" so an admin knows this is queued for
      // the vision-LLM path that lands with prompt 04.
      if (extraction.isLikelyScanned) {
        await prisma.pdfDocument.update({
          where: { id: pdfDocumentId },
          data: {
            pageCount: extraction.pages.length,
            processingStatus: 'PROCESSING',
            processingError:
              'Scanned PDF: awaiting OCR (prompt 04 will wire Claude vision for this path).',
            ocrApplied: false,
          },
        });
        return {
          pdfDocumentId,
          classification: {
            sourceCategory: pdf.sourceCategory,
            language: pdf.language,
            confidence: 0,
          },
          extractionCount: 0,
          autoApproved: 0,
          pendingReview: 0,
          durationMs: Date.now() - startedAt,
        };
      }

      // 4. Build PdfContext and classify.
      const ctx: PdfContext = {
        pdfDocumentId,
        originalFilename: pdf.originalFilename,
        pageCount: extraction.pages.length,
        fullText: extraction.fullText,
        pages: extraction.pages,
        language: pdf.language,
        sourceCategoryHint: pdf.sourceCategoryHint ?? undefined,
        sourceOrgHint: pdf.sourceOrg ?? undefined,
        ai: this.deps.ai,
      };
      const classification = await this.deps.classifier.classify(ctx);

      // 5. Pick extractors and run them sequentially (prompt 04 can
      // parallelise once the real LLM latencies dominate).
      const extractors = extractorsFor(classification.sourceCategory);
      let autoApproved = 0;
      let pendingReview = 0;
      const extractionRows: Array<{
        extractor: PdfExtractor;
        records: Awaited<ReturnType<PdfExtractor['extract']>>;
      }> = [];
      for (const extractor of extractors) {
        const records = await extractor.extract(ctx);
        extractionRows.push({ extractor, records });
      }

      // Persist PdfExtraction rows — one per ExtractionRecord.
      // Wipe prior extractions of the same methodVersion+type so
      // re-processing doesn't pile up rows; keep historical rows with
      // different methodVersion so we can audit when behaviour changes.
      for (const { extractor, records } of extractionRows) {
        await prisma.pdfExtraction.deleteMany({
          where: {
            pdfDocumentId,
            extractionType: extractor.extractionType,
            methodVersion: extractor.methodVersion,
          },
        });
        for (const r of records) {
          const autoApprove =
            r.confidence >= this.deps.config.extractorAutoApproveThreshold &&
            classification.confidence >= this.deps.config.classifierAutoApproveThreshold;
          if (autoApprove) autoApproved++; else pendingReview++;

          await prisma.pdfExtraction.create({
            data: {
              pdfDocumentId,
              extractionType: extractor.extractionType,
              targetEntityType: r.targetEntityType,
              confidence: r.confidence,
              methodVersion: extractor.methodVersion,
              reviewStatus: autoApprove ? 'AUTO_APPROVED' : 'PENDING_REVIEW',
              payloadJson: r.payload as Prisma.InputJsonValue,
              reasoning: r.reasoning,
            },
          });
        }
      }

      // 6. Mark done. We stamp the classifier's verdict onto the PDF so
      // the admin UI filters work without joining to PdfExtraction. If
      // an uploader explicitly set sourceCategory (via the upload form),
      // don't overwrite it — they know better than the stub classifier.
      await prisma.pdfDocument.update({
        where: { id: pdfDocumentId },
        data: {
          pageCount: extraction.pages.length,
          processingStatus: 'COMPLETED',
          processingError: null,
          language: classification.language ?? pdf.language,
          classificationConfidence: classification.confidence,
          // Only update sourceCategory when we actually have a verdict
          // above 0 — the stub returns confidence 0 with OTHER, and we
          // don't want that clobbering a real hint-derived value.
          sourceCategory:
            classification.confidence > 0 && !pdf.sourceCategoryHint
              ? classification.sourceCategory
              : pdf.sourceCategory,
          sourceOrg: classification.publishingOrg ?? pdf.sourceOrg,
        },
      });

      return {
        pdfDocumentId,
        classification,
        extractionCount: autoApproved + pendingReview,
        autoApproved,
        pendingReview,
        durationMs: Date.now() - startedAt,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Intake failed for ${pdfDocumentId}: ${message}`);
      await prisma.pdfDocument.update({
        where: { id: pdfDocumentId },
        data: {
          processingStatus: 'FAILED',
          processingError: message.slice(0, 2000),
        },
      });
      throw err;
    }
  }

  private async fetchBytes(storageUrl: string): Promise<Buffer> {
    // storageUrl is `s3://<bucket>/<key>`. Parse.
    const match = /^s3:\/\/([^/]+)\/(.+)$/.exec(storageUrl);
    if (!match) throw new Error(`Unexpected storageUrl: ${storageUrl}`);
    const [, bucket, key] = match;
    if (!bucket || !key) throw new Error(`Malformed storageUrl: ${storageUrl}`);

    // Use a short-lived signed URL + fetch. Cleaner than extending S3Storage
    // with a getObject that returns bytes — keeps the storage adapter
    // read-optimised for browser consumption.
    const url = await this.deps.storage.getSignedDownloadUrl({
      bucket,
      key,
      ttlSeconds: 60,
    });
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch PDF bytes from ${storageUrl}: HTTP ${res.status}`);
    }
    const arr = await res.arrayBuffer();
    return Buffer.from(arr);
  }
}
