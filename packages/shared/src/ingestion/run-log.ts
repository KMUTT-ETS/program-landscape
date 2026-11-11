import { z } from 'zod';

// Wire shape of GET /data-sources/runs/:runId/logs — the per-run connector
// log read by the "Log" modal on /admin/data-sources/<slug>. Lines come from
// the `ingestion_run_logs` table written by ConnectorRunner.

export const RUN_LOG_PAGE_SIZE = 1_000;

export const RunLogQuerySchema = z.object({
  /** Return only lines with seq > afterSeq (0 = from the start). */
  afterSeq: z.coerce.number().int().min(0).default(0),
});
export type RunLogQuery = z.infer<typeof RunLogQuerySchema>;

export const RunLogLineSchema = z.object({
  seq: z.number().int(),
  ts: z.string(),
  level: z.enum(['INFO', 'WARN', 'ERROR']),
  message: z.string(),
  meta: z.unknown().nullable(),
});
export type RunLogLineDto = z.infer<typeof RunLogLineSchema>;

export const RunLogResponseSchema = z.object({
  runId: z.string(),
  status: z.enum(['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED']),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  lines: z.array(RunLogLineSchema),
  /** True when more than RUN_LOG_PAGE_SIZE lines remain after this page. */
  hasMore: z.boolean(),
});
export type RunLogResponse = z.infer<typeof RunLogResponseSchema>;

/** A run that will write no further lines. */
export function isRunLogFinal(status: RunLogResponse['status']): boolean {
  return status === 'SUCCEEDED' || status === 'FAILED' || status === 'SKIPPED';
}
