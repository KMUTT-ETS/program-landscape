import { z } from 'zod';
import { ScopeLevelSchema } from '../auth/scope-level';

// Every successful analytical endpoint must return THIS envelope — the
// frontend, PDFs, and Council Pack generators all depend on it being
// consistent. See CLAUDE.md → "Council-readiness rules".

export const ApiMetaScopeSchema = z.object({
  level: ScopeLevelSchema,
  id: z.string().nullable(),
});
export type ApiMetaScope = z.infer<typeof ApiMetaScopeSchema>;

export const ApiMetaSourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string().url().nullable().optional(),
});
export type ApiMetaSource = z.infer<typeof ApiMetaSourceSchema>;

export const ApiMetaSchema = z.object({
  freshnessDate: z.string().datetime().nullable(),
  sources: z.array(ApiMetaSourceSchema),
  confidence: z.number().min(0).max(1).optional(),
  methodologyVersion: z.string().optional(),
  scope: ApiMetaScopeSchema.optional(),
});
export type ApiMeta = z.infer<typeof ApiMetaSchema>;

export interface ApiSuccess<T> {
  data: T;
  meta: ApiMeta;
  error: null;
}

export interface ApiFailure {
  data: null;
  meta: null;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;

// Helper for services to return data without worrying about envelope shape —
// the response interceptor wraps it.
export type Rawish<T> = T | { data: T; meta?: Partial<ApiMeta> };
