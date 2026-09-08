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

/**
 * How much of a figure came from a second, non-default writer.
 *
 * Added for Google Scholar, which imports ON DEMAND — one person, when they
 * press a button — so a research roll-up can move without the underlying
 * research changing. Council-readiness rule 1 requires the drawer to say so.
 *
 * `denominator` is not decoration: it is rendered verbatim beneath the ratio,
 * because "3 of 41 staff" means nothing until the reader knows which 41. A
 * ratio whose denominator is ambiguous is worse than no ratio.
 *
 * `countedInFigure` is what stops the disclosure from misleading in the other
 * direction: several roll-ups filter research through `realDataWhere()`, which
 * requires ingestion-run provenance the Scholar writer does not stamp, so they
 * exclude Scholar rows entirely. On those surfaces the composition is context
 * about the staff record, not about the number on screen, and the drawer says
 * which.
 */
export const ApiMetaSourceCompositionSchema = z.object({
  /** The non-default writer being disclosed, e.g. "Google Scholar". */
  label: z.string(),
  /** Staff in the denominator set carrying data from `label`. */
  staffCovered: z.number().int().min(0),
  /** Size of the staff denominator set. */
  staffTotal: z.number().int().min(0),
  /** Rows attributed to `label`. The more informative half of the ratio: a
   *  roster can be 3-of-41 on staff and 400-of-900 on papers, or the reverse,
   *  and the two say different things about how much the figure moved. */
  papersCovered: z.number().int().min(0),
  /** Rows from every writer. */
  papersTotal: z.number().int().min(0),
  /** What the staff denominator counts. Rendered verbatim — never
   *  paraphrased, and never inferred by the renderer. */
  denominator: z.string(),
  /** Whether the annotated figure actually counts `label`'s rows. FALSE does
   *  NOT mean `label` has no effect on the figure — see `caveats`. */
  countedInFigure: z.boolean(),
});
export type ApiMetaSourceComposition = z.infer<typeof ApiMetaSourceCompositionSchema>;

export const ApiMetaSchema = z.object({
  freshnessDate: z.string().datetime().nullable(),
  sources: z.array(ApiMetaSourceSchema),
  confidence: z.number().min(0).max(1).optional(),
  methodologyVersion: z.string().optional(),
  scope: ApiMetaScopeSchema.optional(),
  sourceComposition: ApiMetaSourceCompositionSchema.optional(),
  /** Known limits of this figure, in plain English. Rendered as a list in the
   *  provenance drawer — the slot the drawer has always reserved for them. */
  caveats: z.array(z.string()).optional(),
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
