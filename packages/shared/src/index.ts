export * from './auth';
export * from './api';
export * from './pdf';
export * from './storage';
export * from './ingestion';
export * from './pdf-intake';
export * from './ai';
export * from './skills';
export * from './forecasting';
export * from './scenarios';

import { z } from 'zod';
import { ScopeLevelSchema } from './auth/scope-level';

// Legacy alias — prefer ScopeLevelSchema from './auth'. Kept for one or two
// call sites and removed once those migrate.
export const ScopeSchema = ScopeLevelSchema;
export type Scope = z.infer<typeof ScopeSchema>;

export const ScopeParamsSchema = z.object({
  scope: ScopeSchema,
  scopeId: z.string().optional(),
});
export type ScopeParams = z.infer<typeof ScopeParamsSchema>;
