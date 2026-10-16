// Parses the PUT /api/admin-organization response defensively: a proxy error
// (nginx 502 HTML) is not JSON, and `res.json()` on it would toast a raw
// parse error instead of something an admin can act on.
import { z } from 'zod';

const Envelope = z
  .object({
    data: z.unknown().optional(),
    error: z.object({ code: z.string().optional(), message: z.string().optional() }).nullish(),
  })
  .passthrough();

export interface SaveResponse {
  /** The parsed `data` field, or null when the body was not a JSON envelope. */
  body: unknown;
  errorCode: string | null;
  /** Set when the response is not ok. */
  errorMessage: string | null;
}

export async function readSaveResponse(res: Response): Promise<SaveResponse> {
  let parsed: z.infer<typeof Envelope> | null = null;
  try {
    const result = Envelope.safeParse(await res.json());
    parsed = result.success ? result.data : null;
  } catch {
    parsed = null;
  }
  const errorCode = parsed?.error?.code ?? null;
  const errorMessage = res.ok ? null : (parsed?.error?.message ?? `Save failed (${res.status})`);
  return { body: parsed?.data ?? null, errorCode, errorMessage };
}
