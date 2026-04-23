import { z } from 'zod';

// ──────────────────────────────────────────────────────────────────────────
// Types shared between:
//   - the apps/ingestion pdf-intake worker (runs classifier + extractors)
//   - prompt 04 (fills the LLM-backed implementations)
//   - the review UI (consumes PdfExtraction.payloadJson)
//
// Keep prisma-independent so the shape can travel through the API
// envelope without pulling @prisma/client into the client bundle.
// ──────────────────────────────────────────────────────────────────────────

export const PdfSourceCategorySchema = z.enum([
  'POLICY',
  'REPORT',
  'CURRICULUM',
  'PEER_PROGRAM',
  'SURVEY',
  'COMMITTEE_MINUTES',
  'JOB_POSTINGS_BATCH',
  'OTHER',
]);
export type PdfSourceCategory = z.infer<typeof PdfSourceCategorySchema>;

export const PdfLanguageSchema = z.enum(['TH', 'EN', 'MIXED']);
export type PdfLanguage = z.infer<typeof PdfLanguageSchema>;

// ──────────────────────────────────────────────────────────────────────────
// Pipeline inputs — a small PdfContext that the classifier + each extractor
// receives. Keeps them from each re-reading the PDF bytes.
// ──────────────────────────────────────────────────────────────────────────

export interface PdfPageText {
  pageNumber: number;
  // Extracted text content. Undefined when a page is fully scanned and
  // OCR hasn't been applied yet — prompt 04 replaces this with vision-LLM
  // output for scanned pages.
  textContent: string | undefined;
  hasImages: boolean;
  hasTables: boolean;
}

export interface PdfContext {
  pdfDocumentId: string;
  originalFilename: string;
  pageCount: number;
  // All extracted page text concatenated, ready to feed an LLM prompt.
  // May be empty for scanned docs pre-OCR.
  fullText: string;
  pages: PdfPageText[];
  language: PdfLanguage;
  sourceCategoryHint?: PdfSourceCategory;
  sourceOrgHint?: string;
}

// ──────────────────────────────────────────────────────────────────────────
// Classifier contract
// ──────────────────────────────────────────────────────────────────────────

export interface ClassificationResult {
  sourceCategory: PdfSourceCategory;
  language: PdfLanguage;
  publishingOrg?: string;
  // Document date if the classifier can extract one (publication date,
  // fiscal year for reports, etc.). Null when unknown.
  documentDate?: Date | null;
  // 0..1 — below PipelineConfig.classifierAutoApproveThreshold the admin
  // review UI surfaces the PDF even if an extractor auto-approves.
  confidence: number;
  reasoning?: string;
}

export interface PdfClassifier {
  readonly methodVersion: string;
  classify(ctx: PdfContext): Promise<ClassificationResult>;
}

// ──────────────────────────────────────────────────────────────────────────
// Extractor contract — one per domain category
// ──────────────────────────────────────────────────────────────────────────

export const PdfExtractionTypeSchema = z.enum([
  'POLICY_DOC',
  'JOB_POSTING_BATCH',
  'CURRICULUM_SPEC',
  'PEER_PROGRAM',
  'LABOR_STAT',
  'SURVEY_RESULT',
  'COMMITTEE_MINUTES',
  'OTHER',
]);
export type PdfExtractionType = z.infer<typeof PdfExtractionTypeSchema>;

export interface ExtractionRecord {
  extractionType: PdfExtractionType;
  // Which target table the payload is shaped for. Downstream: the
  // apply-extraction step reads targetEntityType to know which Prisma
  // model to upsert. Keeping it as a string, not an enum, because new
  // extractors add new targets and we don't want a taxonomy lockstep.
  targetEntityType: string;
  // The structured payload — each extractor's payload schema is exported
  // from pdf-intake/payload-schemas.ts so the review UI can validate +
  // render a form per type.
  payload: unknown;
  confidence: number;
  reasoning?: string;
  // Suggested entity links the extractor proposes; the linking pass
  // (vector similarity in prompt 04) refines these. For now, extractors
  // return an empty array.
  proposedLinks?: Array<{
    entityType: 'skill' | 'program' | 'faculty' | 'department';
    candidateId?: string;
    displayName: string;
    confidence: number;
  }>;
}

export interface PdfExtractor {
  readonly name: string;          // human-readable label for the review UI
  readonly extractionType: PdfExtractionType;
  readonly methodVersion: string; // bump when the extractor's behaviour changes
  // Extractors are category-scoped — the worker picks the right extractor
  // by looking up classification.sourceCategory in a registry. Each
  // extractor returns 0-N extraction records (e.g. JobPostingsBatch fans
  // out to one record per posting).
  readonly appliesTo: readonly PdfSourceCategory[];
  extract(ctx: PdfContext): Promise<ExtractionRecord[]>;
}

// ──────────────────────────────────────────────────────────────────────────
// Pipeline outcome — the worker returns this; the runner writes it to
// the IngestionRun metadata + updates PdfDocument.
// ──────────────────────────────────────────────────────────────────────────

export interface PipelineOutcome {
  pdfDocumentId: string;
  classification: ClassificationResult;
  extractionCount: number;
  autoApproved: number;
  pendingReview: number;
  durationMs: number;
}

// ──────────────────────────────────────────────────────────────────────────
// Config — tuned in admin UI later; env overrides for now.
// ──────────────────────────────────────────────────────────────────────────

export const PipelineConfigSchema = z.object({
  // If classification.confidence < this, PdfDocument surfaces in the
  // review queue even if extraction auto-approves.
  classifierAutoApproveThreshold: z.number().min(0).max(1).default(0.7),
  // If extraction.confidence >= this, the extraction row is AUTO_APPROVED;
  // otherwise PENDING_REVIEW.
  extractorAutoApproveThreshold: z.number().min(0).max(1).default(0.8),
  // Pages above this count get chunk-processed by the worker (chunking
  // logic lands with prompt 04's real extractors).
  chunkThresholdPages: z.number().int().positive().default(50),
});
export type PipelineConfig = z.infer<typeof PipelineConfigSchema>;
