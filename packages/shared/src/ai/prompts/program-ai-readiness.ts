import { z } from 'zod';
import type { AiMessage } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// program-ai-readiness.v2
//
// REPLACES the deterministic v1 (keyword-classifier) AI readiness assessment.
// v1 produced generic, discipline-blind output: it would tell a Music
// program to "introduce MIT 6.036" and a Veterinary program to "embed
// machine learning". Council found this irrelevant.
//
// v2 reasons over the program's actual discipline + curriculum + skills
// + career paths and produces guidance that is grounded in the
// discipline (e.g. "AI for music information retrieval" for music,
// "AI-assisted livestock health monitoring" for vet, "generative
// design with parametric modelling" for architecture).
//
// Hard rules (system prompt):
//   1. Every gap and recommendation must reference the program's
//      discipline by name (e.g. "for music programs", "in veterinary
//      practice", "in your architecture curriculum").
//   2. NEVER cite generic CS courses (MIT 6.036, Stanford CS229) unless
//      the program IS a CS program. Cite discipline-relevant
//      institutions instead (Berklee Music Tech, RVC London for vet,
//      MIT Design Lab for architecture, etc.).
//   3. Recommendations must be concrete: name a course to add, a
//      collaboration to start, a tool to introduce. NOT "consider
//      embedding AI".
//   4. AI applications listed must be specific to the discipline, not
//      generic ML.
//   5. Acknowledge when the program is genuinely AI-distant (some
//      humanities, some performing arts) and recommend appropriate
//      lighter-touch interventions.
//
// Output language: English (the existing UI renders these as labels +
// detail text in English; Council bilingual rendering is downstream).
//
// Pro thinking model is appropriate — this is reasoning + drafting, not
// extraction.
// ─────────────────────────────────────────────────────────────────────────────

export const PROGRAM_AI_READINESS_VERSION = 'program-ai-readiness.v2';

export const ProgramAiReadinessGapSchema = z.object({
  topic: z.string().min(5).max(160),
  severity: z.enum(['major', 'moderate', 'minor']),
  observation: z.string().min(20).max(800),
  /** Optional name of a peer institution / program / framework that handles
   *  this dimension well in the same discipline. */
  peerReference: z.string().max(300).nullable(),
});
export type ProgramAiReadinessGap = z.infer<typeof ProgramAiReadinessGapSchema>;

export const ProgramAiReadinessRecommendationSchema = z.object({
  priority: z.enum(['high', 'medium', 'low']),
  title: z.string().min(5).max(160),
  detail: z.string().min(30).max(900),
  effortHorizon: z.enum(['short', 'medium', 'long']),
});
export type ProgramAiReadinessRecommendation = z.infer<
  typeof ProgramAiReadinessRecommendationSchema
>;

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
  disciplineAiContext: z.string().min(80).max(1500),
  /** 4-6 specific AI applications relevant to THIS discipline.
   *  Title + 1-2 sentence description. NOT generic ML. */
  aiApplicationsForDiscipline: z
    .array(
      z.object({
        title: z.string().min(5).max(80),
        description: z.string().min(20).max(300),
      }),
    )
    .min(3)
    .max(6),
  /** 1-2 sentence assessment of what the curriculum currently teaches
   *  about AI, citing actual course/skill names from the input snapshot. */
  currentCoverageAssessment: z.string().min(40).max(800),
  /** 1-2 sentence summary visible at the top of the section. */
  summary: z.string().min(40).max(500),
  /** Discipline-specific gaps. */
  gaps: z.array(ProgramAiReadinessGapSchema).min(0).max(6),
  /** Discipline-specific actionable recommendations. */
  recommendations: z.array(ProgramAiReadinessRecommendationSchema).min(1).max(6),
  /** 2-3 institutions globally that lead in AI for THIS discipline.
   *  Must NOT be generic CS schools unless the program IS a CS program. */
  peerReferences: z
    .array(
      z.object({
        institution: z.string().min(2).max(100),
        country: z.string().min(2).max(60),
        whatTheyDo: z.string().min(20).max(200),
      }),
    )
    .max(4),
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

CRITICAL RULES:

1. Discipline-relevance is the ONLY axis that matters.
   - For a music program: AI = music information retrieval, generative composition, audio source separation, performance analytics, AI-assisted mixing.
   - For a veterinary program: AI = computer vision for diagnostic imaging, livestock health monitoring, drug discovery, epidemiological modelling.
   - For an architecture program: AI = generative design, parametric modelling, BIM with AI, sustainability simulation.
   - For an agriculture program: AI = precision agriculture, crop disease vision systems, yield forecasting, soil analytics.
   - For a law program: AI = legal NLP, contract analysis, e-discovery, legal research assistants.
   - For a CS / data-science program: yes, AI = ML, deep learning, MLOps, etc.
   - For a humanities program: AI = digital humanities, text-mining, computational linguistics, AI-augmented research.

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

6. If the program is genuinely AI-distant (e.g. classical performance, traditional medicine), say so honestly and recommend lighter-touch interventions (one elective, awareness module). Do not force-fit aggressive AI integration where it would harm the discipline.

7. Do NOT cite numbers, courses, skills, or recommendations that are not justified by the input snapshot. Ground every observation in either the discipline's universal context or the snapshot data.

8. Output language: English. Concise, specific, no hedging language.`;

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
  "confidence": <number 0-1>
}
\`\`\`

Rules:
- 4-6 entries in \`aiApplicationsForDiscipline\`.
- 0-6 entries in \`gaps\`. Each \`severity\` must be one of "major" | "moderate" | "minor".
- 1-6 entries in \`recommendations\`. Each \`priority\` is "high" | "medium" | "low"; each \`effortHorizon\` is "short" | "medium" | "long".
- 2-3 entries in \`peerReferences\`. Cite institutions that lead in AI for THIS discipline (NOT generic CS schools unless the program IS a CS program).
- Ground EVERY gap and recommendation in this specific discipline. Recommendations must name a course, tool, or partner.
- The \`relevanceScore\` reflects readiness RELATIVE TO what AI looks like in this discipline.`;
};

export function buildProgramAiReadinessMessages(input: ProgramAiReadinessInput): AiMessage[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: USER_PROMPT_TEMPLATE(input) },
  ];
}
