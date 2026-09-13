import { prisma } from '@kku/db';

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — the profession layer.
//
// One JobThaiOccupation per distinct (category, subcategory) pair. Both
// columns are 100% populated in the source and authoritative, so no LLM is
// involved here.
//
// NOTE ON COUNT: the design assumed 173 occupations, which was the number of
// distinct SUBCATEGORIES. Measured over the loaded corpus there are 240
// distinct PAIRS, because a subcategory recurs under more than one category.
// The pair is the right grain — it is what the source actually distinguishes.
// ─────────────────────────────────────────────────────────────────────────────

export interface PostingCategoryRow {
  jobCategory: string | null;
  jobSubcategory: string | null;
}

export interface DerivedOccupation {
  category: string;
  subcategory: string;
  code: string;
  postingCount: number;
}

/**
 * Stable, namespaced identifier reused as OccupationDemand.occupation_code.
 * The `jobthai:` prefix keeps these from ever colliding with a future ISCO-08
 * or NSO code in the same column.
 *
 * Thai text is kept verbatim rather than transliterated: a lossy slug would
 * collide across distinct disciplines, and this value is an internal key, not
 * a URL.
 */
export function occupationCode(category: string, subcategory: string): string {
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ');
  return `jobthai:${norm(category)}|${norm(subcategory)}`;
}

/** Groups postings by (category, subcategory). Rows missing either are
 *  skipped rather than bucketed under an invented placeholder. */
export function groupPostingsIntoOccupations(rows: ReadonlyArray<PostingCategoryRow>): DerivedOccupation[] {
  const acc = new Map<string, DerivedOccupation>();
  for (const r of rows) {
    const category = (r.jobCategory ?? '').trim();
    const subcategory = (r.jobSubcategory ?? '').trim();
    if (category === '' || subcategory === '') continue;
    const code = occupationCode(category, subcategory);
    const existing = acc.get(code);
    if (existing) existing.postingCount += 1;
    else acc.set(code, { category, subcategory, code, postingCount: 1 });
  }
  return [...acc.values()].sort((a, b) => b.postingCount - a.postingCount);
}

/** Upserts the occupation layer. Idempotent on (category, subcategory). */
export async function deriveOccupations(apply: boolean): Promise<{ occupations: number; postings: number }> {
  const rows = await prisma.jobPosting.findMany({
    where: { source: 'jobthai' },
    select: { jobCategory: true, jobSubcategory: true },
  });
  const derived = groupPostingsIntoOccupations(rows);
  if (!apply) return { occupations: derived.length, postings: rows.length };

  for (const d of derived) {
    await prisma.jobThaiOccupation.upsert({
      where: { category_subcategory: { category: d.category, subcategory: d.subcategory } },
      create: { category: d.category, subcategory: d.subcategory, code: d.code, postingCount: d.postingCount, typicalTasksTh: [] },
      update: { postingCount: d.postingCount, code: d.code },
    });
  }
  return { occupations: derived.length, postings: rows.length };
}
