import { prisma } from '@kku/db';

// ─────────────────────────────────────────────────────────────────────────────
// Phase 3 — deterministic skill matching.
//
// Every skill name, Thai and English, plus every accepted SkillAlias becomes
// a search term. Postings are scanned for those terms. No LLM, no cost, fully
// re-runnable.
//
// A term that appears nowhere writes nothing. An unmatched phrase is absent
// evidence, not evidence of absence, and a zero-weight row would read as the
// latter.
// ─────────────────────────────────────────────────────────────────────────────

export interface SkillTerm {
  skillId: string;
  /** Lower-cased search term. */
  term: string;
}

export interface PostingSkillMatch {
  postingId: string;
  skillId: string;
  extractedBy: 'ALIAS_MATCHED' | 'EMBEDDING_MATCHED';
}

const THAI_CHAR = /[\u0E00-\u0E7F]/;

/**
 * Minimum length for a Latin-script term. Word-boundary matching (below) does
 * the real work, so 3 safely admits SQL, PHP, CAD and Git.
 */
export const MIN_TERM_LENGTH_LATIN = 3;

/**
 * Minimum length for a Thai term, which must be matched as a bare substring
 * because Thai has no inter-word spaces and we have no tokeniser.
 *
 * MEASURED: at 3 characters the noise is severe. "สติ" (mindfulness) matched
 * 6% of postings from inside พลาสติก (plastic) and โลจิสติกส์ (logistics);
 * "กิต" (Git) matched inside บัณฑิต (graduate). 5 is the floor at which the
 * sampled top-30 contained no false positives. The cost is a handful of real
 * 4-character terms such as เคมี (chemistry), which its English name still
 * catches.
 */
export const MIN_TERM_LENGTH_THAI = 5;

export function isThaiTerm(term: string): boolean {
  return THAI_CHAR.test(term);
}

function isLatinWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[a-z0-9+#]/.test(ch);
}

/**
 * Substring search that requires word boundaries for Latin-script needles.
 *
 * MEASURED, and the reason this exists: a plain `includes` matched "micros"
 * (the MICROS POS product) inside "Microsoft" in 26% of all postings, "opera"
 * inside "operation", "stem" inside "system", "ran" inside "brand", and "git"
 * inside "digital". Boundaries eliminate every one of those without losing a
 * single genuine acronym.
 *
 * `+` and `#` count as word characters so C++ and C# do not match inside C.
 */
export function includesAsWord(hay: string, needle: string): boolean {
  let from = 0;
  for (;;) {
    const i = hay.indexOf(needle, from);
    if (i === -1) return false;
    const before = i === 0 ? undefined : hay[i - 1];
    const after = hay[i + needle.length];
    if (!isLatinWordChar(before) && !isLatinWordChar(after)) return true;
    from = i + 1;
  }
}

/** Matches skill terms against one posting's text. */
export function matchSkillTerms(text: string, terms: ReadonlyArray<SkillTerm>): string[] {
  if (text === '') return [];
  const hay = text.toLowerCase();
  const found = new Set<string>();
  for (const t of terms) {
    // Thai has no word boundaries to anchor on, so it stays a bare substring
    // test and relies on MIN_TERM_LENGTH_THAI instead.
    const hit = isThaiTerm(t.term) ? hay.includes(t.term) : includesAsWord(hay, t.term);
    if (hit) found.add(t.skillId);
  }
  return [...found];
}

export interface RollUpInput {
  occupationPostingCount: number;
  matches: ReadonlyArray<PostingSkillMatch>;
}

export interface OccupationSkillRow {
  skillId: string;
  postingCount: number;
  share: number;
  extractedBy: 'ALIAS_MATCHED' | 'EMBEDDING_MATCHED';
}

/**
 * Rolls per-posting matches into per-occupation counts. A skill matched twice
 * in one posting counts once — `share` answers "what fraction of postings in
 * this occupation ask for it", so the unit is the posting.
 */
export function rollUpOccupationSkills(input: RollUpInput): OccupationSkillRow[] {
  const bySkill = new Map<string, { postings: Set<string>; extractedBy: PostingSkillMatch['extractedBy'] }>();
  for (const m of input.matches) {
    const e = bySkill.get(m.skillId);
    if (e) {
      e.postings.add(m.postingId);
      // A deterministic hit outranks a fuzzy one for provenance purposes.
      if (m.extractedBy === 'ALIAS_MATCHED') e.extractedBy = 'ALIAS_MATCHED';
    } else {
      bySkill.set(m.skillId, { postings: new Set([m.postingId]), extractedBy: m.extractedBy });
    }
  }
  const out: OccupationSkillRow[] = [];
  for (const [skillId, v] of bySkill) {
    const postingCount = v.postings.size;
    out.push({
      skillId,
      postingCount,
      share: input.occupationPostingCount > 0 ? postingCount / input.occupationPostingCount : 0,
      extractedBy: v.extractedBy,
    });
  }
  return out.sort((a, b) => b.postingCount - a.postingCount);
}

/** Loads every skill name and accepted alias as a search term. */
export async function loadSkillTerms(): Promise<SkillTerm[]> {
  const skills = await prisma.skill.findMany({ select: { id: true, nameEn: true, nameTh: true } });
  const aliases = await prisma.skillAlias.findMany({
    // RESOLVED is the only status that asserts a confirmed mapping. PENDING,
    // NEW_PROPOSED and AMBIGUOUS are undecided, and REJECTED is an analyst
    // saying no — treating any of them as a match would put unreviewed
    // guesses into a Council-facing demand figure.
    where: { status: 'RESOLVED', resolvedSkillId: { not: null } },
    select: { rawNameLower: true, resolvedSkillId: true },
  });
  const seen = new Set<string>();
  const terms: SkillTerm[] = [];
  const push = (skillId: string, raw: string): void => {
    const term = raw.trim().toLowerCase();
    const floor = isThaiTerm(term) ? MIN_TERM_LENGTH_THAI : MIN_TERM_LENGTH_LATIN;
    if (term.length < floor) return;
    const key = `${skillId}::${term}`;
    if (seen.has(key)) return;
    seen.add(key);
    terms.push({ skillId, term });
  };
  for (const s of skills) {
    push(s.id, s.nameEn);
    push(s.id, s.nameTh);
  }
  for (const a of aliases) push(a.resolvedSkillId!, a.rawNameLower);
  return terms;
}
