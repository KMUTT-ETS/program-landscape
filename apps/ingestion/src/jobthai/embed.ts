import { prisma } from '@kku/db';
import type { AiService } from '@kku/shared';

// ─────────────────────────────────────────────────────────────────────────────
// Phase 4 — embeddings.
//
// Populates Skill.embedding and JobThaiOccupation.embedding. These vector(1536)
// columns have existed since prompt 01 and held zero rows; this is the first
// code in the project to fill them. They are durable and reusable — a skill
// vector serves any future semantic task, not just JobThai.
//
// THE SEMANTIC MATCH PASS IS IMPLEMENTED BUT NOT ENABLED BY DEFAULT. See
// JOBTHAI_EMBED_MATCH_FLOOR below for why.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cosine floor for accepting an embedding-based skill match.
 *
 * **0.80 is a STARTING VALUE, NOT A MEASURED ONE.** It must be validated
 * against a hand-checked sample of ~100 matches before any figure derived from
 * it reaches a Council-facing surface. An unvalidated similarity threshold
 * produces numbers that look precise and are not — and this project has
 * already been bitten by exactly that shape of error.
 *
 * Until that validation happens, `runSemanticPass` requires an explicit
 * `unvalidated: true` acknowledgement, so nobody writes EMBEDDING_MATCHED rows
 * by accident.
 */
export const JOBTHAI_EMBED_MATCH_FLOOR = 0.8;

export interface ExistingMatch {
  postingId: string;
  skillId: string;
  extractedBy: 'ALIAS_MATCHED' | 'EMBEDDING_MATCHED';
}

export interface SemanticCandidate {
  postingId: string;
  skillId: string;
  cosine: number;
}

export interface AcceptedMatch {
  postingId: string;
  skillId: string;
  extractedBy: 'EMBEDDING_MATCHED';
  cosine: number;
}

/**
 * Filters semantic candidates: above the floor, and not already matched
 * deterministically for the same (posting, skill).
 *
 * A deterministic hit is never downgraded to EMBEDDING_MATCHED — the cheap
 * exact signal outranks the fuzzy one, and a provenance drawer must not report
 * a dictionary hit as a vector guess.
 */
export function acceptSemanticMatches(input: {
  existing: ReadonlyArray<ExistingMatch>;
  candidates: ReadonlyArray<SemanticCandidate>;
  floor?: number;
}): AcceptedMatch[] {
  const floor = input.floor ?? JOBTHAI_EMBED_MATCH_FLOOR;
  const already = new Set(input.existing.map((e) => `${e.postingId}::${e.skillId}`));
  const out: AcceptedMatch[] = [];
  for (const c of input.candidates) {
    if (c.cosine < floor) continue;
    if (already.has(`${c.postingId}::${c.skillId}`)) continue;
    out.push({ postingId: c.postingId, skillId: c.skillId, extractedBy: 'EMBEDDING_MATCHED', cosine: c.cosine });
  }
  return out;
}

/** pgvector literal. Prisma cannot express the type, so vectors go via raw SQL. */
function toVectorLiteral(v: number[]): string {
  return `[${v.join(',')}]`;
}

const EMBED_BATCH = 96;

export interface EmbedResult {
  requested: number;
  written: number;
  costUsd: number;
}

/** Embeds every Skill lacking a vector. Idempotent: skips rows already filled. */
export async function embedSkills(ai: AiService, apply: boolean): Promise<EmbedResult> {
  const rows = await prisma.$queryRaw<Array<{ id: string; name_en: string; name_th: string }>>`
    SELECT id, name_en, name_th FROM skills WHERE embedding IS NULL ORDER BY id`;
  if (!apply || rows.length === 0) return { requested: rows.length, written: 0, costUsd: 0 };

  let written = 0;
  let costUsd = 0;
  for (let i = 0; i < rows.length; i += EMBED_BATCH) {
    const batch = rows.slice(i, i + EMBED_BATCH);
    // Both names in one string: the corpus mixes Thai and English freely, so a
    // bilingual vector matches either.
    const texts = batch.map((r) => `${r.name_en} / ${r.name_th}`);
    const res = await ai.embed({ ctx: { module: 'jobthai', method: 'embed-skill' } as never, texts });
    costUsd += res.cost.usd;
    for (let j = 0; j < batch.length; j++) {
      const vec = res.vectors[j];
      if (!vec) continue;
      await prisma.$executeRawUnsafe(
        `UPDATE skills SET embedding = $1::vector WHERE id = $2`,
        toVectorLiteral(vec),
        batch[j]!.id,
      );
      written += 1;
    }
  }
  return { requested: rows.length, written, costUsd };
}

/** Embeds every occupation lacking a vector, from its category + subcategory. */
export async function embedOccupations(ai: AiService, apply: boolean): Promise<EmbedResult> {
  const rows = await prisma.$queryRaw<Array<{ id: string; category: string; subcategory: string; profile_th: string | null }>>`
    SELECT id, category, subcategory, profile_th FROM jobthai_occupations WHERE embedding IS NULL ORDER BY id`;
  if (!apply || rows.length === 0) return { requested: rows.length, written: 0, costUsd: 0 };

  let written = 0;
  let costUsd = 0;
  for (let i = 0; i < rows.length; i += EMBED_BATCH) {
    const batch = rows.slice(i, i + EMBED_BATCH);
    const texts = batch.map((r) => `${r.category} / ${r.subcategory}${r.profile_th ? ` — ${r.profile_th}` : ''}`);
    const res = await ai.embed({ ctx: { module: 'jobthai', method: 'embed-occupation' } as never, texts });
    costUsd += res.cost.usd;
    for (let j = 0; j < batch.length; j++) {
      const vec = res.vectors[j];
      if (!vec) continue;
      await prisma.$executeRawUnsafe(
        `UPDATE jobthai_occupations SET embedding = $1::vector WHERE id = $2`,
        toVectorLiteral(vec),
        batch[j]!.id,
      );
      written += 1;
    }
  }
  return { requested: rows.length, written, costUsd };
}

/**
 * Nearest skills to an occupation by cosine distance. Read-only, and the
 * intended way to INSPECT semantic matching before trusting it: run this,
 * eyeball the results, then decide whether the floor is right.
 */
export async function nearestSkillsForOccupation(
  occupationId: string,
  limit = 10,
): Promise<Array<{ skillId: string; nameEn: string; nameTh: string; cosine: number }>> {
  const rows = await prisma.$queryRaw<Array<{ id: string; name_en: string; name_th: string; cosine: number }>>`
    SELECT s.id, s.name_en, s.name_th,
           1 - (s.embedding <=> o.embedding) AS cosine
    FROM jobthai_occupations o
    CROSS JOIN skills s
    WHERE o.id = ${occupationId}
      AND o.embedding IS NOT NULL
      AND s.embedding IS NOT NULL
    ORDER BY s.embedding <=> o.embedding
    LIMIT ${limit}`;
  return rows.map((r) => ({ skillId: r.id, nameEn: r.name_en, nameTh: r.name_th, cosine: Number(r.cosine) }));
}
