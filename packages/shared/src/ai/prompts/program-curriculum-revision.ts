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
// GROUNDING RULES WITH TEETH — enforced in CODE, not merely requested:
// validateCurriculumRevisionPayload() (packages/db/src/
// program-curriculum-revision.ts) DROPS any item naming a courseCode absent
// from the program's real course list, and any themeRef absent from the
// input themes. The whole value of this section is that a reader can look
// up the course it names; one that cites a non-existent course is worse
// than no recommendation at all.
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
        themeRefs: z.array(z.string()).default([]),
        addition: z.string(),
        additionDetail: z.string().default(''),
        effort: EffortEnum,
        evidencePaperTitles: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  newCourseProposals: z
    .array(
      z.object({
        titleTh: z.string(),
        titleEn: z.string().default(''),
        credits: z.number().int().min(0).max(30),
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
    .default([]),
  confidence: z.number().min(0).max(1),
  caveats: z.array(z.string()).default([]),
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
}

export function buildProgramCurriculumRevisionMessages(
  input: CurriculumRevisionInput,
): AiMessage[] {
  const system = `You advise a Thai university department on how to revise one academic program's curriculum so it reflects the research its own faculty actually publish. Your output is a DRAFT for a curriculum committee to edit — never a decision, and never an accreditation submission.

HARD CONSTRAINTS:
1. **The course list is CLOSED.** Every courseCode you cite in enhanceCourses or promotionCandidates MUST appear verbatim in the COURSES block below. Do not invent, guess, or extrapolate a course code. A recommendation naming a course that does not exist is discarded before anyone reads it.
2. **Themes are closed too.** Every themeRefs entry must match a theme name from the RESEARCH THEMES block exactly.
3. **currentlyCoversQuote must be VERBATIM** from that course's own description in the COURSES block — copy the text, do not paraphrase or summarise. It is what lets a reader confirm you understood the course. When a course shows "(none on file)" it has no description: return an empty string for that field rather than quoting the placeholder.
4. **You were shown paper TITLES only** — no abstracts, no findings. Never claim what a paper concluded or how it was conducted. That a paper belongs to a subject area is title-supportable; what it found is not.
5. **Do not recommend removing, retiring, or consolidating any course.** That judgement affects staff livelihoods and cannot rest on research volume.
6. **Promotion advice requires category evidence.** Only propose promoting a course whose category is given as MAJOR_ELECTIVE. When a course's category is unknown, it is not eligible — say nothing about its status.
7. **Evidence-proportional output.** With thin research, produce FEWER and more hedged recommendations, and say so in caveats. Padding a thin portfolio into a confident revision plan is the failure mode this section exists to avoid. Returning one well-grounded recommendation is a better answer than five speculative ones.

WHAT TO PRODUCE:
- coverageSummary — how many research themes are already reflected in the curriculum, which are absent entirely, and a 2-4 sentence read.
- enhanceCourses — for a specific existing course, what it covers today (verbatim quote), which research theme it does not yet reflect, and a CONCRETE addition: a topic, a module, or a revised learning outcome. Not "modernise the course".
- newCourseProposals — only where a research strength has no home in ANY existing course. Give a Thai and English title, credits, the study year and semester it belongs in, and which roster member could teach it.
- promotionCandidates — a MAJOR_ELECTIVE course strongly backed by the program's own research that merits becoming MAJOR_REQUIRED.

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
      "themeRefs": ["<theme name from the RESEARCH THEMES block>"],
      "addition": "<the concrete addition, one line>",
      "additionDetail": "<what it looks like in practice — module length, topic list, or revised outcome>",
      "effort": "MINOR" | "MODERATE" | "MAJOR",
      "evidencePaperTitles": ["<verbatim example title supporting this>"]
    }
  ],
  "newCourseProposals": [
    {
      "titleTh": "<Thai course title>",
      "titleEn": "<English course title>",
      "credits": <int 0-30>,
      "placementYear": <int 1-8>,
      "placementSemester": <int 1-3>,
      "themeRefs": ["<theme name>"],
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
      "themeRefs": ["<theme name>"],
      "rationale": "<why the program's own research makes this core>"
    }
  ],
  "confidence": 0.0-1.0,
  "caveats": ["<any material limitation of this draft>"]
}

Every array may be empty — an empty array is the correct answer when the evidence supports nothing in that lane. Output STRICT JSON matching the schema described. No prose before or after, no markdown fences.`;

  const coursesBlock = input.courses
    .map((c) => {
      const cat = c.category ?? 'category unknown — not eligible for promotion advice';
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

  const user = `[PROGRAM] ${input.program.code} — ${input.program.nameTh}${input.program.nameEn ? ` / ${input.program.nameEn}` : ''}
Faculty: ${input.program.facultyNameTh} | Level: ${input.program.levelTh} | ${input.program.totalCredits ?? '?'} credits over ${input.program.durationYears ?? '?'} years
Research evidence base: ${input.readiness === 'thin' ? 'THIN — few papers; hedge accordingly and say so in caveats' : 'adequate'}

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
//   - courses[] — the program's REAL extracted course list, each with its
//     Thai description and learning outcomes. THE anchor for every
//     course-level claim; the list is closed and validated in code.
//   - themes[] — from the latest ProgramResearchExpertise payload: name,
//     paperCount, verbatim example titles, yearSpan, trend, evidenceNote.
//   - roster[] — faculty name + rank + specialization, so a new-course
//     proposal can name who would teach it.
//   - currentProgramSkills[] — what the program already claims to build.
//   - readiness — 'thin' tells the model to hedge; the runner ALSO clamps
//     confidence deterministically, so this is guidance, not the control.
//
// Deliberately omitted, with reason:
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
