import { z } from 'zod';
import {
  ProgramResearchExpertiseSchema,
  ProgramCurriculumRevisionSchema,
  type ProgramCurriculumRevision,
  type CurriculumRevisionInput,
  type CurriculumRevisionCourse,
  COURSE_CODE_SOURCE,
} from '@kku/shared';
import { prisma } from './index';
import { normaliseCourseCode } from './course-code-normalise';

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
//
// ── WHAT THIS VALIDATOR DOES NOT CATCH ──────────────────────────────────────
// Read this before treating a clean drop report as proof the section is
// sound. Both limits below are known, accepted, and structural — they are
// not bugs awaiting a fix, and neither can be closed by a checker of this
// kind. A clean report means "nothing fabricated was DETECTED by these
// rules", never "the content is faithful".
//
// 1. NEGATION-STRIPPED QUOTES. `currentlyCoversQuote` is verified as a
//    substring of the real description. Substring matching cannot detect a
//    quote that inverts the source's meaning by omitting its negation: a
//    description reading 'รายวิชานี้ไม่ครอบคลุมการเรียนรู้เชิงลึก' (this course
//    does NOT cover deep learning) yields 'ครอบคลุมการเรียนรู้เชิงลึก' (covers
//    deep learning) as a genuine 26-character substring. It passes every
//    check here. `quotesBlanked = 0` therefore does NOT mean the quotes are
//    faithful to what the course actually teaches.
//
// 2. EVIDENCE RELEVANCE. Paper titles and theme names are checked for
//    EXISTENCE — was the model actually shown this? — never for RELEVANCE to
//    the recommendation they are attached to. A real paper on Thai NLP can
//    be cited as the evidence for a vector-database enhancement to a
//    data-structures course: every element resolves, while the LINKAGE
//    between them is invented. Establishing that linkage requires exactly
//    the judgement being audited, so no validator can close this.
//
//    What closes it is a human reading the rendered section — which is the
//    posture the spec takes deliberately. This output is a DRAFT for a
//    curriculum committee to argue with, never a decision. These checks
//    exist to ensure that argument starts from real courses, real people
//    and real papers; they do not certify the reasoning that connects them.
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
  /** Roster member name → that person's ACTUAL rank, as the model was shown
   *  them. The keys are the name allowlist; the values matter just as much,
   *  because promoting a real lecturer to professor in front of Council is
   *  the same kind of unsupported claim about an individual as inventing
   *  one outright. */
  validRosterRanks: Map<string, string>;
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
  /** `couldBeTaughtBy` entries naming someone outside the roster, OR giving
   *  a real person a rank they do not hold. One counter for both because the
   *  operator response is identical: an unsupported claim about a named
   *  individual was removed. Tracked separately from every other drop
   *  because it is the only one that concerns a real person. */
  rosterNamesDropped: number;
  /** enhanceCourses items that shipped NO quote at all. Not a drop — a
   *  visibility counter, because otherwise "no citation" is indistinguishable
   *  from "perfect citation" in these metrics. */
  quotesMissing: number;
  /** Course-code-shaped tokens in free text that resolve to no real course.
   *  Counted, never dropped — see the scan site for why. */
  proseCourseCodesUnverified: number;
  /** True when `validPaperTitles` was empty and the evidence-title check was
   *  therefore skipped rather than rejecting everything. Surfaced as a flag,
   *  not left to be inferred from a suspicious zero: a reader comparing drop
   *  reports needs to know this run's citations went unchecked. */
  evidenceCheckSkipped: boolean;
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

/** Course-code shape as it appears in curriculum prose: the old loose 5-6
 *  digit form (EN241100, 'EN 241100', EN 24110) OR the shared course-code
 *  pattern (adds 3-digit codes such as MEE 221). Deliberately loose: the point is to notice
 *  something that LOOKS like a code and check it, not to parse codes. */
const PROSE_COURSE_CODE_RE = new RegExp(`\\b[A-Z]{2,4}\\s?\\d{5,6}\\b|${COURSE_CODE_SOURCE}`, 'g');

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
 *   - `couldBeTaughtBy` entries survive only when the person is on the
 *     roster AND holds the rank claimed; never drops the proposal itself,
 *     since losing "who could teach it" weakens a recommendation but does
 *     not falsify it.
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
    evidenceCheckSkipped: ctx.validPaperTitles.size === 0,
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
  const validRosterRanksNormalised = new Map(
    [...ctx.validRosterRanks].map(([name, rank]) => [
      normaliseForQuoteMatch(name),
      normaliseForQuoteMatch(rank),
    ]),
  );

  const filterThemeRefs = (refs: string[]): string[] => {
    const kept = refs.filter((r) => ctx.validThemeNames.has(r));
    drops.themeRefsDropped += refs.length - kept.length;
    return kept;
  };

  const filterEvidenceTitles = (titles: string[]): string[] => {
    // An empty corpus carries NO information: it cannot distinguish an
    // invented title from "we have nothing to check against", so it must
    // never act as a universal reject. Without this guard an assembler bug
    // or an unanticipated partial-data path would silently empty the whole
    // enhance lane and read downstream as "the model produced nothing" — a
    // data problem wearing the costume of a content result, which is the
    // hardest kind to notice. Task 7's readiness short-circuit should stop
    // this reaching us at all, but a guard that only holds when an upstream
    // invariant holds is not a guard.
    if (drops.evidenceCheckSkipped) return titles;
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
    // BOTH must hold: the person is on the roster AND the rank claimed is
    // the rank they actually hold.
    const couldBeTaughtBy = item.couldBeTaughtBy.filter(
      (p) =>
        validRosterRanksNormalised.get(normaliseForQuoteMatch(p.name)) ===
        normaliseForQuoteMatch(p.rank),
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

// ─────────────────────────────────────────────────────────────────────────────
// Input assembly (Prisma-coupled). Everything above this line is pure.
// ─────────────────────────────────────────────────────────────────────────────

/** Why a program cannot be analysed, or how well it can be. */
export type CurriculumRevisionReadiness = 'ok' | 'thin' | 'no-research' | 'no-courses';

export interface AssembledCurriculumRevisionInput {
  input: CurriculumRevisionInput;
  readiness: CurriculumRevisionReadiness;
  /** Deterministic snapshot persisted alongside the payload so a reader can
   *  audit the basis without recomputing it. */
  stats: {
    courseCount: number;
    coursesWithDescription: number;
    coursesWithCategory: number;
    themeCount: number;
    totalDistinctPapers: number;
    rosterSize: number;
  };
}

/** The only two fields of the PROGRAM_DIGEST payload this assembler reads.
 *  Deliberately narrow: the digest schema is large and evolving, and a
 *  strict parse of the whole thing would make an unrelated field's drift
 *  silently cost every course its description. */
const DigestCoursesSchema = z.object({
  courses: z
    .array(
      z.object({
        code: z.string().default(''),
        descriptionTh: z.string().default(''),
        learningOutcomesTh: z.array(z.string()).default([]),
      }),
    )
    .default([]),
});

/** ProgramResearchExpertise.inputStatsJson carries the full ExpertiseStats;
 *  only the distinct-paper total is load-bearing here (it drives the thin
 *  verdict and the prompt's numeric thinness warning). */
const ExpertiseStatsSchema = z.object({ totalDistinct: z.number().int().nonnegative() });

/** Distinct papers below this floor is `thin`. The same floor
 *  program-research-expertise uses; duplicated as a literal rather than
 *  imported to keep @kku/db free of a circular dependency on the prompt
 *  module's private constant. */
const THIN_PAPER_THRESHOLD = 10;

const LEVEL_TH: Record<string, string> = {
  BACHELOR: 'ป.ตรี',
  MASTER: 'ป.โท',
  DOCTORAL: 'ป.เอก',
  HIGHER_GRAD_DIPLOMA: 'ป.บัณฑิตชั้นสูง',
};

/**
 * Assemble everything the prompt needs for one program.
 *
 * Course descriptions are recovered from the program's latest approved
 * PROGRAM_DIGEST by EXACT normalised-code match — deterministic, not fuzzy.
 * That is sound because ProgramCourse.courseCode is itself produced by
 * normalising a digest entry's code with the same helper (see
 * apps/ingestion/src/scripts/materialise-program-courses.ts), so the two
 * agree by construction. Fuzzy matching here would attach one course's
 * description to another course's recommendation, which is exactly the
 * class of ungrounded claim the validator above exists to prevent.
 *
 * Returns null ONLY when the program does not exist. A program that cannot
 * be analysed still returns a result carrying the reason (`readiness`), so
 * the runner can skip it for free and the UI can explain the skip.
 */
export async function assembleCurriculumRevisionInput(
  programId: string,
): Promise<AssembledCurriculumRevisionInput | null> {
  const program = await prisma.program.findUnique({
    where: { id: programId },
    select: {
      code: true,
      nameTh: true,
      nameEn: true,
      level: true,
      totalCredits: true,
      durationYears: true,
      faculty: { select: { nameTh: true } },
    },
  });
  if (!program) return null;

  const [programCourses, expertiseRow, digestRow, rosterRows, skillRows] = await Promise.all([
    prisma.programCourse.findMany({
      where: { programId },
      select: {
        courseCode: true,
        courseNameTh: true,
        courseNameEn: true,
        credits: true,
        category: true,
      },
      orderBy: { courseCode: 'asc' },
    }),
    prisma.programResearchExpertise.findFirst({
      where: { programId },
      orderBy: { generatedAt: 'desc' },
      select: { payloadJson: true, inputStatsJson: true },
    }),
    prisma.aiExtraction.findFirst({
      where: {
        sourceEntityType: 'program',
        sourceEntityId: programId,
        extractionKind: 'PROGRAM_DIGEST',
        reviewStatus: { in: ['APPROVED', 'AUTO_APPROVED'] },
      },
      orderBy: { createdAt: 'desc' },
      select: { payloadJson: true },
    }),
    prisma.programFaculty.findMany({
      where: { programId },
      select: {
        facultyMember: {
          select: { nameEn: true, nameTh: true, rank: true, specialization: true },
        },
      },
    }),
    prisma.programSkill.findMany({
      where: { programId },
      select: { skill: { select: { nameEn: true } } },
    }),
  ]);

  // Digest descriptions, keyed by normalised code.
  const descByCode = new Map<string, { descriptionTh: string; learningOutcomesTh: string[] }>();
  if (digestRow) {
    const parsed = DigestCoursesSchema.safeParse(digestRow.payloadJson);
    if (parsed.success) {
      for (const c of parsed.data.courses) {
        const key = normaliseCourseCode(c.code);
        if (key) {
          descByCode.set(key, {
            descriptionTh: c.descriptionTh,
            learningOutcomesTh: c.learningOutcomesTh,
          });
        }
      }
    }
  }

  const courses: CurriculumRevisionCourse[] = programCourses.map((pc) => {
    const d = descByCode.get(pc.courseCode);
    return {
      courseCode: pc.courseCode,
      nameTh: pc.courseNameTh ?? '',
      nameEn: pc.courseNameEn ?? '',
      credits: pc.credits,
      category: pc.category,
      descriptionTh: d?.descriptionTh ?? '',
      learningOutcomesTh: d?.learningOutcomesTh ?? [],
    };
  });

  // A payload that no longer parses is treated as no research at all, rather
  // than throwing: one program with a stale payload must not take down a
  // bulk run over 251 of them. It surfaces as readiness 'no-research'.
  const parsedExpertise = expertiseRow
    ? ProgramResearchExpertiseSchema.safeParse(expertiseRow.payloadJson)
    : null;
  const themes =
    parsedExpertise?.success === true
      ? parsedExpertise.data.themes.map((t) => ({
          name: t.name,
          paperCount: t.paperCount,
          exampleTitles: t.exampleTitles,
          yearSpan: t.yearSpan,
          trend: t.trend,
          evidenceNote: t.evidenceNote,
        }))
      : [];

  const totalDistinctPapers = expertiseRow
    ? (ExpertiseStatsSchema.safeParse(expertiseRow.inputStatsJson).data?.totalDistinct ?? 0)
    : 0;

  const roster = rosterRows.map((r) => ({
    name: r.facultyMember.nameEn || r.facultyMember.nameTh,
    rank: r.facultyMember.rank,
    specialization: r.facultyMember.specialization,
  }));

  // Readiness — computed BEFORE any AI call so the runner can skip for free.
  let readiness: CurriculumRevisionReadiness;
  if (!expertiseRow || themes.length === 0) readiness = 'no-research';
  else if (courses.length === 0) readiness = 'no-courses';
  else if (totalDistinctPapers < THIN_PAPER_THRESHOLD) readiness = 'thin';
  else readiness = 'ok';

  return {
    readiness,
    stats: {
      courseCount: courses.length,
      coursesWithDescription: courses.filter((c) => c.descriptionTh.length > 0).length,
      coursesWithCategory: courses.filter((c) => c.category !== null).length,
      themeCount: themes.length,
      totalDistinctPapers,
      rosterSize: roster.length,
    },
    input: {
      program: {
        code: program.code,
        nameTh: program.nameTh,
        nameEn: program.nameEn,
        levelTh: LEVEL_TH[program.level] ?? program.level,
        facultyNameTh: program.faculty.nameTh,
        totalCredits: program.totalCredits,
        durationYears: program.durationYears,
      },
      courses,
      themes,
      roster,
      currentProgramSkills: skillRows.map((s) => s.skill.nameEn).filter(Boolean),
      // The prompt only distinguishes thin vs ok; the no-* cases never reach it.
      readiness: readiness === 'thin' ? 'thin' : 'ok',
      // The actual paper count, not just the thin/ok label. The prompt renders
      // a numeric thinness warning from it — mirroring how
      // program-research-expertise names the real total and the threshold
      // rather than telling the model "evidence is thin" and hoping.
      totalDistinctPapers,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads. The deep-dive fetches BOTH of these together: the stored payload
// (may be null) and a readiness verdict explaining why it is null. Four
// states have to stay distinguishable to a reader — no research analysis /
// no course list / analysable but nothing generated yet / has a result —
// because each one asks something different of them.
// ─────────────────────────────────────────────────────────────────────────────

export interface ProgramCurriculumRevisionResult {
  payload: ProgramCurriculumRevision;
  methodVersion: string;
  generatedAt: string;
  courseCount: number;
  /** How many of those courses carry a CourseCategory. The UI needs this to
   *  tell "no course qualifies for promotion" apart from "we have no
   *  category data yet" — the promotion lane is empty either way, but only
   *  the second is a data gap the reader can act on. */
  coursesWithCategory: number;
}

/** The two fields of inputStatsJson this reader needs. Deliberately narrow
 *  and defaulted: the runner also spreads the validator's drop counts in
 *  there, and that block evolves. */
const RevisionStatsSchema = z.object({
  courseCount: z.number().int().nonnegative().default(0),
  coursesWithCategory: z.number().int().nonnegative().default(0),
});

/**
 * Latest persisted revision for a program, or null. INSERT-ONLY table, so
 * this reads the most recent row rather than a unique-per-program one.
 *
 * Throws (rather than safeParse → null) when a stored payload no longer
 * matches the schema. That is deliberate and is the opposite of the choice
 * made in assembleCurriculumRevisionInput() above, for a reason: this is a
 * SINGLE-PROGRAM read behind one deep-dive section, so a throw costs one
 * page, while the assembler runs inside a bulk loop over 251 programs where
 * one stale row must not take the run down. Degrading to null here would be
 * actively harmful — it renders a schema regression as "nothing generated
 * yet", which is one of the four states the section works hard to keep
 * distinct, and the failure would be invisible rather than loud.
 */
export async function programCurriculumRevision(
  programId: string,
): Promise<ProgramCurriculumRevisionResult | null> {
  const row = await prisma.programCurriculumRevision.findFirst({
    where: { programId },
    orderBy: { generatedAt: 'desc' },
  });
  if (!row) return null;
  const stats = RevisionStatsSchema.parse(row.inputStatsJson);
  return {
    // Parsed, not cast — running the JSON back through the same schema the
    // runner validated at write time is what makes this read honest.
    payload: ProgramCurriculumRevisionSchema.parse(row.payloadJson),
    methodVersion: row.methodVersion,
    generatedAt: row.generatedAt.toISOString(),
    courseCount: stats.courseCount,
    coursesWithCategory: stats.coursesWithCategory,
  };
}

export interface CurriculumRevisionReadinessResult {
  readiness: CurriculumRevisionReadiness;
  courseCount: number;
  /** Distinct papers behind the research analysis — lets the 'thin' empty
   *  state name the actual number, the way the research section already
   *  says "Only N papers found ... below the analysis threshold (10)". */
  distinctPaperCount: number;
}

/**
 * Cheap readiness verdict for the empty states — two counts, no AI, no
 * input assembly. Deliberately NOT assembleCurriculumRevisionInput(),
 * which loads every course, the PROGRAM_DIGEST payload, the roster and the
 * program's skills purely to build a prompt this caller will never send.
 */
export async function curriculumRevisionReadiness(
  programId: string,
): Promise<CurriculumRevisionReadinessResult | null> {
  const program = await prisma.program.findUnique({
    where: { id: programId },
    select: { id: true },
  });
  if (!program) return null;
  const [courseCount, expertise] = await Promise.all([
    prisma.programCourse.count({ where: { programId } }),
    prisma.programResearchExpertise.findFirst({
      where: { programId },
      orderBy: { generatedAt: 'desc' },
      // payloadJson rides along on a row we are already fetching — see the
      // theme check below for why it is not enough that the row exists.
      select: { inputStatsJson: true, payloadJson: true },
    }),
  ]);
  if (!expertise) return { readiness: 'no-research', courseCount, distinctPaperCount: 0 };
  // A stored payload that no longer parses is the same thing to this feature
  // as having no research at all — themes are what the whole analysis reasons
  // FROM, and the assembler above already treats an unparseable payload that
  // way. Checking only for the row's existence would let such a program read
  // as 'ok' here while generateProgramCurriculumRevision() short-circuits it
  // as 'no-research', i.e. the UI would invite a run that can never produce
  // anything. Cheap: no extra query, and themes is `.min(1)` so a successful
  // parse can never be empty.
  const themeCount =
    ProgramResearchExpertiseSchema.safeParse(expertise.payloadJson).data?.themes.length ?? 0;
  if (themeCount === 0) return { readiness: 'no-research', courseCount, distinctPaperCount: 0 };
  const distinctPaperCount =
    ExpertiseStatsSchema.safeParse(expertise.inputStatsJson).data?.totalDistinct ?? 0;
  if (courseCount === 0) return { readiness: 'no-courses', courseCount, distinctPaperCount };
  return {
    // Same floor as the assembler's THIN_PAPER_THRESHOLD, which is itself
    // program-research-expertise's.
    readiness: distinctPaperCount < THIN_PAPER_THRESHOLD ? 'thin' : 'ok',
    courseCount,
    distinctPaperCount,
  };
}
