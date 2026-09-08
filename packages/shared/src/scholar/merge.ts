// packages/shared/src/scholar/merge.ts
export interface ScholarPaper {
  scholarPaperId: string;
  title: string;
  year: number;
  doi: string | null;
  citations: number;
  venue: string | null;
  type: string | null;
}

export interface ExistingOutput {
  id: string;
  title: string;
  year: number;
  doi: string | null;
  citations: number;
}

export interface ScholarMergePlan {
  /** Papers the library does not have. */
  inserts: ScholarPaper[];
  /** Existing rows whose citation count Scholar raises. Metadata untouched. */
  citationUpdates: { id: string; citations: number; scholarPaperId: string }[];
}

/** Lowercase, strip diacritics and punctuation, collapse whitespace. */
export function normaliseTitle(t: string): string {
  return t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Decide what a Scholar fetch would write. Pure.
 *
 * THE PLAN HAS NO DELETE FIELD, and must not gain one. Library rows are the
 * failover: if a fetch is empty, partial or wrong, everything the user already
 * had must still be there. On 2026-09-07 the program-courses-extract
 * materialiser did an unconditional delete-and-replace and destroyed 56
 * courses on a failed call while reporting success — this shape exists so
 * that cannot happen here.
 */
export function planScholarMerge(input: {
  scholar: ScholarPaper[];
  existing: ExistingOutput[];
}): ScholarMergePlan {
  const { scholar, existing } = input;
  const byDoi = new Map(existing.filter((e) => e.doi).map((e) => [e.doi!.toLowerCase(), e]));
  const byTitleYear = new Map(existing.map((e) => [`${normaliseTitle(e.title)}::${e.year}`, e]));

  const inserts: ScholarPaper[] = [];
  const citationUpdates: ScholarMergePlan['citationUpdates'] = [];
  const claimed = new Set<string>();

  for (const p of scholar) {
    const hit =
      (p.doi ? byDoi.get(p.doi.toLowerCase()) : undefined) ??
      byTitleYear.get(`${normaliseTitle(p.title)}::${p.year}`);

    if (!hit) { inserts.push(p); continue; }
    if (claimed.has(hit.id)) continue;      // two Scholar rows onto one library row
    claimed.add(hit.id);
    // Only ever raise. A lower count means a bad parse or a partial page, not a
    // correction — Scholar counts run higher than Scopus by design (preprints,
    // theses, non-indexed venues).
    if (p.citations > hit.citations) {
      citationUpdates.push({ id: hit.id, citations: p.citations, scholarPaperId: p.scholarPaperId });
    }
  }

  return { inserts, citationUpdates };
}
