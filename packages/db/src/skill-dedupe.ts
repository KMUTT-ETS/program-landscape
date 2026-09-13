// ─────────────────────────────────────────────────────────────────────────────
// Skill taxonomy de-duplication.
//
// WHY THIS EXISTS: 386 groups of `skills` rows share a name
// case-insensitively — 456 redundant rows, 10.3% of the taxonomy. "Data
// Science" exists five times. Every one carries a `linkedin-*` code and was
// created in a single bulk run on 2026-05-02.
//
// ROOT CAUSE, fixed separately in apps/ingestion/src/scripts/normalise-skill-
// names.ts: the auto-promote path built a code by slugifying the canonical
// name, and on collision appended `-2`, `-3` … under a comment calling it
// "race-safe". A slug collision on a canonical name is not a race; it is the
// signal that the skill already exists. The path had the evidence and
// manufactured a new identity instead. Aggravated by candidate selection being
// "newest 30" rather than similarity-ranked, so the model frequently could not
// see the existing row and answered NEW_PROPOSED.
//
// WHY IT MATTERS BEYOND TIDINESS: a programme's ProgramSkill may point at one
// "Data Science" row while a demand set points at another, so a skill-overlap
// match silently fails and a well-aligned programme reads as misaligned. It
// also splits every share-weighted aggregate across up to five rows.
// ─────────────────────────────────────────────────────────────────────────────

export interface SkillRowForMerge {
  id: string;
  code: string;
  nameEn: string;
  nameTh: string;
  category: string | null;
  createdAt: Date;
  /** Count of inbound references across every child table. */
  references: number;
}

export interface MergePlan {
  /** Normalised name the group shares. */
  key: string;
  keep: SkillRowForMerge;
  drop: SkillRowForMerge[];
  /** Alternate names worth preserving as aliases so lookups still resolve. */
  aliasNames: string[];
}

export function normaliseSkillName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** True when a code looks like the disambiguating suffix the bug produced. */
export function hasDisambiguatingSuffix(code: string): boolean {
  return /-\d+$/.test(code);
}

/**
 * Chooses which row of a duplicate group survives, and what to preserve.
 *
 * Order of preference:
 *   1. most inbound references — minimises FK rewrites and keeps the identity
 *      the rest of the data already agrees on;
 *   2. a code WITHOUT a `-N` suffix — that is the original, and the suffixed
 *      ones are artefacts of the bug;
 *   3. earliest createdAt, as a deterministic tie-break.
 *
 * Every distinct English and Thai name in the group that is not the survivor's
 * own is returned in `aliasNames`. Thai names genuinely disagree inside groups
 * — "Data Science" is both วิทยาศาสตร์ข้อมูล and วิทยาการข้อมูล — so a merge
 * that simply dropped them would lose real vocabulary AND stop the JobThai
 * matcher recognising the discarded spelling. Preserved as aliases, the merge
 * makes the taxonomy better rather than merely smaller.
 */
export function planGroupMerge(key: string, rows: ReadonlyArray<SkillRowForMerge>): MergePlan | null {
  if (rows.length < 2) return null;
  const sorted = [...rows].sort((a, b) => {
    if (b.references !== a.references) return b.references - a.references;
    const aSuffixed = hasDisambiguatingSuffix(a.code) ? 1 : 0;
    const bSuffixed = hasDisambiguatingSuffix(b.code) ? 1 : 0;
    if (aSuffixed !== bSuffixed) return aSuffixed - bSuffixed;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
  const keep = sorted[0]!;
  const drop = sorted.slice(1);
  const keepNames = new Set([normaliseSkillName(keep.nameEn), normaliseSkillName(keep.nameTh)]);
  const aliasNames: string[] = [];
  for (const d of drop) {
    for (const n of [d.nameEn, d.nameTh]) {
      const norm = normaliseSkillName(n);
      if (norm === '' || keepNames.has(norm)) continue;
      if (!aliasNames.includes(norm)) aliasNames.push(norm);
    }
  }
  return { key, keep, drop, aliasNames };
}

export interface ChildRemap {
  /** Rows to repoint at the surviving skill. */
  update: string[];
  /** Rows to delete because the parent already references the survivor. */
  deleteConflicting: string[];
}

/**
 * Splits a child table's rows into "repoint" and "delete".
 *
 * Seven child tables carry a @@unique([parentId, skillId]) constraint, so
 * repointing a row whose parent ALREADY references the survivor violates it.
 * Those rows are duplicates of information the survivor's row already holds,
 * so they are deleted rather than merged — with one exception handled by the
 * caller: derived tables are recomputed instead, because merging two
 * independently-derived aggregates would invent a number neither source
 * supports.
 */
export function planChildRemap(input: {
  /** Rows pointing at a dropped skill: id + the parent key that forms the unique. */
  droppedRows: ReadonlyArray<{ id: string; parentKey: string }>;
  /** Parent keys that already have a row pointing at the survivor. */
  parentKeysOnSurvivor: ReadonlySet<string>;
}): ChildRemap {
  const update: string[] = [];
  const deleteConflicting: string[] = [];
  const claimed = new Set(input.parentKeysOnSurvivor);
  for (const row of input.droppedRows) {
    if (claimed.has(row.parentKey)) {
      deleteConflicting.push(row.id);
    } else {
      // Two dropped rows can share a parent key; the first wins the slot and
      // the second becomes a conflict, or the update itself would collide.
      claimed.add(row.parentKey);
      update.push(row.id);
    }
  }
  return { update, deleteConflicting };
}
