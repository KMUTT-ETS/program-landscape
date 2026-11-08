import { z } from 'zod';
import type { AiMessage } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// program-ai-readiness.v4
//
// v4 (2026-05-19) — data-source upgrade only, no prompt change. The
// `courses` input now comes from `program_courses` (canonical course
// list from `program-courses-extract.v1`, typically 40-90 courses per
// Bachelor) instead of the legacy digest payload's top-25 truncated
// list. The AI sees the full curriculum and can spot AI-disruption
// gaps that were invisible under the old 25-course window. Method
// version bumps so back-compared assessments are distinguishable.
//
// v3 (2026-05-12) layers the Shao et al. (2025) "Future of Work with AI
// Agents" framework on top of v2's discipline-aware reasoning:
//
//   - Human Agency Scale (HAS) — 5-level taxonomy of how much human
//     involvement is desired in a task family. H1 = fully automate;
//     H3 = AI+human collaborate; H5 = human only.
//   - Four-zone automation matrix — Green Light (workers want it +
//     AI can do it), Red Light (low desire + high capability),
//     R&D Opportunity (high desire + low capability), Low Priority.
//
// Why: v2's discipline-only lens missed the "what workers actually
// want" dimension. A program graduating into a Red Light occupation
// (e.g. clinical care, classroom teaching) shouldn't be marked AI-low
// just because adjacent tasks aren't automated — Council needs to see
// that the discipline DESIRES human-in-the-loop posture, not that the
// program is lagging. Conversely, Green Light occupations make AI
// readiness urgent regardless of how the curriculum feels about it.
//
// Citation in every output (`frameworkCitation` field) so Council can
// trace the reasoning. v3 also asks the LLM to estimate task-family-
// level HAS scores; we surface those alongside the relevance score.
//
// REPLACES the deterministic v1 (keyword-classifier) AI readiness
// assessment from prompt-04 and v2's discipline-aware reasoning.
// All v2 fields preserved; new fields are additive.
//
// Hard rules (system prompt):
//   1. Every gap and recommendation must reference the program's
//      discipline by name.
//   2. NEVER cite generic CS courses (MIT 6.036, Stanford CS229) unless
//      the program IS a CS program. Cite discipline-relevant
//      institutions instead.
//   3. Recommendations must be concrete: name a course to add, a
//      collaboration to start, a tool to introduce.
//   4. AI applications listed must be specific to the discipline.
//   5. Acknowledge when the program is genuinely AI-distant or in a
//      Red Light zone (workers prefer human-led); recommend
//      appropriate lighter-touch interventions.
//   6. The taskFamilies analysis must reflect the LOCAL (Thai labour
//      market) reality, not US-only generalisations from the source
//      paper. Treat HAS as a transferable framework, not the
//      paper's specific US scores.
//
// Output language: English (UI renders these as labels + detail text
// in English; Council bilingual rendering is downstream).
//
// Pro thinking model is appropriate — reasoning + drafting, not
// extraction.
// ─────────────────────────────────────────────────────────────────────────────

export const PROGRAM_AI_READINESS_VERSION = 'program-ai-readiness.v4';

// ── Parser leniency (not a prompt change — the template text is untouched) ──
// A model overshooting a length cap by a few characters, or emitting a stray
// type in one optional list item, must not fail a Council-facing phase.
// Over-length text is clamped with an ellipsis; a malformed list item is
// dropped. Lists whose minimum would no longer hold still fail validation.
export function clampText(max: number): (v: unknown) => unknown {
  return (v) =>
    typeof v === 'string' && v.length > max ? `${v.slice(0, Math.max(0, max - 1)).trimEnd()}\u2026` : v;
}

function text(min: number, max: number): z.ZodEffects<z.ZodString, string, unknown> {
  return z.preprocess(clampText(max), z.string().min(min).max(max)) as z.ZodEffects<
    z.ZodString,
    string,
    unknown
  >;
}

function nullableText(max: number): z.ZodEffects<z.ZodNullable<z.ZodString>, string | null, unknown> {
  return z.preprocess(
    (v) => (typeof v === 'string' ? clampText(max)(v) : null),
    z.string().max(max).nullable(),
  ) as z.ZodEffects<
    z.ZodNullable<z.ZodString>,
    string | null,
    unknown
  >;
}

/** Drops items that fail `item`, truncates to `max`, then validates the rest. */
function lenientList<I extends z.ZodTypeAny>(item: I, min: number, max: number) {
  return z.preprocess(
    (v) =>
      Array.isArray(v) ? v.filter((i) => item.safeParse(i).success).slice(0, max) : v,
    z.array(item).min(min).max(max),
  );
}

export const ProgramAiReadinessGapSchema = z.object({
  topic: text(5, 160),
  severity: z.enum(['major', 'moderate', 'minor']),
  observation: text(20, 800),
  /** Optional name of a peer institution / program / framework that handles
   *  this dimension well in the same discipline. */
  peerReference: nullableText(300),
});
export type ProgramAiReadinessGap = z.infer<typeof ProgramAiReadinessGapSchema>;

export const ProgramAiReadinessRecommendationSchema = z.object({
  priority: z.enum(['high', 'medium', 'low']),
  title: text(5, 160),
  detail: text(30, 900),
  effortHorizon: z.enum(['short', 'medium', 'long']),
});
export type ProgramAiReadinessRecommendation = z.infer<
  typeof ProgramAiReadinessRecommendationSchema
>;

// Human Agency Scale (v3, from Shao et al. 2025, arXiv:2506.06576).
// H1 = AI does everything autonomously; H5 = human does everything,
// no AI involvement. Higher number = more preferred human agency.
export const HumanAgencyLevelSchema = z.enum(['H1', 'H2', 'H3', 'H4', 'H5']);
export type HumanAgencyLevel = z.infer<typeof HumanAgencyLevelSchema>;

// Four-zone automation matrix (v3). Two axes: worker desire to
// automate (high/low) × current AI capability (high/low).
//   GREEN_LIGHT     — high desire + high capability → proceed
//   RED_LIGHT       — low desire + high capability → caution
//   RD_OPPORTUNITY  — high desire + low capability → invest in R&D
//   LOW_PRIORITY    — low desire + low capability → leave alone
export const AutomationZoneSchema = z.enum([
  'GREEN_LIGHT',
  'RED_LIGHT',
  'RD_OPPORTUNITY',
  'LOW_PRIORITY',
]);
export type AutomationZone = z.infer<typeof AutomationZoneSchema>;

// One row per major task family the program's graduates produce.
// 3-6 entries per program; the LLM should consolidate, not enumerate
// every micro-task.
export const TaskFamilyAssessmentSchema = z.object({
  label: text(5, 160),
  /** Preferred human-agency level for this task family in the
   *  local labour-market context. */
  has: HumanAgencyLevelSchema,
  /** Which of the four automation zones the family falls into
   *  given current AI capability + worker preference. */
  zone: AutomationZoneSchema,
  /** 1-2 sentence justification grounded in the program's
   *  discipline + likely graduate roles. */
  rationale: text(20, 500),
});
export type TaskFamilyAssessment = z.infer<typeof TaskFamilyAssessmentSchema>;

export const ProgramAiReadinessAssessmentSchema = z.object({
  /** Discipline-aware readiness score, 0-100. Anchored relative to what AI
   *  readiness MEANS for this discipline — not a generic ML-coverage score.
   *  A music program with strong AI-music-tech is 80, not 20 just because
   *  it doesn't teach ML theory. */
  relevanceScore: z.number().min(0).max(100),
  /** 1-2 paragraph orientation: "AI in <discipline> looks like X. The
   *  field is moving toward Y. Programs that are AI-ready in this
   *  discipline have Z." Used by Council members who aren't familiar
   *  with how AI shows up outside CS. */
  disciplineAiContext: text(80, 1500),
  /** 4-6 specific AI applications relevant to THIS discipline.
   *  Title + 1-2 sentence description. NOT generic ML. */
  aiApplicationsForDiscipline: lenientList(
    z.object({
      title: text(5, 80),
      description: text(20, 300),
    }),
    3,
    6,
  ),
  /** 1-2 sentence assessment of what the curriculum currently teaches
   *  about AI, citing actual course/skill names from the input snapshot. */
  currentCoverageAssessment: text(40, 800),
  /** 1-2 sentence summary visible at the top of the section. */
  summary: text(40, 500),
  /** Discipline-specific gaps. */
  gaps: lenientList(ProgramAiReadinessGapSchema, 0, 6),
  /** Discipline-specific actionable recommendations. */
  recommendations: lenientList(ProgramAiReadinessRecommendationSchema, 1, 6),
  /** 2-3 institutions globally that lead in AI for THIS discipline.
   *  Must NOT be generic CS schools unless the program IS a CS program. */
  peerReferences: lenientList(
    z.object({
      institution: text(2, 100),
      country: text(2, 60),
      whatTheyDo: text(20, 200),
    }),
    0,
    4,
  ),
  // ── v3 additions ──────────────────────────────────────────────────
  /** Task families the program's graduates produce, with HAS + zone.
   *  3-6 entries. Drives the "what posture does this program need"
   *  discussion separately from "is this program AI-ready". */
  taskFamilies: z.preprocess(
    (v) => {
      if (!Array.isArray(v)) return v;
      const kept = v.filter((i) => TaskFamilyAssessmentSchema.safeParse(i).success).slice(0, 6);
      // Optional section: fewer than two usable families is dropped, not fatal.
      return kept.length >= 2 ? kept : undefined;
    },
    z.array(TaskFamilyAssessmentSchema).min(2).max(6).optional(),
  ),
  /** 1-paragraph strategic posture: given the mix of HAS levels and
   *  automation zones, what does AI readiness MEAN for this program?
   *  e.g. "Clinical-care programs (Red Light) should focus on AI
   *  literacy + supervised decision-support rather than automation
   *  per se" vs "Data analytics (Green Light) should treat fluent AI
   *  use as a core graduate competency". */
  automationOutlook: z.preprocess(
    (v) => (typeof v === 'string' ? clampText(1200)(v) : undefined),
    z.string().min(40).max(1200).optional(),
  ),
  /** Literal citation string — Council provenance. */
  frameworkCitation: z.preprocess(
    (v) => (typeof v === 'string' ? v : undefined),
    z.string().optional(),
  ),
  confidence: z.number().min(0).max(1),
});
export type ProgramAiReadinessAssessmentPayload = z.infer<
  typeof ProgramAiReadinessAssessmentSchema
>;

// ─── Input shape ─────────────────────────────────────────────────────────────

export interface ProgramAiReadinessInput {
  programNameTh: string;
  programNameEn: string;
  programLevel: 'BACHELOR' | 'MASTER' | 'DOCTORAL' | 'HIGHER_GRAD_DIPLOMA';
  /** English faculty name — anchors the discipline. */
  facultyNameEn: string;
  /** Program duration in years (informational). */
  durationYears: number | null;
  /** Skills currently taught (from ProgramSkill rows + digest fallback).
   *  Each item: name + weight (0..1) + whether compulsory. */
  programSkills: Array<{ name: string; weight: number; compulsory: boolean }>;
  /** Course list from the program digest, if available. Up to ~30 courses. */
  courses: Array<{ code: string | null; nameEn: string | null; nameTh: string | null }>;
  /** Career paths as advertised by the program (from the digest payload). */
  careerPaths: string[];
  /** Recruitment summary text from the digest, if available. */
  recruitmentSummaryTh: string | null;
  /** Existing deterministic v1 sub-scores (for context — the AI may agree
   *  or disagree). */
  deterministicScores: {
    overallScore: number;
    curriculumIntegration: number;
    skillResilience: number;
    researchPresence: number;
    aiNativeSkillCount: number;
    totalSkillCount: number;
  };
}

// ─── Prompt builder ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an academic strategy advisor evaluating how well a university program is prepared for the AI shift in ITS specific discipline. You do NOT generate generic ML/CS guidance. You produce discipline-grounded, actionable assessment.

FRAMEWORK (Shao, Brynjolfsson et al. 2025, "Future of Work with AI Agents", arXiv:2506.06576):

Apply the Human Agency Scale (HAS) — a 5-level taxonomy of how much human involvement is DESIRED for each task family:
  - H1: workers want AI to handle the task autonomously
  - H2: AI does most of the work, human reviews
  - H3: equal AI + human collaboration
  - H4: human leads, AI augments
  - H5: human does everything, no AI involvement

Apply the four-zone automation matrix combining desire-to-automate with current AI capability:
  - GREEN_LIGHT: workers want it + AI can do it → proceed
  - RED_LIGHT:   workers DON'T want it + AI can do it → caution (ethical / workforce-trust concerns)
  - RD_OPPORTUNITY: workers want it + AI can't yet → invest in tooling
  - LOW_PRIORITY: workers don't want it + AI can't → leave alone

The framework is universal; the SCORES in the source paper are US-only — for Thai labour-market judgments, apply the framework's logic to the local context (rural medicine, Thai SME accountancy, Mekong-region agriculture, etc.), not the paper's specific numbers.

CRITICAL RULES:

1. Discipline-relevance is the PRIMARY axis. AI readiness means different things in different fields:
   - Music: music information retrieval, generative composition, audio source separation, performance analytics, AI-assisted mixing.
   - Veterinary: computer vision for diagnostic imaging, livestock health monitoring, drug discovery, epidemiological modelling.
   - Architecture: generative design, parametric modelling, BIM with AI, sustainability simulation.
   - Agriculture: precision agriculture, crop disease vision systems, yield forecasting, soil analytics.
   - Law: legal NLP, contract analysis, e-discovery, legal research assistants.
   - CS / data-science: ML, deep learning, MLOps, etc.
   - Humanities: digital humanities, text-mining, computational linguistics, AI-augmented research.

2. NEVER cite generic CS course numbers (MIT 6.036, Stanford CS229, etc.) unless the program IS a CS program. For other disciplines, cite the relevant peer institutions for THAT discipline (Berklee for music tech, MIT Media Lab for design, ETH Zurich for architecture-AI, RVC London for vet-AI, etc.).

3. Recommendations must be CONCRETE:
   - "Add a 3-credit course on <specific topic>" not "introduce AI".
   - "Pilot a collaboration with <named institution / department>".
   - "Adopt <specific AI tool> in <specific course>".

4. Gaps must be DISCIPLINE-SPECIFIC. Do not write "Curriculum lacks AI" — write "Curriculum lacks computational analysis methods that other top music tech programs treat as core (e.g. MIR, audio analytics)".

5. relevanceScore (0-100) is anchored to what AI readiness MEANS for this discipline:
   - 80-100: this program is at the frontier for AI in its discipline (rare).
   - 60-79: meaningful AI integration appropriate to the discipline.
   - 40-59: some exposure but lagging discipline-specific best practice.
   - 20-39: minimal exposure; significant catch-up needed.
   - 0-19: no measurable AI exposure relevant to the discipline.

6. HAS + zone analysis MODULATES the verdict — don't punish a program for low automation when its graduates work in Red Light territory. A nursing program landing mostly in H4-H5 / RED_LIGHT zones isn't AI-distant in a bad way; it's correctly aligned with worker preferences. Reflect that in the recommendations: AI literacy + supervised decision-support, not full automation.

7. If the program is genuinely AI-distant (e.g. classical performance, traditional medicine), say so honestly and recommend lighter-touch interventions. Don't force-fit aggressive AI integration where it would harm the discipline.

8. Do NOT cite numbers, courses, skills, or recommendations that are not justified by the input snapshot. Ground every observation in either the discipline's universal context or the snapshot data.

9. Output language: English. Concise, specific, no hedging language.

10. Always include "Shao et al. 2025 (arXiv:2506.06576)" in the frameworkCitation field so Council can trace the HAS / zone reasoning back to source.`;

const USER_PROMPT_TEMPLATE = (input: ProgramAiReadinessInput) => {
  const skillLines = input.programSkills.length === 0
    ? '(no extracted skills available — assess from program metadata + courses)'
    : input.programSkills
        .slice(0, 40)
        .map((s) => `  - ${s.name} (weight ${s.weight.toFixed(2)}${s.compulsory ? ', compulsory' : ', elective'})`)
        .join('\n');
  const courseLines = input.courses.length === 0
    ? '(no extracted course list available)'
    : input.courses
        .slice(0, 25)
        .map((c) => `  - ${c.code ?? '(no code)'} · ${c.nameEn ?? c.nameTh ?? '(no name)'}`)
        .join('\n');
  const careerLines = input.careerPaths.length === 0
    ? '(no career paths advertised)'
    : input.careerPaths.slice(0, 10).map((c) => `  - ${c}`).join('\n');
  const recruit = input.recruitmentSummaryTh
    ? `\n## Recruitment summary (Thai)\n${input.recruitmentSummaryTh.slice(0, 1500)}\n`
    : '';

  return `# Program: ${input.programNameEn || input.programNameTh}
Faculty: ${input.facultyNameEn}
Level: ${input.programLevel}${input.durationYears ? ` (${input.durationYears}-year)` : ''}
Thai name: ${input.programNameTh}

## Deterministic baseline (from keyword classifier — for context only; you may disagree)
Overall: ${input.deterministicScores.overallScore.toFixed(0)}/100
- Curriculum integration: ${input.deterministicScores.curriculumIntegration.toFixed(0)}/100
- Skill resilience: ${input.deterministicScores.skillResilience.toFixed(0)}/100
- Research presence: ${input.deterministicScores.researchPresence.toFixed(0)}/100
- AI-native skills found by keyword match: ${input.deterministicScores.aiNativeSkillCount} of ${input.deterministicScores.totalSkillCount}

## Program skills (top ${Math.min(40, input.programSkills.length)})
${skillLines}

## Course list (top ${Math.min(25, input.courses.length)})
${courseLines}

## Career paths advertised
${careerLines}
${recruit}
---

Produce the assessment as a SINGLE JSON object using EXACTLY the field names and shapes shown below (no other top-level fields, no renaming):

\`\`\`json
{
  "relevanceScore": <number 0-100>,
  "disciplineAiContext": "<1-2 paragraphs orienting the reader to AI in this discipline>",
  "aiApplicationsForDiscipline": [
    { "title": "<short title>", "description": "<1-2 sentence description>" }
  ],
  "currentCoverageAssessment": "<1-2 sentences citing actual courses/skills from the snapshot>",
  "summary": "<1-2 sentences for the section header>",
  "gaps": [
    { "topic": "<short discipline-specific gap>", "severity": "major" | "moderate" | "minor", "observation": "<full paragraph>", "peerReference": "<peer institution that does this well, or null>" }
  ],
  "recommendations": [
    { "priority": "high" | "medium" | "low", "title": "<short title>", "detail": "<concrete action paragraph>", "effortHorizon": "short" | "medium" | "long" }
  ],
  "peerReferences": [
    { "institution": "<name>", "country": "<country>", "whatTheyDo": "<1-2 sentences>" }
  ],
  "taskFamilies": [
    { "label": "<3-6 word task-family name>", "has": "H1"|"H2"|"H3"|"H4"|"H5", "zone": "GREEN_LIGHT"|"RED_LIGHT"|"RD_OPPORTUNITY"|"LOW_PRIORITY", "rationale": "<1-2 sentences>" }
  ],
  "automationOutlook": "<1 paragraph: given this mix of HAS levels and zones, what does AI readiness MEAN for this program?>",
  "frameworkCitation": "Shao et al. 2025 (arXiv:2506.06576)",
  "confidence": <number 0-1>
}
\`\`\`

Rules:
- 4-6 entries in \`aiApplicationsForDiscipline\`.
- 0-6 entries in \`gaps\`. Each \`severity\` must be one of "major" | "moderate" | "minor".
- 1-6 entries in \`recommendations\`. Each \`priority\` is "high" | "medium" | "low"; each \`effortHorizon\` is "short" | "medium" | "long".
- 2-3 entries in \`peerReferences\`. Cite institutions that lead in AI for THIS discipline (NOT generic CS schools unless the program IS a CS program).
- 3-6 entries in \`taskFamilies\`. Pick the major occupational task families graduates of this program enter in the THAI labour market — consolidate, don't enumerate every micro-task. Each \`has\` is one of "H1".."H5"; each \`zone\` is one of "GREEN_LIGHT" | "RED_LIGHT" | "RD_OPPORTUNITY" | "LOW_PRIORITY".
- \`automationOutlook\` must connect the HAS/zone mix to a concrete strategic posture (e.g. "graduates land mostly in H4 + RED_LIGHT zones, so the program should invest in AI-literacy + supervised decision-support rather than autonomous-AI workflows").
- \`frameworkCitation\` must be the literal string "Shao et al. 2025 (arXiv:2506.06576)".
- Ground EVERY gap and recommendation in this specific discipline. Recommendations must name a course, tool, or partner.
- The \`relevanceScore\` reflects readiness RELATIVE TO what AI looks like in this discipline AND the HAS/zone posture (a Red Light program lagging on automation isn't penalised the same as a Green Light program lagging).`;
};

export function buildProgramAiReadinessMessages(input: ProgramAiReadinessInput): AiMessage[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: USER_PROMPT_TEMPLATE(input) },
  ];
}
