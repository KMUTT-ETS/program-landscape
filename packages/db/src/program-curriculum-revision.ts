import type { ProgramCurriculumRevision } from '@kku/shared';

// ─────────────────────────────────────────────────────────────────────────────
// Input assembly + payload validation for program-curriculum-revision.v1.
//
// The validator below is the load-bearing safety mechanism of this feature.
// The prompt ASKS the model to cite only real courses and themes; this
// ENFORCES it. The entire value of the section is that a department head
// can look up the course a recommendation names — one citing a course that
// does not exist is worse than no recommendation, because it costs the
// reader trust in everything beside it.
//
// Pure — no Prisma, no I/O — so the rules are unit-tested directly.
// assembleCurriculumRevisionInput() (Prisma) lives further down the file.
// ─────────────────────────────────────────────────────────────────────────────

export interface CurriculumRevisionValidationContext {
  /** Course codes that genuinely exist for THIS program. */
  validCourseCodes: Set<string>;
  /** courseCode → its CourseCategory (or null when the extractor could not
   *  place it). Promotion advice is only defensible for a course actually
   *  recorded as MAJOR_ELECTIVE — the prompt states that rule but nothing
   *  enforced it, so a promotion citing an already-required course would
   *  have rendered to Council. */
  categoryByCourseCode: Map<string, string | null>;
  /** Theme names from the program's own research-expertise payload. */
  validThemeNames: Set<string>;
  /** courseCode → that course's real Thai description, for quote checking. */
  descriptionByCourseCode: Map<string, string>;
}

export interface CurriculumRevisionDrops {
  enhanceCoursesDropped: number;
  newCourseProposalsDropped: number;
  promotionCandidatesDropped: number;
  themeRefsDropped: number;
  quotesBlanked: number;
  /** Subset of promotionCandidatesDropped: dropped specifically because the
   *  course is not recorded as MAJOR_ELECTIVE. Counted separately because a
   *  high rate means the model is ignoring the category rule, which is a
   *  different problem from it inventing course codes. */
  promotionsNotElective: number;
}

/** Collapse all whitespace so a verbatim quote still matches when the model
 *  normalised spacing that the PDF text happened to double up. */
function normaliseForQuoteMatch(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Strip every unfounded claim from a model payload.
 *
 * Rules:
 *   - An item naming a courseCode outside `validCourseCodes` is DROPPED.
 *   - themeRefs are filtered to `validThemeNames`; an item left with none
 *     is DROPPED (its evidence chain is gone).
 *   - `currentlyCoversQuote` that is not a substring of the course's real
 *     description is BLANKED, not dropped — a paraphrased citation is a
 *     defect in the quote, not proof the advice is wrong.
 *   - `coverageSummary.themesAbsent` is filtered to real theme names.
 *
 * Returns the cleaned payload plus counts. A nonzero drop rate is a
 * prompt-quality signal worth watching — the runner persists it.
 */
export function validateCurriculumRevisionPayload(
  raw: ProgramCurriculumRevision,
  ctx: CurriculumRevisionValidationContext,
): { payload: ProgramCurriculumRevision; drops: CurriculumRevisionDrops } {
  const drops: CurriculumRevisionDrops = {
    enhanceCoursesDropped: 0,
    newCourseProposalsDropped: 0,
    promotionCandidatesDropped: 0,
    themeRefsDropped: 0,
    quotesBlanked: 0,
    promotionsNotElective: 0,
  };

  const filterThemeRefs = (refs: string[]): string[] => {
    const kept = refs.filter((r) => ctx.validThemeNames.has(r));
    drops.themeRefsDropped += refs.length - kept.length;
    return kept;
  };

  const enhanceCourses: ProgramCurriculumRevision['enhanceCourses'] = [];
  for (const item of raw.enhanceCourses) {
    if (!ctx.validCourseCodes.has(item.courseCode)) {
      drops.enhanceCoursesDropped++;
      continue;
    }
    const themeRefs = filterThemeRefs(item.themeRefs);
    if (themeRefs.length === 0) {
      drops.enhanceCoursesDropped++;
      continue;
    }
    let quote = item.currentlyCoversQuote;
    if (quote) {
      const source = normaliseForQuoteMatch(ctx.descriptionByCourseCode.get(item.courseCode) ?? '');
      if (!source.includes(normaliseForQuoteMatch(quote))) {
        quote = '';
        drops.quotesBlanked++;
      }
    }
    enhanceCourses.push({ ...item, themeRefs, currentlyCoversQuote: quote });
  }

  const newCourseProposals: ProgramCurriculumRevision['newCourseProposals'] = [];
  for (const item of raw.newCourseProposals) {
    const themeRefs = filterThemeRefs(item.themeRefs);
    if (themeRefs.length === 0) {
      drops.newCourseProposalsDropped++;
      continue;
    }
    newCourseProposals.push({ ...item, themeRefs });
  }

  const promotionCandidates: ProgramCurriculumRevision['promotionCandidates'] = [];
  for (const item of raw.promotionCandidates) {
    if (!ctx.validCourseCodes.has(item.courseCode)) {
      drops.promotionCandidatesDropped++;
      continue;
    }
    // Promotion means elective → required. A course that is already
    // required, or whose category the extractor could not determine, has
    // no promotion to make. The prompt states this rule; this is what
    // enforces it.
    if (ctx.categoryByCourseCode.get(item.courseCode) !== 'MAJOR_ELECTIVE') {
      drops.promotionCandidatesDropped++;
      drops.promotionsNotElective++;
      continue;
    }
    const themeRefs = filterThemeRefs(item.themeRefs);
    if (themeRefs.length === 0) {
      drops.promotionCandidatesDropped++;
      continue;
    }
    promotionCandidates.push({ ...item, themeRefs });
  }

  return {
    payload: {
      ...raw,
      coverageSummary: {
        ...raw.coverageSummary,
        themesAbsent: raw.coverageSummary.themesAbsent.filter((t) => ctx.validThemeNames.has(t)),
      },
      enhanceCourses,
      newCourseProposals,
      promotionCandidates,
    },
    drops,
  };
}
