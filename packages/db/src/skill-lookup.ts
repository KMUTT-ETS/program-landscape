// Skill-name resolution shared by the KMITL connector and the career
// skill-demand spreadsheet import.
//
// Case-insensitive trimmed exact match on Skill.nameEn, then Skill.nameTh,
// then a pre-resolved alias. Unmatched names resolve to null.

export interface SkillLookup {
  byNameEn: Map<string, string>; // normalised lowercased nameEn → Skill.id
  byNameTh: Map<string, string>; // normalised nameTh → Skill.id
  // SkillAlias cache (sourceContext='linkedin', status='RESOLVED'). Hit
  // when a previous backfill / prior sync ran the AI normaliser on this
  // raw name. Means second-and-later syncs don't re-LLM the same names.
  byAlias: Map<string, string>; // raw name (lowercased) → resolved Skill.id
}

export function buildSkillLookup(
  skills: ReadonlyArray<{ id: string; nameEn: string; nameTh: string }>,
  resolvedAliases: ReadonlyArray<{ rawNameLower: string; resolvedSkillId: string }> = [],
): SkillLookup {
  const byNameEn = new Map<string, string>();
  const byNameTh = new Map<string, string>();
  const byAlias = new Map<string, string>();
  for (const s of skills) {
    const en = s.nameEn.trim().toLowerCase();
    const th = s.nameTh.trim();
    if (en && !byNameEn.has(en)) byNameEn.set(en, s.id);
    if (th && !byNameTh.has(th)) byNameTh.set(th, s.id);
  }
  for (const a of resolvedAliases) {
    if (a.rawNameLower && a.resolvedSkillId && !byAlias.has(a.rawNameLower)) {
      byAlias.set(a.rawNameLower, a.resolvedSkillId);
    }
  }
  return { byNameEn, byNameTh, byAlias };
}

export function resolveSkillId(lookup: SkillLookup, rawName: string): string | null {
  const trimmed = rawName.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  // (1) Direct nameEn exact match
  if (lookup.byNameEn.has(lower)) return lookup.byNameEn.get(lower)!;
  // (2) Direct nameTh exact match
  if (lookup.byNameTh.has(trimmed)) return lookup.byNameTh.get(trimmed)!;
  // (3) Pre-resolved alias from a prior AI normalisation. Skipping
  // AMBIGUOUS / NEW_PROPOSED / REJECTED — only RESOLVED rows make it
  // into byAlias by construction (see connector.ts fetchSkillLookup).
  if (lookup.byAlias.has(lower)) return lookup.byAlias.get(lower)!;
  return null;
}
