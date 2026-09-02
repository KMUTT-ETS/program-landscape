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
  /** Every paper title the model was actually shown, across all themes.
   *  An evidence title outside this set was invented. */
  validPaperTitles: Set<string>;
  /** Roster member names the model was shown. A proposal naming someone
   *  outside this set is asserting something about a real person that we
   *  cannot support. */
  validRosterNames: Set<string>;
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
  /** Evidence paper titles removed because the model was never shown them.
   *  This is the field the prompt leans on hardest for grounding, so an
   *  elevated count here means the citations are decorative. */
  evidenceTitlesDropped: number;
  /** `couldBeTaughtBy` entries naming someone outside the roster. Tracked
   *  separately from every other drop because it is the only one that
   *  concerns a real, named individual. */
  rosterNamesDropped: number;
  /** enhanceCourses items that shipped NO quote at all. Not a drop — a
   *  visibility counter, because otherwise "no citation" is indistinguishable
   *  from "perfect citation" in these metrics. */
  quotesMissing: number;
  /** Course-code-shaped tokens in free text that resolve to no real course.
   *  Counted, never dropped — see the scan site for why. */
  proseCourseCodesUnverified: number;
}

/** Collapse all whitespace so a verbatim quote still matches when the model
 *  normalised spacing that the PDF text happened to double up. Also used for
 *  paper titles and roster names, which reach the model through the same
 *  reflowing path and deserve the same tolerance. */
function normaliseForQuoteMatch(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** A quote shorter than this is not a citation. 'array' is a substring of
 *  almost any description and tells the reader nothing about what the course
 *  currently covers — accepting it would let a model satisfy the citation
 *  requirement with a word it could have guessed. */
const MIN_QUOTE_CHARS = 12;

/** Course-code shape as it appears in KKU curriculum prose, e.g. EN241100 or
 *  the occasional 'EN 241100'. Deliberately loose: the point is to notice
 *  something that LOOKS like a code and check it, not to parse codes. */
const PROSE_COURSE_CODE_RE = /\b[A-Z]{2,4}\s?\d{5,6}\b/g;

/**
 * Strip every unfounded claim from a model payload.
 *
 * Rules:
 *   - An item naming a courseCode outside `validCourseCodes` is DROPPED.
 *   - themeRefs are filtered to `validThemeNames`; an item left with none
 *     is DROPPED (its evidence chain is gone).
 *   - evidencePaperTitles are filtered to `validPaperTitles`. An
 *     enhanceCourses item left with none is DROPPED — the schema requires
 *     min 1 there precisely because an enhancement with no paper behind it
 *     is an opinion. newCourseProposals are filtered but never dropped for
 *     this: that lane's grounding is themeRefs.
 *   - `couldBeTaughtBy` is filtered to `validRosterNames`, never dropping
 *     the proposal — losing "who could teach it" weakens a recommendation
 *     but does not falsify it.
 *   - `currentlyCoversQuote` that is not a substring of the course's real
 *     description, or is too short to be a citation, is BLANKED, not
 *     dropped — a paraphrased citation is a defect in the quote, not proof
 *     the advice is wrong.
 *   - `coverageSummary.themesAbsent` is filtered to real theme names.
 *   - Course-code-shaped tokens in free text are COUNTED, not dropped.
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
    evidenceTitlesDropped: 0,
    rosterNamesDropped: 0,
    quotesMissing: 0,
    proseCourseCodesUnverified: 0,
  };

  // NOTE ON MATCHING: course codes and theme names are matched EXACTLY.
  // That fails safe — a mismatch drops a recommendation, it never admits a
  // fabricated one — but it means a pure casing difference ('Vector
  // Databases' for 'Vector databases', 'en241100' for 'EN241100') registers
  // as a drop. Since these counts are read as a prompt-quality signal, CHECK
  // CASING BEFORE CONCLUDING THE MODEL IS INVENTING THINGS: a sudden spike
  // is more often an upstream extractor changing how it cases its output.
  // Paper titles and roster names are whitespace-normalised (they reach the
  // model through a reflowing path) but likewise case-sensitive.
  const validPaperTitlesNormalised = new Set(
    [...ctx.validPaperTitles].map(normaliseForQuoteMatch),
  );
  const validRosterNamesNormalised = new Set(
    [...ctx.validRosterNames].map(normaliseForQuoteMatch),
  );

  const filterThemeRefs = (refs: string[]): string[] => {
    const kept = refs.filter((r) => ctx.validThemeNames.has(r));
    drops.themeRefsDropped += refs.length - kept.length;
    return kept;
  };

  const filterEvidenceTitles = (titles: string[]): string[] => {
    const kept = titles.filter((t) => validPaperTitlesNormalised.has(normaliseForQuoteMatch(t)));
    drops.evidenceTitlesDropped += titles.length - kept.length;
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
    const evidencePaperTitles = filterEvidenceTitles(item.evidencePaperTitles);
    if (evidencePaperTitles.length === 0) {
      drops.enhanceCoursesDropped++;
      continue;
    }
    let quote = item.currentlyCoversQuote;
    const normalisedQuote = normaliseForQuoteMatch(quote);
    if (normalisedQuote.length === 0) {
      drops.quotesMissing++;
    } else {
      const source = normaliseForQuoteMatch(ctx.descriptionByCourseCode.get(item.courseCode) ?? '');
      if (normalisedQuote.length < MIN_QUOTE_CHARS || !source.includes(normalisedQuote)) {
        quote = '';
        drops.quotesBlanked++;
      }
    }
    enhanceCourses.push({ ...item, themeRefs, evidencePaperTitles, currentlyCoversQuote: quote });
  }

  const newCourseProposals: ProgramCurriculumRevision['newCourseProposals'] = [];
  for (const item of raw.newCourseProposals) {
    const themeRefs = filterThemeRefs(item.themeRefs);
    if (themeRefs.length === 0) {
      drops.newCourseProposalsDropped++;
      continue;
    }
    // Filtered, but never a reason to drop: this lane is grounded by
    // themeRefs, and losing the name of someone who could teach the course
    // weakens the recommendation without falsifying it.
    const evidencePaperTitles = filterEvidenceTitles(item.evidencePaperTitles);
    const couldBeTaughtBy = item.couldBeTaughtBy.filter((p) =>
      validRosterNamesNormalised.has(normaliseForQuoteMatch(p.name)),
    );
    drops.rosterNamesDropped += item.couldBeTaughtBy.length - couldBeTaughtBy.length;
    newCourseProposals.push({ ...item, themeRefs, evidencePaperTitles, couldBeTaughtBy });
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

  // Free text renders to the reader too, so an invented code in prose
  // ("EN999999 already covers the basics") undercuts the same promise the
  // structured checks above protect: that every course named resolves.
  //
  // DELIBERATE AND PROVISIONAL LENIENCY: we COUNT these and drop nothing.
  // Discarding an otherwise-sound recommendation over one prose slip is too
  // blunt a response to a rate nobody has measured yet. The bulk run will
  // tell us the real number — if it is near zero this stays as-is, and if it
  // is material we tighten it with evidence rather than on speculation.
  //
  // Only surviving items are scanned, because only they reach a reader.
  const renderedProse = [
    raw.coverageSummary.narrative,
    ...enhanceCourses.flatMap((e) => [e.addition, e.additionDetail]),
    ...newCourseProposals.map((n) => n.rationale),
    ...promotionCandidates.map((p) => p.rationale),
  ];
  for (const text of renderedProse) {
    for (const match of text.matchAll(PROSE_COURSE_CODE_RE)) {
      // 'EN 241100' and 'EN241100' are the same course to a reader.
      if (!ctx.validCourseCodes.has(match[0].replace(/\s+/g, ''))) {
        drops.proseCourseCodesUnverified++;
      }
    }
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
