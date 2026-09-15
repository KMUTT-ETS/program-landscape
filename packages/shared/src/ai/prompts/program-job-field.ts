import { z } from 'zod';
import type { AiMessage } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Programme → job-field assignment. Given the canonical field vocabulary
// (job-field-taxonomy) and a programme's names, level and taught skills,
// returns up to three fields whose graduates this programme produces.
//
// Runs AFTER the name-match rule (matchFieldToProgramme in jobthai-bridge):
// programmes the rule already assigned are not sent, so the model only
// decides the remainder. Batched at 50 programmes per call.
//
// Version-bumping rule: any change here = bump VERSION;
// ProgramJobField.methodVersion records it.
// ─────────────────────────────────────────────────────────────────────────────

export const PROGRAM_JOB_FIELD_VERSION = 'program-job-field.v1';
export const PROGRAM_JOB_FIELD_BATCH_MAX = 50;
export const PROGRAM_JOB_FIELD_MAX_FIELDS = 3;
// 50 programmes × ≤3 fields ≈ 2-3k tokens.
export const PROGRAM_JOB_FIELD_MAX_OUTPUT_TOKENS = 8_000;

export const ProgramJobFieldOutputSchema = z.object({
  programs: z.array(
    z.object({
      programId: z.string().min(1),
      fields: z
        .array(z.object({ slug: z.string().min(1), confidence: z.number().min(0).max(1) }))
        .max(PROGRAM_JOB_FIELD_MAX_FIELDS),
    }),
  ),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().transform((s) => s.slice(0, 600)),
});
export type ProgramJobFieldOutput = z.infer<typeof ProgramJobFieldOutputSchema>;

export interface ProgramJobFieldInput {
  programs: Array<{
    id: string;
    code: string;
    nameTh: string;
    nameEn: string;
    level: string;
    skills: string[];
  }>;
  fields: Array<{ slug: string; nameTh: string; nameEn: string }>;
}

export function buildProgramJobFieldMessages(input: ProgramJobFieldInput): AiMessage[] {
  if (input.programs.length === 0) throw new Error('Empty programs batch');
  if (input.programs.length > PROGRAM_JOB_FIELD_BATCH_MAX) {
    throw new Error(`Batch too large: ${input.programs.length} > ${PROGRAM_JOB_FIELD_BATCH_MAX} (split before calling)`);
  }

  const system = `You decide which fields of study a university programme's graduates hold, using a closed vocabulary of fields taken from employer job adverts.

For EACH programme, return up to ${PROGRAM_JOB_FIELD_MAX_FIELDS} field slugs from the vocabulary, with a confidence each. Return an empty list when no field in the vocabulary fits — an empty list is a valid, honest answer.

Output STRICT JSON (no prose, no markdown fences):
{
  "programs": [ { "programId": "<id>", "fields": [ { "slug": "<vocabulary slug>", "confidence": 0.0-1.0 } ] } ],
  "confidence": 0.0-1.0,
  "reasoning": "<≤600 chars, English>"
}

Rules:
1. EVERY programme in the input MUST appear in programs exactly once, by its id.
2. Only slugs from the vocabulary. Never invent a slug.
3. The FIRST field is the programme's own discipline (its degree name). Add a second or third only when employers would genuinely accept this graduate as holding that field too (a Mechatronics graduate holds Mechanical AND Electrical engineering; a Nursing graduate does not hold Public health).
4. Level matters only for naming: a Master's in Accounting still holds Accounting. Do not withhold a field because the programme is postgraduate.
5. Skills are a hint, not the decision: a programme teaching Python is not thereby Computer science.
6. LANGUAGE RULE (English-only free text): \`reasoning\` MUST be written in English; ids and slugs are preserved verbatim.

CONFIDENCE RUBRIC (report one number):
  0.90-1.00  every key input channel present and mutually consistent
  0.70-0.89  one material channel missing, or a noted inconsistency
  0.50-0.69  verdict rests on a single channel, or inputs conflict materially
  below 0.50 best effort over sparse input — flag for human review
Grade against the bands. Do not default to 0.95.

BANNED PHRASES (do not use these words/phrases or their close paraphrases in reasoning):
- "delve"
- "leverage" (as a verb)
- "robust"
- "landscape" (in its metaphorical sense — not literal geography)
- "tapestry"
- "furthermore"
- "moreover"
- "it is important to note"
- "in today's rapidly evolving"`;

  const fieldsBlock = input.fields.map((f) => `${f.slug}: ${f.nameEn} / ${f.nameTh}`).join('\n');
  const programsBlock = input.programs
    .map(
      (p) =>
        `- id=${p.id} code=${p.code} level=${p.level}\n  ${p.nameEn} / ${p.nameTh}\n  skills: ${p.skills.length ? p.skills.join(', ') : '(none extracted)'}`,
    )
    .join('\n');

  const user = `[Field vocabulary] (slug: nameEn / nameTh)
${fieldsBlock || '(empty)'}

[Programmes] (${input.programs.length})
${programsBlock}

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
//   - fields — every non-REJECTED job_field_taxonomy row. THE closed-world
//     label set (a slug outside it is dropped by the caller).
//   - programs — id, code, nameTh, nameEn, level, and the programme's
//     ProgramSkill names (hint only, rule 5).
//
// Deliberately omitted, with reason:
//   - programmes already assigned by the name-match rule or APPROVED by an
//     admin — decided; not re-sent.
//   - graduates / enrolment / health — supply and health are computed by the
//     map, and the assignment must not depend on how big a programme is.
// ─────────────────────────────────────────────────────────────────────────────
