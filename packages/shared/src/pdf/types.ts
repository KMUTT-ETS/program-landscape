import { z } from 'zod';
import { ScopeLevelSchema } from '../auth/scope-level';

// ══════════════════════════════════════════════════════════════════════════
// Public I/O shapes for PdfGenerationService. The NestJS controller
// validates requests against these Zod schemas before calling the service.
// ══════════════════════════════════════════════════════════════════════════

export const PaperFormatSchema = z.enum(['A4', 'A3', 'Letter']);
export type PaperFormat = z.infer<typeof PaperFormatSchema>;

export const OrientationSchema = z.enum(['portrait', 'landscape']);
export type Orientation = z.infer<typeof OrientationSchema>;

export const MarginsMmSchema = z.object({
  top: z.number().min(0).max(50).default(20),
  bottom: z.number().min(0).max(50).default(20),
  left: z.number().min(0).max(50).default(15),
  right: z.number().min(0).max(50).default(15),
});
export type MarginsMm = z.infer<typeof MarginsMmSchema>;

export const RenderHtmlOptionsSchema = z
  .object({
    paperFormat: PaperFormatSchema.default('A4'),
    orientation: OrientationSchema.default('portrait'),
    marginsMm: MarginsMmSchema.default({ top: 20, bottom: 20, left: 15, right: 15 }),
    headerTemplate: z.string().optional(),
    footerTemplate: z.string().optional(),
    printBackground: z.boolean().default(true),
    // JavaScript expression Gotenberg evaluates in Chromium before
    // snapshotting. Templates with async chart rendering set this to
    // `window.__pdfReady === true`. See docs/pdf-generation.md § wait-for-render.
    waitForExpression: z.string().optional(),
  })
  .default({});
export type RenderHtmlOptions = z.infer<typeof RenderHtmlOptionsSchema>;

export const PdfMetadataSchema = z
  .object({
    title: z.string().optional(),
    author: z.string().optional(),
    subject: z.string().optional(),
    keywords: z.array(z.string()).optional(),
  })
  .default({});
export type PdfMetadata = z.infer<typeof PdfMetadataSchema>;

export const RenderHtmlRequestSchema = z.object({
  templateName: z.string().min(1),
  // Typed per-template at the registry layer; we keep this as unknown here
  // so the service surface stays uniform.
  data: z.record(z.unknown()),
  options: RenderHtmlOptionsSchema.optional(),
  metadata: PdfMetadataSchema.optional(),
  scope: z
    .object({
      level: ScopeLevelSchema,
      id: z.string().nullable(),
    })
    .optional(),
});
export type RenderHtmlRequest = z.infer<typeof RenderHtmlRequestSchema>;

export const ConvertOfficeRequestSchema = z.object({
  fileName: z.string(),
  // LibreOffice reads the file by its extension, so the name must be
  // meaningful (e.g. "report.docx"). We pass through the raw bytes.
  bytes: z.instanceof(Buffer),
  metadata: PdfMetadataSchema.optional(),
});
export type ConvertOfficeRequest = z.infer<typeof ConvertOfficeRequestSchema>;

export const MergeRequestSchema = z.object({
  pdfs: z.array(z.instanceof(Buffer)).min(2),
  metadata: PdfMetadataSchema.optional(),
});
export type MergeRequest = z.infer<typeof MergeRequestSchema>;

// ══════════════════════════════════════════════════════════════════════════
// Result — what the service returns to the caller.
// ══════════════════════════════════════════════════════════════════════════

export interface PdfResult {
  buffer: Buffer;
  byteSize: number;
  pageCount: number;
  generationDurationMs: number;
  templateName: string;
  templateVersion: string;
  // Present after the result has been persisted to object storage and a
  // signed URL cut. The controller-facing wrapper adds this; the core
  // renderer returns the bytes only.
  storageKey?: string;
  signedUrl?: string;
  signedUrlExpiresAt?: Date;
}

// ══════════════════════════════════════════════════════════════════════════
// Template registry — templates are registered at module boot and looked
// up by name. Each template is a pure function from typed `data` to
// HTML string (+ matching CSS + optional header/footer HTML).
// ══════════════════════════════════════════════════════════════════════════

export interface TemplateRenderContext {
  scope?: { level: string; id: string | null };
  // Anything else the app wants to thread through — logo URL, user name
  // for the cover page, app build version for the footer.
  app: {
    buildVersion: string;
    generatedAt: Date;
  };
}

export interface TemplateRenderOutput {
  html: string;
  css?: string;
  headerHtml?: string;
  footerHtml?: string;
}

export interface TemplateDefinition<TData = unknown> {
  name: string;
  version: string;
  // Narrows `data: unknown` to the template's typed shape. Throws a Zod
  // error if invalid — the service turns it into a VALIDATION_FAILED
  // response so the caller sees the bad field(s).
  //
  // Input type is `unknown` because the registry only sees `unknown`
  // (`Record<string, unknown>` from HTTP), and schemas with `.default()`
  // have output fields the input doesn't require. Using `ZodType<TData>`
  // with its default input parameter forces callers to over-declare
  // inputs they never have.
  schema: z.ZodType<TData, z.ZodTypeDef, unknown>;
  // Default rendering options. Caller can override per-call.
  defaultOptions?: Partial<RenderHtmlOptions>;
  render(data: TData, ctx: TemplateRenderContext): TemplateRenderOutput | Promise<TemplateRenderOutput>;
}
