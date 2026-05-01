import type { AiInferenceRecorder, InferenceRecord } from '@kku/shared';
import { prisma } from './index';

// Prisma-backed AiInferenceRecorder. Providers in @kku/shared write via
// this so every LLM call leaves an audit trail. Lives in @kku/db to
// avoid a @kku/shared → @kku/db cycle; @kku/db already depends on
// @kku/shared for types.

export class PrismaAiInferenceRecorder implements AiInferenceRecorder {
  async record(r: InferenceRecord): Promise<{ id: string }> {
    const row = await prisma.aiInference.create({
      data: {
        userId: r.userId ?? null,
        module: r.module,
        kind: r.kind,
        prompt: sanitiseTextForPg(truncate(r.prompt, 100_000)),
        promptVersion: r.promptVersion,
        model: r.model,
        response: sanitiseTextForPg(truncate(r.response, 100_000)),
        confidence: r.confidence,
        sourcesJson: r.sourcesJson ? (r.sourcesJson as object) : undefined,
        tokensInput: r.tokensInput,
        tokensOutput: r.tokensOutput,
        latencyMs: r.latencyMs,
        costEstimateUsd: r.costEstimateUsd,
      },
      select: { id: true },
    });
    return { id: row.id };
  }
}

// Hard cap on prompt/response sizes — a 200k-character response is
// 99% of the time a bug. Chop + flag so Postgres TEXT doesn't chew RAM.
function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n…[truncated, was ${s.length} chars]`;
}

// Strip NUL bytes (U+0000) — Postgres TEXT/VARCHAR rejects them with
// `invalid byte sequence for encoding "UTF8": 0x00` and the whole row
// fails. Gemini occasionally emits a literal NUL in its output. We
// reference the NUL via String.fromCharCode rather than a literal in the
// source so the file itself stays NUL-free.
const NUL_CHAR = String.fromCharCode(0);
function sanitiseTextForPg(s: string): string {
  return s.indexOf(NUL_CHAR) >= 0 ? s.split(NUL_CHAR).join('') : s;
}
