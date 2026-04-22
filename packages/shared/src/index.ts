import { z } from 'zod';

// Scope taxonomy used across the system (see CLAUDE.md §"Multi-level scope").
// Every analytical API accepts { scope, scopeId }.
export const ScopeSchema = z.enum(['university', 'faculty', 'department', 'program']);
export type Scope = z.infer<typeof ScopeSchema>;

export const ScopeParamsSchema = z.object({
  scope: ScopeSchema,
  scopeId: z.string().optional(),
});
export type ScopeParams = z.infer<typeof ScopeParamsSchema>;
