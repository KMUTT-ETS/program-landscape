// program-overlap.v1 — vector columns are Unsupported("vector(1536)") so they
// go through raw SQL. Every read is Zod-validated (repo rule for $queryRaw).
import { z } from 'zod';
import { prisma } from '../index';

export const EMBED_DIMENSIONS = 1536;

export function l2normalise(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return n === 0 ? v.map(() => 0) : v.map((x) => x / n);
}

export function toVectorLiteral(v: number[]): string {
  return `[${v.join(',')}]`;
}

const VectorText = z.string().regex(/^\[.*\]$/);
export function parseVectorText(text: string): number[] {
  const t = VectorText.parse(text);
  const parts = t.slice(1, -1).split(',').map(Number);
  if (parts.some((x) => !Number.isFinite(x))) throw new Error('malformed vector');
  return parts;
}

const IdVecRow = z.object({ id: z.string(), v: z.string() });

/** PLO vectors for the given programmes: programId → [{ordinal, vector}]. */
export async function readPloVectors(programIds: string[]): Promise<Map<string, Array<{ ordinal: number; text: string; vector: number[] }>>> {
  const out = new Map<string, Array<{ ordinal: number; text: string; vector: number[] }>>();
  if (programIds.length === 0) return out;
  const rows = z
    .array(z.object({ program_id: z.string(), ordinal: z.number(), text: z.string(), v: z.string() }))
    .parse(
      await prisma.$queryRaw`
        SELECT program_id, ordinal, text_normalised AS text, embedding::text AS v
        FROM program_learning_outcomes
        WHERE program_id = ANY(${programIds}) AND embedding IS NOT NULL
        ORDER BY program_id, ordinal`,
    );
  for (const r of rows) {
    const list = out.get(r.program_id) ?? [];
    list.push({ ordinal: r.ordinal, text: r.text, vector: parseVectorText(r.v) });
    out.set(r.program_id, list);
  }
  return out;
}

/** Course vectors keyed by ProgramCourse.id. */
export async function readCourseVectors(courseIds: string[]): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  if (courseIds.length === 0) return out;
  const rows = z.array(IdVecRow).parse(
    await prisma.$queryRaw`
      SELECT id, embedding::text AS v FROM program_courses
      WHERE id = ANY(${courseIds}) AND embedding IS NOT NULL`,
  );
  for (const r of rows) out.set(r.id, parseVectorText(r.v));
  return out;
}

/** Market-profile vectors keyed by programId. */
export async function readMarketVectors(programIds: string[]): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  if (programIds.length === 0) return out;
  const rows = z.array(z.object({ program_id: z.string(), v: z.string() })).parse(
    await prisma.$queryRaw`
      SELECT program_id, embedding::text AS v FROM program_market_profiles
      WHERE program_id = ANY(${programIds}) AND embedding IS NOT NULL`,
  );
  for (const r of rows) out.set(r.program_id, parseVectorText(r.v));
  return out;
}

export type VectorTable = 'program_learning_outcomes' | 'program_courses' | 'program_market_profiles';

/** Writes one vector + its text hash. `idColumn` is `id` or `program_id`. */
// SAFETY: `table`, `idColumn` and `hashColumn` come from closed unions, never user input.
export async function writeVector(table: VectorTable, idColumn: 'id' | 'program_id', id: string, vector: number[], textHash: string): Promise<void> {
  const hashColumn = table === 'program_market_profiles' ? 'text_hash' : 'embedding_text_hash';
  await prisma.$executeRawUnsafe(
    `UPDATE ${table} SET embedding = $1::vector, ${hashColumn} = $2 WHERE ${idColumn} = $3`,
    toVectorLiteral(l2normalise(vector)),
    textHash,
    id,
  );
}
