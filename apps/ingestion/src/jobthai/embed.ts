import { prisma } from '@kku/db';
import { embedWithRetry, type AiService } from '@kku/shared';

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
 * The design guessed 0.80. **Measured against the real vectors on 2026-09-13,
 * 0.80 is too HIGH**: across the five largest occupations, every one of the 40
 * nearest skills was genuinely relevant, and their cosines ran 0.712-0.808. A
 * 0.80 floor would have rejected 39 of 40 correct matches and made the
 * semantic pass silently useless rather than noisy — the opposite of the
 * failure mode the guess was hedging against.
 *
 * Examples at the observed band: QC/QA occupations → Quality Management 0.783,
 * Quality Control 0.773; warehousing → Warehouse Operations 0.808, Inventory
 * Management 0.723; maintenance → Machine Maintenance 0.759; purchasing →
 * Purchasing 0.789, Procurement 0.788.
 *
 * 0.72 reflects that evidence. It is still NOT the outcome of a labelled
 * precision study: 40 observations over 5 occupations is a sanity check, not
 * the ~100-sample hand-labelled set needed before a derived figure reaches a
 * Council surface. Run `pnpm jobthai:embed --inspect` to re-examine, and note
 * that below roughly 0.70 the neighbours become adjacent-but-arguable
 * ("Dispatching" 0.720 and "Clerical work" 0.753 for a purchasing role).
 *
 * The semantic match pass therefore remains disabled by default. This constant
 * exists so that when it is enabled, the threshold starts from measurement
 * rather than from a guess.
 */
export const JOBTHAI_EMBED_MATCH_FLOOR = 0.72;

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

/**
 * The vector(1536) columns date from prompt 01. The current Gemini embedding
 * model returns 3072 dimensions by default, which Postgres rejects outright
 * ("expected 1536 dimensions, not 3072"), so the request must ask for 1536.
 *
 * Gemini's embedding models are Matryoshka-trained, so a 1536-dimension output
 * is a valid truncation rather than a broken vector. Changing the columns to
 * 3072 would be the alternative, but that doubles the storage on every skill
 * and breaks any comparison against vectors already produced at 1536.
 */
export const EMBED_DIMENSIONS = 1536;

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
    const res = await embedWithRetry(
      ai,
      { ctx: { module: 'jobthai', kind: 'embedding.skill' }, texts, dimensions: EMBED_DIMENSIONS },
      { onRetry: ({ attempt, delayMs, error }) => console.warn(`  embed skill ${i}/${rows.length}: attempt ${attempt} failed (${error}) — retrying in ${Math.round(delayMs / 1000)}s`) },
    );
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
    const res = await embedWithRetry(
      ai,
      { ctx: { module: 'jobthai', kind: 'embedding.occupation' }, texts, dimensions: EMBED_DIMENSIONS },
      { onRetry: ({ attempt, delayMs, error }) => console.warn(`  embed occupation ${i}/${rows.length}: attempt ${attempt} failed (${error}) — retrying in ${Math.round(delayMs / 1000)}s`) },
    );
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
