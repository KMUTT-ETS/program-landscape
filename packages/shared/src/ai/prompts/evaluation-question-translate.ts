import { z } from 'zod';
import type { AiMessage } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// evaluation-question-translate.v1  (2026-05-19)
//
// Translate KKU student-evaluation questionnaire items (POWERBI
// EVALUATE_INSTRUCTOR) from Thai → English. The Thai source is the
// authoritative wording; the AI translation is a courtesy convenience
// (UI watermark: "(EN — AI translation, pending review)"). DEAN / ADMIN
// can override per row via `questionTextEnOverride`.
//
// One call per batch of questions — typical batch is the full 40-question
// catalog, ~3K tokens in / ~5K out. Single Gemini call, cheap.
// ─────────────────────────────────────────────────────────────────────────────

export const EVALUATION_QUESTION_TRANSLATE_VERSION = 'evaluation-question-translate.v1';

const ItemSchema = z.object({
  /** registrar's QUESTIONID (e.g., "01", "27", "37") — used to match
   *  the response back to the input row by `EvaluationQuestion.id`. */
  questionIdRegistrar: z.string(),
  /** Translated English text. Concise; same plain register as the Thai
   *  source (educational evaluation tone, not marketing). */
  questionTextEn: z.string().min(3),
});
export type EvaluationQuestionTranslation = z.infer<typeof ItemSchema>;

export const EvaluationQuestionTranslateSchema = z.object({
  translations: z.array(ItemSchema),
  caveats: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
});
export type EvaluationQuestionTranslatePayload = z.infer<
  typeof EvaluationQuestionTranslateSchema
>;

export interface EvaluationQuestionTranslateInput {
  questions: Array<{
    questionIdRegistrar: string;
    questionTextTh: string;
    themeTag: string | null;
  }>;
}

export function buildEvaluationQuestionTranslateMessages(
  input: EvaluationQuestionTranslateInput,
): AiMessage[] {
  const system = `You translate Thai-language student-evaluation prompts into clear
English. The source is a real questionnaire used by Khon Kaen University
to evaluate teaching & learning. Translations are read by international
faculty, ASEAN partner universities, and visiting Council members.

Constraints:
- Translate the MEANING, not word-for-word. Aim for ~10-25 English words.
- Use neutral educational-evaluation register (not marketing, not academic
  jargon). Examples of register: "The instructor encouraged questions",
  "Assessment criteria were clearly communicated".
- Preserve the SUBJECT of the prompt: some prompts evaluate the instructor
  ("ผู้สอน…"), others ask about the student's own perceived progress
  ("นักศึกษามี…", "ความสามารถของข้าพเจ้า…"), and a few rate the course
  content ("เนื้อหา…"). Keep the subject consistent.
- "นักศึกษา" → "students" (in the prompts that describe what happened in
  class) OR "I/me" (in the prompts that ask the respondent about their
  own learning gains — typically the English-skills set, IDs 33+).
- Don't add new content. If the Thai is ambiguous, mirror that ambiguity.
- Don't introduce values or judgments not in the Thai.

Output strict JSON only. No markdown, no preface. Schema:
{
  "translations": [
    { "questionIdRegistrar": "<id>", "questionTextEn": "<English>" }
  ],
  "caveats": ["<anything ambiguous, untranslatable, or worth flagging>"],
  "confidence": <0.0-1.0>
}

Confidence:
- 0.9+ when all prompts have a clear subject + clear meaning
- 0.7-0.85 when 1-3 prompts are ambiguous (likely registrar typos)
- 0.4-0.6 when many prompts are duplicates with drift (registrar has
  some QIDs sharing identical text — translate each separately anyway).`;

  const userBody = input.questions
    .map(
      (q) =>
        `QID=${q.questionIdRegistrar}  theme=${q.themeTag ?? 'untagged'}\n${q.questionTextTh}`,
    )
    .join('\n\n');

  return [
    { role: 'system', content: system },
    {
      role: 'user',
      content: `Translate every question below. Preserve the exact questionIdRegistrar value in the output.\n\n${userBody}\n\nOutput JSON only.`,
    },
  ];
}
