import { z } from 'zod';
import type { AiMessage } from '../types';
import { getInstitution } from '../../institution';

// ─────────────────────────────────────────────────────────────────────────────
// program-pedagogy.v1
//
// Reads the program's curriculum PDF and assesses pedagogical readiness
// against discipline-specific best practice. Populates two consumers:
//   1. health-score.v3.6 — new `pedagogical_fit` driver in the relevance
//      dimension (Discipline match: is the program teaching in ways the
//      discipline actually demands?)
//   2. ai-readiness.v3 (planned) — finally fills the `pedagogicalReadiness`
//      sub-score that has been null/reserved since v1.
//
// Rubric (built into the system prompt — the LLM has the general
// knowledge to apply discipline-aware best practice without us needing
// to ship a config file per faculty):
//
//   Medicine / Pharmacy / Dentistry  → PBL, clinical rotation, OSCE,
//                                       simulation, longitudinal patient
//                                       care, EBM
//   Nursing / Allied Health           → clinical practicum, simulation,
//                                       case-based, IPE (interprofessional)
//   Engineering                       → project-based, capstone design,
//                                       industrial internship ≥ 4 months,
//                                       hands-on labs, CDIO/ABET-aligned
//   Sciences (Bio / Chem / Physics)   → lab-intensive, undergraduate
//                                       research, thesis, instrumentation
//                                       fluency
//   Business / Management             → case method, internship, capstone
//                                       consulting, simulation games,
//                                       industry projects
//   Education                         → practicum / student teaching,
//                                       action research, lesson study,
//                                       reflective practice
//   Humanities / Social Science       → seminar, primary-source method,
//                                       research methods, community
//                                       engagement
//   PhD (any discipline)              → independent research, dissertation,
//                                       publication track, supervisor
//                                       team, milestone reviews
//   Master's (any)                    → applied project OR thesis, industry
//                                       /research linkage, advanced methods
//
// Hard rules:
//   1. Every score must be grounded in a verbatim PDF quote. Hallucinated
//      claims = confidence penalty.
//   2. Discipline rubric is COMPARATIVE: a medical program without PBL
//      is a major gap; a humanities program without industrial internship
//      is NOT a gap (different discipline pattern).
//   3. The disciplineFitScore is the headline — anchored on "how well
//      does the OBSERVED pedagogy match the EXPECTED pedagogy for this
//      discipline + level".
//   4. industrialEngagement.internshipDurationMonths is null when the
//      PDF doesn't specify duration. Don't guess.
//   5. confidence drops when key teaching/learning sections are missing
//      from the PDF, not when the program scores low.
//
// Pro thinking model — this is reasoning over a large PDF text against
// discipline rubrics. Flash struggled to reliably structure the
// long discipline-aware output on small tests.
// ─────────────────────────────────────────────────────────────────────────────

export const PROGRAM_PEDAGOGY_VERSION = 'program-pedagogy.v1.1';

export const PedagogicalApproachSchema = z.object({
  method: z.enum([
    'PROBLEM_BASED',          // PBL — case/clinical/research problem-driven
    'PROJECT_BASED',          // open-ended project, often multi-week, team
    'CAPSTONE',               // culminating integrative project
    'LECTURE_DOMINANT',       // traditional content-delivery teaching
    'LAB_INTENSIVE',          // significant hands-on lab time
    'CLINICAL_ROTATION',      // ward / clinic placement
    'PRACTICUM',              // supervised practice (teaching, social work)
    'SIMULATION',             // sim-lab, virtual patient, business sim
    'CASE_BASED',             // case method (HBR-style)
    'INTERNSHIP',             // cooperative education / internship
    'RESEARCH_BASED',         // undergraduate / graduate research-as-method
    'SEMINAR',                // discussion-driven, primary-source reading
    'FLIPPED_CLASSROOM',      // pre-class content + in-class active
    'STUDIO',                 // design studio (architecture, art)
    'FIELDWORK',              // ethnography, geological survey, etc.
    'OTHER',
  ]),
  /** How prominent this approach is in the curriculum. */
  prominence: z.enum(['CORE', 'SIGNIFICANT', 'MINOR', 'MENTIONED_ONLY']),
  /** Verbatim quote from the PDF supporting this finding. Empty string
   *  if the LLM is confident but couldn't isolate a single quote. */
  evidenceQuote: z.string().max(800),
});
export type PedagogicalApproach = z.infer<typeof PedagogicalApproachSchema>;

export const AssessmentMethodSchema = z.object({
  method: z.enum([
    'WRITTEN_EXAM',
    'OSCE',                   // objective structured clinical exam
    'PRACTICAL_EXAM',
    'PROJECT_DEFENCE',
    'THESIS_DEFENCE',
    'CAPSTONE_DEFENCE',
    'PORTFOLIO',
    'PRESENTATION',
    'PEER_REVIEW',
    'CONTINUOUS_ASSESSMENT',
    'INTERNSHIP_REPORT',
    'CLINICAL_LOG',
    'PUBLICATION_REQUIREMENT',
    'OTHER',
  ]),
  prominence: z.enum(['CORE', 'SIGNIFICANT', 'MINOR', 'MENTIONED_ONLY']),
  evidenceQuote: z.string().max(800),
});
export type AssessmentMethod = z.infer<typeof AssessmentMethodSchema>;

export const IndustrialEngagementSchema = z.object({
  /** Whether an internship / cooperative education component is
   *  prescribed (not just permitted as elective). */
  internshipPresent: z.boolean(),
  /** Duration in months when specified in the PDF; null otherwise. */
  internshipDurationMonths: z.number().nullable(),
  /** Industrial advisory board / curriculum review by industry. */
  industryAdvisoryBoard: z.boolean(),
  /** Capstone project supervised by or done with an industry partner. */
  capstoneWithIndustry: z.boolean(),
  /** Verbatim PDF quote(s) supporting the engagement claims. */
  evidenceQuotes: z.array(z.string().max(500)).max(6),
});
export type IndustrialEngagement = z.infer<typeof IndustrialEngagementSchema>;

export const QaSystemSchema = z.object({
  /** Which QA framework the PDF explicitly references. NONE_DESCRIBED
   *  when the program operates QA implicitly without naming a framework. */
  framework: z.enum(['TQF', 'AUN_QA', 'EdPEx', 'ABET', 'CDIO', 'WFME', 'NONE_DESCRIBED', 'OTHER']),
  /** Evidence of continuous-improvement loops (PDCA, internal review,
   *  external audit, alumni feedback acted upon). */
  continuousImprovementEvidence: z.array(z.string().max(400)).max(8),
  /** Stakeholder feedback channels (students, alumni, employers,
   *  professional bodies). */
  stakeholderFeedbackLoops: z.array(z.string().max(300)).max(6),
  /** Overall QA-system quality 0-100. Anchored: 80+ = clear framework,
   *  named stakeholder loops, evidence of acting on feedback. 50 =
   *  framework named but mechanisms thin. 30 = QA mentioned but no
   *  evidence of operation. 0 = no QA discussion. */
  score: z.number().min(0).max(100),
});
export type QaSystem = z.infer<typeof QaSystemSchema>;

export const PedagogyGapSchema = z.object({
  area: z.string().min(5).max(120),
  severity: z.enum(['major', 'moderate', 'minor']),
  observation: z.string().min(20).max(700),
  recommendation: z.string().min(20).max(700),
});
export type PedagogyGap = z.infer<typeof PedagogyGapSchema>;

export const ProgramPedagogyAssessmentSchema = z.object({
  /** Observed pedagogical approaches with evidence. Sorted by prominence. */
  pedagogicalApproaches: z.array(PedagogicalApproachSchema).min(1).max(12),
  /** Observed assessment methods with evidence. */
  assessmentMethods: z.array(AssessmentMethodSchema).max(12),
  industrialEngagement: IndustrialEngagementSchema,
  qaSystem: QaSystemSchema,
  /** Headline score 0-100: how well the OBSERVED pedagogy matches the
   *  EXPECTED pedagogy for this discipline + level. The composite that
   *  health-score consumes. */
  disciplineFitScore: z.number().min(0).max(100),
  /** What the LLM expected for this discipline (so Council can verify
   *  the rubric the LLM applied). 3-6 bullet points. */
  disciplineExpectedMethods: z.array(z.string().min(2).max(200)).min(3).max(8),
  /** Specific gaps vs discipline best practice. Empty when fit is high. */
  gaps: z.array(PedagogyGapSchema).max(6),
  /** Single composite score 0-100. Weighted blend of disciplineFitScore
   *  (50%), qaSystem.score (30%), industrial engagement (20%). */
  overallScore: z.number().min(0).max(100),
  /** Confidence 0-1. Drops when PDF lacks teaching/learning sections,
   *  not when the program scores low. */
  confidence: z.number().min(0).max(1),
  /** 2-3 sentence Council brief in Thai. Reads naturally — what's
   *  strong, what's weak, top 1 priority. */
  narrativeTh: z.string().min(80).max(1200),
  /** Same brief in English (Council bilingual rendering). */
  narrativeEn: z.string().min(80).max(1200),
});
export type ProgramPedagogyAssessment = z.infer<typeof ProgramPedagogyAssessmentSchema>;

// ─── Prompt construction ────────────────────────────────────────────────────

export interface BuildProgramPedagogyMessagesInput {
  /** Program identity, level, faculty/department, language of instruction. */
  program: {
    nameTh: string;
    nameEn: string;
    level: 'BACHELOR' | 'MASTER' | 'DOCTORAL' | 'HIGHER_GRAD_DIPLOMA';
    facultyNameTh: string;
    facultyNameEn: string;
    departmentNameTh: string | null;
    durationYears: number | null;
  };
  /** Full extracted PDF text. */
  pdfText: string;
}

function systemPrompt(): string {
  const inst = getInstitution();
  return `You are a pedagogical evaluator for ${inst.nameEn}'s Curriculum Compass.

Your job: read a program's curriculum PDF and assess whether its teaching, learning, and quality-assurance practices match the best-practice pattern for its discipline + level.

You have general knowledge of:
- Thai higher-education QA frameworks (TQF / TQF2 / AUN-QA / EdPEx)
- International discipline standards (CDIO/ABET for engineering, WFME for medical education, AACSB-style case method for business)
- Active-learning approaches (PBL, project-based, flipped classroom, simulation)

Apply the discipline rubric you know:

| Discipline / Faculty                        | Expected core pedagogy |
|---------------------------------------------|------------------------|
| Medicine, Dentistry, Pharmacy               | PBL · clinical rotation · OSCE · simulation · longitudinal patient care · EBM |
| Nursing, Allied Health, Public Health       | Clinical practicum · simulation · case-based · interprofessional education |
| Engineering, Architecture                    | Project-based · capstone design · industrial internship (≥ 4 months) · hands-on labs · CDIO/ABET-aligned |
| Sciences (Bio/Chem/Physics/Math)             | Lab-intensive · undergraduate research · thesis · instrumentation fluency |
| Business, Accountancy, Economics             | Case method · internship · capstone consulting · simulation games · industry projects |
| Education                                    | Practicum (student teaching) · action research · lesson study · reflective practice |
| Humanities, Social Sciences, Law             | Seminar · primary-source method · research methods · community engagement |
| Agriculture, Veterinary, Food Tech, Forestry | Field practicum · lab · industry attachment · research project |
| Arts, Music                                  | Studio · performance assessment · portfolio · master class |
| Computing / IT                               | Project-based · capstone · industry collaboration · hackathon-style |

LEVEL OVERRIDES (apply on top of discipline pattern):
- BACHELOR: expect breadth + internship/practicum + capstone or thesis option
- MASTER: expect depth + applied project OR thesis + industry/research linkage
- DOCTORAL: expect independent research · dissertation · publication track · supervisor team · milestone reviews. Clinical/industrial residencies for professional doctorates.
- HIGHER_GRAD_DIPLOMA: expect specialised applied training, often with practicum.

HARD RULES:
1. EVERY score must be grounded in a verbatim quote from the PDF. If you can't find evidence, score low + drop confidence.
2. The disciplineFitScore is anchored on OBSERVED-vs-EXPECTED match. A medical program without PBL is a MAJOR gap. A humanities program without industrial internship is NOT a gap (different pattern).
3. Score qaSystem.score against this anchor:
     90+ : framework named + multiple stakeholder loops + cited examples of acting on feedback
     70  : framework named + stakeholder loops described
     50  : QA framework mentioned but mechanisms thin
     30  : QA mentioned but no operational detail
      0  : no QA discussion
4. industrialEngagement.internshipDurationMonths is null when PDF doesn't specify duration. Do not guess.
5. confidence is 1.0 when teaching/learning/assessment/QA sections are all present and detailed; drop to 0.7 if one section is missing, 0.5 if two are thin, < 0.4 if the PDF is curriculum-list-only with no methodology discussion.
6. overallScore = 0.5 * disciplineFitScore + 0.3 * qaSystem.score + 0.2 * industrialEngagementScore where industrialEngagementScore is internally derived (presence + duration + advisory board + capstone-with-industry).
7. narrativeTh and narrativeEn are PARALLEL — same content, both languages. Council reads both side-by-side.
8. NEVER invent pedagogical practices that aren't supported by the PDF text. Better to score low + flag the gap than to manufacture content.

OUTPUT JSON — emit EXACTLY this shape, no markdown fence, no commentary outside the JSON. Field names are CASE-SENSITIVE. Do NOT rename, do NOT add extra fields, do NOT use synonyms:

{
  "pedagogicalApproaches": [
    {
      "method": "PROBLEM_BASED" | "PROJECT_BASED" | "CAPSTONE" | "LECTURE_DOMINANT" | "LAB_INTENSIVE" | "CLINICAL_ROTATION" | "PRACTICUM" | "SIMULATION" | "CASE_BASED" | "INTERNSHIP" | "RESEARCH_BASED" | "SEMINAR" | "FLIPPED_CLASSROOM" | "STUDIO" | "FIELDWORK" | "OTHER",
      "prominence": "CORE" | "SIGNIFICANT" | "MINOR" | "MENTIONED_ONLY",
      "evidenceQuote": "<verbatim Thai or English from PDF>"
    }
  ],
  "assessmentMethods": [
    {
      "method": "WRITTEN_EXAM" | "OSCE" | "PRACTICAL_EXAM" | "PROJECT_DEFENCE" | "THESIS_DEFENCE" | "CAPSTONE_DEFENCE" | "PORTFOLIO" | "PRESENTATION" | "PEER_REVIEW" | "CONTINUOUS_ASSESSMENT" | "INTERNSHIP_REPORT" | "CLINICAL_LOG" | "PUBLICATION_REQUIREMENT" | "OTHER",
      "prominence": "CORE" | "SIGNIFICANT" | "MINOR" | "MENTIONED_ONLY",
      "evidenceQuote": "<verbatim from PDF>"
    }
  ],
  "industrialEngagement": {
    "internshipPresent": true | false,
    "internshipDurationMonths": <number or null>,
    "industryAdvisoryBoard": true | false,
    "capstoneWithIndustry": true | false,
    "evidenceQuotes": ["<quote>", "<quote>"]
  },
  "qaSystem": {
    "framework": "TQF" | "AUN_QA" | "EdPEx" | "ABET" | "CDIO" | "WFME" | "NONE_DESCRIBED" | "OTHER",
    "continuousImprovementEvidence": ["<quote>", "<quote>"],
    "stakeholderFeedbackLoops": ["<short description>", "<short description>"],
    "score": 0-100
  },
  "disciplineFitScore": 0-100,
  "disciplineExpectedMethods": ["<expected method 1>", "<expected method 2>", "<expected method 3>"],
  "gaps": [
    { "area": "<short area>", "severity": "major" | "moderate" | "minor", "observation": "<what's missing>", "recommendation": "<what to do>" }
  ],
  "overallScore": 0-100,
  "confidence": 0.0-1.0,
  "narrativeTh": "<2-3 sentence Council brief in Thai>",
  "narrativeEn": "<2-3 sentence Council brief in English (parallel to Thai)>"
}

WORKED EXAMPLE — for a Bachelor of Engineering in Mechanical Engineering whose PDF describes project-based courses + a 4-month industrial internship + capstone + TQF + industry advisory:

{
  "pedagogicalApproaches": [
    {"method":"PROJECT_BASED","prominence":"CORE","evidenceQuote":"การเรียนการสอนเน้นโครงงาน (Project-based learning) ในทุกชั้นปี"},
    {"method":"INTERNSHIP","prominence":"CORE","evidenceQuote":"สหกิจศึกษา 4 เดือน ภาคการศึกษาปลายของชั้นปีที่ 4"},
    {"method":"CAPSTONE","prominence":"CORE","evidenceQuote":"โครงงานวิศวกรรมเครื่องกล (Senior Project)"},
    {"method":"LAB_INTENSIVE","prominence":"SIGNIFICANT","evidenceQuote":"ปฏิบัติการในห้องปฏิบัติการเครื่องกล"}
  ],
  "assessmentMethods": [
    {"method":"PROJECT_DEFENCE","prominence":"CORE","evidenceQuote":"การนำเสนอและสอบโครงงาน"},
    {"method":"INTERNSHIP_REPORT","prominence":"CORE","evidenceQuote":"รายงานสหกิจศึกษา"},
    {"method":"WRITTEN_EXAM","prominence":"SIGNIFICANT","evidenceQuote":"การสอบกลางภาคและปลายภาค"}
  ],
  "industrialEngagement": {
    "internshipPresent": true,
    "internshipDurationMonths": 4,
    "industryAdvisoryBoard": true,
    "capstoneWithIndustry": false,
    "evidenceQuotes": ["สหกิจศึกษา 4 เดือน","กรรมการที่ปรึกษาภาคอุตสาหกรรม"]
  },
  "qaSystem": {
    "framework": "TQF",
    "continuousImprovementEvidence": ["ทบทวนหลักสูตรทุก 5 ปี","ผลประเมินจากนักศึกษานำมาปรับ มคอ.5"],
    "stakeholderFeedbackLoops": ["ผู้ใช้บัณฑิตปีละครั้ง","ศิษย์เก่า 2 ปีครั้ง","นักศึกษาทุกภาคการศึกษา"],
    "score": 80
  },
  "disciplineFitScore": 85,
  "disciplineExpectedMethods": ["Project-based learning","Industrial internship ≥ 4 months","Capstone design","Hands-on labs","CDIO/ABET-aligned outcomes"],
  "gaps": [
    {"area":"CDIO/ABET alignment","severity":"moderate","observation":"PDF doesn't explicitly state CDIO or ABET alignment","recommendation":"Adopt CDIO framework with explicit Conceive-Design-Implement-Operate stages in capstone"}
  ],
  "overallScore": 80,
  "confidence": 0.9,
  "narrativeTh": "หลักสูตรมีรูปแบบสอนสอดคล้องกับมาตรฐานวิศวกรรมระดับนานาชาติ มีโครงงาน สหกิจศึกษา 4 เดือน และระบบ TQF ที่ทำงานได้จริง ข้อเสนอแนะ: ระบุการสอดคล้องกับ CDIO/ABET อย่างชัดเจน",
  "narrativeEn": "Program teaching pattern matches international engineering standards with project-based learning, 4-month industrial internship, and a functioning TQF QA system. Recommendation: explicitly align with CDIO/ABET frameworks."
}`;
}

export function buildProgramPedagogyMessages(
  input: BuildProgramPedagogyMessagesInput,
): AiMessage[] {
  const { program, pdfText } = input;
  const departmentLine = program.departmentNameTh
    ? `Department: ${program.departmentNameTh}`
    : 'Department: (not specified)';
  const durationLine = program.durationYears
    ? `${program.durationYears}-year programme`
    : '(duration not specified)';

  const userPrompt = `Assess the pedagogical readiness of this program.

PROGRAM IDENTITY:
- Code: (passed at the orchestration layer)
- Name (Thai): ${program.nameTh}
- Name (English): ${program.nameEn}
- Level: ${program.level}
- Faculty: ${program.facultyNameTh} / ${program.facultyNameEn}
- ${departmentLine}
- ${durationLine}

CURRICULUM PDF TEXT:
<pdf>
${pdfText}
</pdf>

Now produce the ProgramPedagogyAssessment JSON. Apply the discipline rubric above based on the Faculty + level. Score what you OBSERVE in the PDF against what you EXPECT for this discipline.`;

  return [
    { role: 'system', content: systemPrompt() },
    { role: 'user', content: userPrompt },
  ];
}
