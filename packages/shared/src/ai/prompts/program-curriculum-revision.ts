import { z } from 'zod';
import type { AiMessage } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// program-curriculum-revision.v1
//
// Turns a program's demonstrated research strength into COURSE-LEVEL
// curriculum advice: which named course to extend and with what, which
// course to create where a strength has no home, and which elective
// deserves promotion to required.
//
// Supersedes nothing — it sits alongside program-research-expertise's
// programme-level `recommendations.curriculum` lane, which stays as the
// summary it already is. The gap this closes: that lane names no course
// code and cites no course content, so a department head cannot act on it.
//
// Pre-computed and persisted (ProgramCurriculumRevision), same posture as
// program-research-expertise — the Deep-Dive reads a row, it never
// generates on page load.
//
// Conformant from birth (docs/prompt-standard.md) — the conformance ratchet
// (packages/shared/test/prompt-standard-conformance.test.ts) admits no new
// allowlist entries, so this file carries every required marker from its
// first commit.
//
// GROUNDING RULES WITH TEETH — to be enforced in CODE, not merely
// requested. validateCurriculumRevisionPayload() (packages/db/src/
// program-curriculum-revision.ts — FORTHCOMING, not yet written) will DROP
// any item naming a courseCode absent from the program's real course list,
// and any theme name absent from the input themes. Until it lands, the
// constraints below are prompt-level only. The whole value of this section
// is that a reader can look up the course it names; one that cites a
// non-existent course is worse than no recommendation at all.
//
// The system prompt spells out the OUTPUT JSON shape field-by-field, as
// program-research-expertise does. This is not decoration: GoogleAiService
// .extractStructured sends `responseMimeType: 'application/json'` but NO
// responseSchema, so the field names the Zod schema requires (effort,
// placementSemester, couldBeTaughtBy, …) reach the model through the prompt
// text or not at all. Keep the block in sync with the schema below — a
// drift here surfaces as a parse failure, not a warning.
//
// Design spec: docs/superpowers/specs/2026-09-01-curriculum-revision-recommendation-design.md
// ─────────────────────────────────────────────────────────────────────────────

export const PROGRAM_CURRICULUM_REVISION_VERSION = 'program-curriculum-revision.v1';

/** Verbatim caveat every payload's `caveats` array must carry, enforced by
 *  the schema's `.refine()` below — the same device
 *  program-research-expertise uses for ROSTER_PROVENANCE_CAVEAT.
 *
 *  WHY it is mandatory here: EVERY input this prompt reasons over is itself
 *  AI-derived. The course list and categories come from
 *  program-courses-extract, the descriptions from PROGRAM_DIGEST, the
 *  themes from program-research-expertise. That is two extraction layers
 *  underneath a section that proposes new courses to a University Council;
 *  a reader who is not told cannot weigh the advice correctly. */
export const CURRICULUM_REVISION_PROVENANCE_CAVEAT =
  'Course list, categories and descriptions are AI-extracted from the curriculum document; research themes are an AI analysis of publication titles; errors in either extraction layer propagate to these recommendations.';

/** Per-lane ceilings. Exceeding one fails the parse rather than being
 *  silently truncated — an over-produced list is evidence the model padded,
 *  and padding is precisely the failure mode this prompt guards against.
 *  The same numbers are stated in HARD CONSTRAINT 7 so the model is told
 *  the bound it is being held to. */
const MAX_ENHANCE_COURSES = 6;
const MAX_NEW_COURSE_PROPOSALS = 4;
const MAX_PROMOTION_CANDIDATES = 3;

/** Total recommendations allowed across ALL three lanes when the research
 *  evidence is `thin`. Prompt-level only: the schema is static and cannot
 *  see `readiness`, so this bound is stated in the THINNESS WARNING and
 *  (forthcoming) re-checked by the runner. */
const THIN_TOTAL_RECOMMENDATION_CEILING = 2;

/** Distinct papers below this floor is the `thin` readiness threshold —
 *  duplicated here (not imported from @kku/db) only as a literal used in
 *  the thinness-warning copy, exactly as program-research-expertise does
 *  it. The readiness VERDICT is computed upstream and handed in via
 *  `input.readiness`, never re-derived here. */
const THIN_PAPER_THRESHOLD = 10;

// ── HARD CONSTRAINT 5: the course-closure ban ────────────────────────────────
// One source, two consumers. The constraint's PROSE below is built from
// CLOSURE_CONCEPT_GERUNDS, and the runner's enforcement gate
// (packages/db/src/program-curriculum-revision-run.ts) is built from
// CLOSURE_POLICY. Both live here so that changing what this section forbids
// is ONE edit rather than two that silently drift apart — the earlier
// hand-maintained gate covered 8 of the 11 concepts the prose bans, so
// "remove the unit", "downgrade it to elective" and "reduce the credits"
// passed a check whose whole purpose was to stop them.
//
// WHY A GATE AT ALL, when the prompt already says it: recommending that a
// course be retired or merged affects staff livelihoods, and research volume
// is the wrong basis for that judgement. A prompt-level ban is a request; the
// runner forces a rewrite.

/** The forbidden concepts, as the gerunds HARD CONSTRAINT 5 reads with. */
const CLOSURE_CONCEPT_GERUNDS = [
  'removing',
  'retiring',
  'closing',
  'discontinuing',
  'suspending',
  'consolidating',
  'merging',
  'phasing out',
  'sunsetting',
  'downgrading',
  'reducing the credits of',
] as const;

function joinWithOr(items: readonly string[]): string {
  if (items.length < 2) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')}, or ${items[items.length - 1]}`;
}

/**
 * The same ban, in the form a linter can apply.
 *
 * TWO TIERS, because a flat word list over-fires on ordinary curriculum
 * prose and a false positive is not free: it burns an AI call on a rewrite
 * and raises `lintRetried`, which an operator reads as "the model tried to
 * recommend closure" — a misleading flag on a safety signal. Measured
 * against real phrasing, a bare list wrongly fires on "closing the gap
 * between research and the taught curriculum" (the schema's own field doc
 * describes themeRefs as "the gap being closed"), "a close alignment
 * between theme 2 and EN241100", "students consolidate prior learning in
 * the capstone", "consolidation of statistics content across the two
 * courses", "a module on suspended solids", and "merging the two topics
 * into a single 3-credit module".
 *
 * So: `unambiguous` terms have no innocent reading in curriculum prose and
 * match bare. `ambiguous` terms match only when bound to something that can
 * actually be closed — forward within `forwardWindow` tokens ("merge the
 * course"), or in the passive with only `passiveGlue` between ("the course
 * should be merged"). The passive direction is deliberately far tighter
 * than the forward one: a generous reverse window cannot tell "the course
 * be merged" from "a module on suspended solids", which have identical
 * shape.
 *
 * RESIDUAL FALSE POSITIVE, accepted: `retirement` fires on a caveat about a
 * roster member approaching retirement. Retiring a PERSON is not this
 * section's business either way, so the cost is one wasted rewrite on prose
 * that was off-topic regardless.
 */
export const CLOSURE_POLICY = {
  /** No innocent reading in curriculum prose — matched bare. A space in a
   *  phrase matches a hyphen too, so 'phase out' catches 'phase-out'. */
  unambiguous: [
    'retire',
    'retires',
    'retired',
    'retiring',
    'retirement',
    'discontinue',
    'discontinues',
    'discontinued',
    'discontinuing',
    'discontinuation',
    'sunset',
    'sunsets',
    'sunsetted',
    'sunsetting',
    'terminate',
    'terminates',
    'terminated',
    'terminating',
    'termination',
    'downgrade',
    'downgrades',
    'downgraded',
    'downgrading',
    'phase out',
    'phases out',
    'phased out',
    'phasing out',
    'teach out',
    'teaching out',
  ],
  /** Innocent in ordinary curriculum prose — matched only when bound to an
   *  object noun below. */
  ambiguous: [
    'close',
    'closes',
    'closed',
    'closing',
    'closure',
    'consolidate',
    'consolidates',
    'consolidated',
    'consolidating',
    'consolidation',
    'merge',
    'merges',
    'merged',
    'merging',
    'merger',
    'suspend',
    'suspends',
    'suspended',
    'suspending',
    'suspension',
    'remove',
    'removes',
    'removed',
    'removing',
    'removal',
    'reduce',
    'reduces',
    'reduced',
    'reducing',
    'reduction',
    'eliminate',
    'eliminates',
    'eliminated',
    'eliminating',
    'elimination',
  ],
  /** Things that can be closed. `credit(s)` is here so "reduce the credits
   *  of EN241100" is caught — the concept the prose bans as "reducing the
   *  credits of". */
  objectNouns: [
    'course',
    'courses',
    'programme',
    'programmes',
    'program',
    'programs',
    'curriculum',
    'curricula',
    'elective',
    'electives',
    'module',
    'modules',
    'degree',
    'degrees',
    'credit',
    'credits',
    'unit',
    'units',
  ],
  /** Tokens allowed between the object noun and a passive-voice term. */
  passiveGlue: [
    'be',
    'is',
    'are',
    'was',
    'were',
    'been',
    'being',
    'should',
    'could',
    'would',
    'will',
    'may',
    'might',
    'can',
    'to',
    'get',
    'gets',
  ],
  /** Tokens an object noun may sit past, scanning FORWARD from the term. */
  forwardWindow: 4,
  /** Glue tokens allowed between an object noun and a following term. */
  passiveWindow: 2,
} as const;

const EffortEnum = z.enum(['MINOR', 'MODERATE', 'MAJOR']);

export const ProgramCurriculumRevisionSchema = z.object({
  coverageSummary: z.object({
    themesTotal: z.number().int().nonnegative(),
    themesReflectedInCurriculum: z.number().int().nonnegative(),
    /** Theme names with no course home at all. */
    themesAbsent: z.array(z.string()).default([]),
    narrative: z.string(),
  }),
  enhanceCourses: z
    .array(
      z.object({
        /** MUST be a courseCode from the input list — enforced downstream. */
        courseCode: z.string(),
        courseNameTh: z.string().default(''),
        /** Verbatim from that course's own descriptionTh. */
        currentlyCoversQuote: z.string().default(''),
        /** The theme this course does NOT yet reflect — the gap being
         *  closed, not a theme the course already covers. */
        themeRefs: z.array(z.string()).default([]),
        addition: z.string(),
        additionDetail: z.string().default(''),
        effort: EffortEnum,
        /** Required, min 1: this is the grounding for the recommendation.
         *  An enhancement with no paper behind it is an opinion. */
        evidencePaperTitles: z.array(z.string()).min(1),
      }),
    )
    .max(MAX_ENHANCE_COURSES)
    .default([]),
  newCourseProposals: z
    .array(
      z.object({
        titleTh: z.string(),
        titleEn: z.string().default(''),
        /** min 1 — a zero-credit proposed course is not a course. */
        credits: z.number().int().min(1).max(30),
        placementYear: z.number().int().min(1).max(8),
        placementSemester: z.number().int().min(1).max(3),
        themeRefs: z.array(z.string()).default([]),
        rationale: z.string(),
        couldBeTaughtBy: z
          .array(z.object({ name: z.string(), rank: z.string().default('') }))
          .default([]),
        evidencePaperTitles: z.array(z.string()).default([]),
      }),
    )
    .max(MAX_NEW_COURSE_PROPOSALS)
    .default([]),
  promotionCandidates: z
    .array(
      z.object({
        courseCode: z.string(),
        courseNameTh: z.string().default(''),
        currentCategory: z.string().default(''),
        proposedCategory: z.string().default(''),
        themeRefs: z.array(z.string()).default([]),
        rationale: z.string(),
      }),
    )
    .max(MAX_PROMOTION_CANDIDATES)
    .default([]),
  confidence: z.number().min(0).max(1),
  /** No `.default([])`: caveats can never come back empty, because the
   *  provenance caveat is always true of this analysis. */
  caveats: z
    .array(z.string())
    .min(1)
    .refine((arr) => arr.includes(CURRICULUM_REVISION_PROVENANCE_CAVEAT), {
      message: `caveats must include the provenance caveat verbatim: "${CURRICULUM_REVISION_PROVENANCE_CAVEAT}"`,
    }),
});
export type ProgramCurriculumRevision = z.infer<typeof ProgramCurriculumRevisionSchema>;

export interface CurriculumRevisionCourse {
  courseCode: string;
  nameTh: string;
  nameEn: string;
  credits: number | null;
  category: string | null;
  descriptionTh: string;
  learningOutcomesTh: string[];
}

export interface CurriculumRevisionTheme {
  name: string;
  paperCount: number;
  exampleTitles: string[];
  yearSpan: string;
  trend: string;
  evidenceNote: string;
}

export interface CurriculumRevisionInput {
  program: {
    code: string;
    nameTh: string;
    nameEn: string;
    levelTh: string;
    facultyNameTh: string;
    totalCredits: number | null;
    durationYears: number | null;
  };
  courses: CurriculumRevisionCourse[];
  themes: CurriculumRevisionTheme[];
  roster: Array<{ name: string; rank: string; specialization: string | null }>;
  currentProgramSkills: string[];
  readiness: 'ok' | 'thin';
  /** Distinct papers the themes were derived from. Rendered as a NUMBER in
   *  the thinness warning — "few papers" is a sentiment the model can argue
   *  itself out of; "4 papers, below the 10-paper threshold" is not. */
  totalDistinctPapers: number;
}

export function buildProgramCurriculumRevisionMessages(
  input: CurriculumRevisionInput,
): AiMessage[] {
  const system = `You advise a Thai university department on how to revise one academic program's curriculum so it reflects the research its own faculty actually publish. Your output is a DRAFT for a curriculum committee to edit — never a decision, and never an accreditation submission.

HARD CONSTRAINTS:
1. **The course list is CLOSED.** Every courseCode you cite in enhanceCourses or promotionCandidates MUST appear verbatim in the COURSES block below. Do not invent, guess, or extrapolate a course code. A recommendation naming a course that does not exist is discarded before anyone reads it.
2. **Themes are closed too.** Every theme name you emit ANYWHERE — themeRefs in any of the three lanes, and coverageSummary.themesAbsent — must match a name from the RESEARCH THEMES block exactly. A theme name that is not on that list is discarded.
3. **currentlyCoversQuote must be VERBATIM** from that course's own description in the COURSES block — copy the text, do not paraphrase or summarise. It is what lets a reader confirm you understood the course. Quote the RELEVANT SPAN, not the whole description: up to about 200 characters, cut at a natural boundary. When a course shows "(none on file)" it has no description: return an empty string for that field rather than quoting the placeholder.
   **PREFER courses that HAVE a description when choosing what to enhance.** Only a minority of courses carry one, and a recommendation that can quote what a course teaches today is far stronger than one that cannot — the reader can check your reasoning against the course's own words. Pick a description-less course only when no described course fits the research theme; if you do, say so in that item's additionDetail.
4. **You were shown paper TITLES only** — no abstracts, no findings. Never claim what a paper concluded or how it was conducted. That a paper belongs to a subject area is title-supportable; what it found is not.
5. **Never propose ending or shrinking anything.** Do not recommend, suggest, hint at, or speculate about ${joinWithOr(CLOSURE_CONCEPT_GERUNDS)} any course or program. This applies IN ANY FIELD — narrative, rationale, additionDetail, addition, and caveats included, not only in the recommendation lanes. That judgement affects staff livelihoods, is modelled elsewhere by people accountable for it, and cannot rest on research volume. Your lane is additions, extensions and promotions only.
6. **Promotion advice requires category evidence.** Only propose promoting a course whose category is given as MAJOR_ELECTIVE. When a course's category is unknown, it is not eligible — say nothing about its status.
7. **Evidence-proportional output, with hard ceilings.** At most ${MAX_ENHANCE_COURSES} enhanceCourses, ${MAX_NEW_COURSE_PROPOSALS} newCourseProposals and ${MAX_PROMOTION_CANDIDATES} promotionCandidates — exceeding any ceiling invalidates the entire response. When the research evidence is marked THIN below, return at most ${THIN_TOTAL_RECOMMENDATION_CEILING} recommendations IN TOTAL across all three lanes, hedge them, and say why in caveats. Padding a thin portfolio into a confident revision plan is the failure mode this section exists to avoid. One well-grounded recommendation is a better answer than five speculative ones.

WHAT TO PRODUCE:
- coverageSummary — how many research themes are already reflected in the curriculum, which are absent entirely, and a 2-4 sentence read.
- enhanceCourses — for a specific existing course, what it covers today (verbatim quote), which research theme it does not yet reflect, and a CONCRETE addition: a topic, a module, or a revised learning outcome. Not "modernise the course".
- newCourseProposals — only where a research strength has no home in ANY existing course. Give a Thai and English title, credits, the study year and semester it belongs in, and which roster member could teach it.
- promotionCandidates — a MAJOR_ELECTIVE course strongly backed by the program's own research that merits becoming MAJOR_REQUIRED.

MANDATORY CAVEAT — the caveats array MUST contain this sentence verbatim, character for character, alongside any other limitation you judge material:
"${CURRICULUM_REVISION_PROVENANCE_CAVEAT}"

Write every analytical field in English. Thai appears only in data-label fields (courseNameTh, titleTh) and in currentlyCoversQuote, which is a verbatim quotation of Thai source text — a structural extraction requirement, not a language choice.

CONFIDENCE RUBRIC (report one number):
  0.90-1.00  every key input channel present and mutually consistent
  0.70-0.89  one material channel missing, or a noted inconsistency
  0.50-0.69  verdict rests on a single channel, or inputs conflict materially
  below 0.50 best effort over sparse input — flag for human review
Grade against the bands. Do not default to 0.95.

BANNED PHRASES (do not use these words/phrases or their close paraphrases anywhere in your output):
- "delve"
- "leverage" (as a verb)
- "robust"
- "landscape" (in its metaphorical sense — not literal geography)
- "tapestry"
- "furthermore"
- "moreover"
- "it is important to note"
- "in today's rapidly evolving"

OUTPUT JSON:
{
  "coverageSummary": {
    "themesTotal": <int>,
    "themesReflectedInCurriculum": <int>,
    "themesAbsent": ["<theme name with no course home at all>"],
    "narrative": "<2-4 sentences>"
  },
  "enhanceCourses": [
    {
      "courseCode": "<a code from the COURSES block, verbatim>",
      "courseNameTh": "<that course's Thai name, verbatim>",
      "currentlyCoversQuote": "<verbatim from that course's description, or \\"\\" when none on file>",
      "themeRefs": ["<the theme this course does NOT yet reflect — the gap>"],
      "addition": "<the concrete addition, one line>",
      "additionDetail": "<what it looks like in practice — module length, topic list, or revised outcome>",
      "effort": "MINOR" | "MODERATE" | "MAJOR",
      "evidencePaperTitles": ["<verbatim example title behind this — at least one, required>"]
    }
  ],
  "newCourseProposals": [
    {
      "titleTh": "<Thai course title>",
      "titleEn": "<English course title>",
      "credits": <int 1-30>,
      "placementYear": <int 1-8>,
      "placementSemester": <int 1-3>,
      "themeRefs": ["<the theme this new course would serve>"],
      "rationale": "<why no existing course can host this strength>",
      "couldBeTaughtBy": [ { "name": "<roster member>", "rank": "<their rank>" } ],
      "evidencePaperTitles": ["<verbatim example title>"]
    }
  ],
  "promotionCandidates": [
    {
      "courseCode": "<a MAJOR_ELECTIVE code from the COURSES block>",
      "courseNameTh": "<that course's Thai name>",
      "currentCategory": "MAJOR_ELECTIVE",
      "proposedCategory": "MAJOR_REQUIRED",
      "themeRefs": ["<the theme backing this promotion>"],
      "rationale": "<why the program's own research makes this core>"
    }
  ],
  "confidence": 0.0-1.0,
  "caveats": ["<the mandatory provenance sentence above, verbatim>", "<any other material limitation of this draft>"]
}

Every recommendation array may be empty — an empty array is the correct answer when the evidence supports nothing in that lane. caveats is the exception: it is never empty. Output STRICT JSON matching the schema described. No prose before or after, no markdown fences.`;

  const coursesBlock = input.courses
    .map((c) => {
      // 'UNKNOWN' is what program-courses-extract.v4 writes when it cannot
      // read a course's หมวด heading — the COMMON case, not the rare one.
      // It must read identically to a missing category, or the model gets
      // a category-shaped string it can mistake for promotion evidence.
      const known = c.category && c.category !== 'UNKNOWN' ? c.category : null;
      const cat = known ?? 'category unknown — not eligible for promotion advice';
      const outcomes = c.learningOutcomesTh.length
        ? `\n    outcomes: ${c.learningOutcomesTh.join(' / ')}`
        : '';
      return `  [${c.courseCode}] ${c.nameTh}${c.nameEn ? ` / ${c.nameEn}` : ''} (${c.credits ?? '?'} credits, ${cat})
    description: ${c.descriptionTh || '(none on file)'}${outcomes}`;
    })
    .join('\n');

  const themesBlock = input.themes
    .map(
      (t) =>
        `  - ${t.name} — ${t.paperCount} paper(s), ${t.yearSpan}, trend ${t.trend}
    examples: ${t.exampleTitles.map((x) => `"${x}"`).join('; ')}
    note: ${t.evidenceNote}`,
    )
    .join('\n');

  const rosterBlock = input.roster
    .map((r) => `  - ${r.name} (${r.rank})${r.specialization ? ` — ${r.specialization}` : ''}`)
    .join('\n');

  // A NUMBER, not an adjective. "few papers" is a sentiment the model can
  // reason its way past; "4 distinct papers, below the 10-paper threshold,
  // at most 2 recommendations" is a bound. Mirrors the THINNESS WARNING in
  // program-research-expertise.
  const evidenceBlock =
    input.readiness === 'thin'
      ? `RESEARCH EVIDENCE: THIN — the themes below rest on only ${input.totalDistinctPapers} distinct paper(s), below the ${THIN_PAPER_THRESHOLD}-paper analysis threshold. Return AT MOST ${THIN_TOTAL_RECOMMENDATION_CEILING} recommendations IN TOTAL across enhanceCourses, newCourseProposals and promotionCandidates combined, and only where the visible evidence genuinely supports them. Returning one — or none — is the correct and honest output at this volume. Do not pad the count or inflate confidence to compensate for sparse evidence; state the thinness in caveats.`
      : `RESEARCH EVIDENCE: ${input.totalDistinctPapers} distinct paper(s) behind the themes below.`;

  const user = `[PROGRAM] ${input.program.code} — ${input.program.nameTh}${input.program.nameEn ? ` / ${input.program.nameEn}` : ''}
Faculty: ${input.program.facultyNameTh} | Level: ${input.program.levelTh} | ${input.program.totalCredits ?? '?'} credits over ${input.program.durationYears ?? '?'} years
${evidenceBlock}

[COURSES] (${input.courses.length}) — this list is closed; cite only these codes
${coursesBlock || '  (none)'}

[RESEARCH THEMES] (${input.themes.length}) — cite only these names
${themesBlock || '  (none)'}

[FACULTY ROSTER] (${input.roster.length}) — for "who could teach it"
${rosterBlock || '  (none)'}

[SKILLS THE PROGRAM ALREADY CLAIMS TO BUILD]
${input.currentProgramSkills.length ? input.currentProgramSkills.join(', ') : '(none recorded)'}

Return the JSON.`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// CHANNEL MANIFEST
//
// Consumed:
//   - program meta (code, names, level, faculty, totalCredits, durationYears)
//   - courses[] — the program's REAL extracted course list: courseCode,
//     Thai + English name, credits, CATEGORY, Thai description, learning
//     outcomes. THE anchor for every course-level claim; the list is closed
//     and (forthcoming) validated in code. `category` is load-bearing on its
//     own — it is the sole basis of the promotionCandidates lane, and
//     'UNKNOWN' (what program-courses-extract.v4 writes when it cannot read
//     the หมวด heading) is rendered as "unknown", never as a category.
//     `credits` gives the model the weight of a course it proposes to extend.
//   - themes[] — from the latest ProgramResearchExpertise payload: name,
//     paperCount, verbatim example titles, yearSpan, trend, evidenceNote.
//   - roster[] — faculty name + rank + specialization, so a new-course
//     proposal can name who would teach it.
//   - currentProgramSkills[] — what the program already claims to build.
//   - readiness + totalDistinctPapers — 'thin' plus the actual paper count
//     drive the numeric THINNESS WARNING and its at-most-2 ceiling; the
//     runner will ALSO clamp confidence deterministically (forthcoming), so
//     this is guidance, not the control.
//
// Deliberately omitted, with reason:
//   - program-research-expertise's own `recommendations.curriculum` lane —
//     the programme-level summary this section exists to replace with
//     course-level advice. Feeding it in would anchor the model to the very
//     output whose vagueness is the problem ("integrate modules into the
//     existing preparation curriculum"), and we would be unable to tell a
//     genuinely course-grounded recommendation from a restatement of the
//     summary. The THEMES are the shared substrate; the advice is derived
//     independently from them.
//   - Labour-market demand — that is the Gap Analyzer's argument. Blending
//     "what our researchers know" with "what employers want" would hide two
//     separate decisions inside one recommendation.
//   - Peer-institution curricula — the Benchmarking module's job.
//   - Paper abstracts/findings — not held by the platform; titles only, per
//     the same constraint program-research-expertise operates under.
//   - Student evaluation / GPA data — course *performance* is a different
//     question from course *content*, and mixing them would let a
//     well-taught course look like it needs new content, or vice versa.
// ─────────────────────────────────────────────────────────────────────────────
