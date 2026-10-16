// Error taxonomy — codes are stable and machine-readable. HTTP status is
// picked by the NestJS exception filter (see apps/api/src/common/
// exception.filter.ts).

export const API_ERROR_CODES = [
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION_FAILED',
  'SCOPE_DENIED',
  'RATE_LIMITED',
  'UPSTREAM_UNAVAILABLE',
  'AI_PROVIDER_ERROR',
  'ORG_NOT_CONFIGURED',
  'ORG_VERSION_CONFLICT',
  'INTERNAL',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
