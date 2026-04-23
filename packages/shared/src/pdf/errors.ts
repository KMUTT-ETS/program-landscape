// Error taxonomy for PDF generation. The NestJS exception filter maps
// these to the API envelope's error.code field.

export const PDF_ERROR_CODES = [
  'PDF_TEMPLATE_NOT_FOUND',
  'PDF_TEMPLATE_DATA_INVALID',
  'PDF_RENDER_TIMEOUT',
  'PDF_UPSTREAM_UNAVAILABLE',   // Gotenberg unreachable or 5xx
  'PDF_UPSTREAM_REJECTED',       // Gotenberg 4xx (bad HTML, bad form params)
  'PDF_STORAGE_FAILED',
  'PDF_INTERNAL',
] as const;
export type PdfErrorCode = (typeof PDF_ERROR_CODES)[number];

export class PdfGenerationError extends Error {
  constructor(
    public readonly code: PdfErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'PdfGenerationError';
  }
}
