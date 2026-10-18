export * from './auth';
export * from './api';
export * from './pdf';
export * from './markitdown';
export * from './storage';
export * from './ingestion';
export * from './pdf-intake';
export * from './ai';
export * from './skills';
// Also reachable as `@kku/shared/demand/sources` — client components MUST
// use that subpath, not this barrel (which pulls node:crypto).
export * from './demand/sources';
export * from './forecasting';
export * from './scenarios';
export * from './analyst';
export * from './programs';
export * from './geo/thailand-regions';
export * from './dq/modules';
export * from './dq/module-skills';
export * from './aunqa/criteria';
export * from './identity';
export * from './institution';
export * from './organization';
export * from './net';
export * from './observability';
export * from './resilience';
export * from './scholar';
// Also reachable as `@kku/shared/usage` — the client recorder MUST use that
// subpath, not this barrel (which pulls node:crypto).
export * from './usage';
// Also reachable as `@kku/shared/pipeline/program-phases` — client components
// MUST use that subpath, not this barrel (which pulls node:crypto).
export * from './pipeline/program-phases';
export * from './job108';

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
export * from './staff-profile';

export * from './brand';

// Pure predicates — no `xlsx`, no Prisma — safe on the root barrel.
export * from './privacy';
