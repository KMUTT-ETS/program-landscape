import { z } from 'zod';
import type { AiMessage } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Job-field taxonomy — clusters the free-text "field of study" strings JobThai
// employers write ("วุฒิปริญญาตรี สาขาบัญชี", "Accounting", "บัญชี/การเงิน")
// into canonical fields with Thai + English names, each absorbing its raw
// strings as synonyms. Existing APPROVED fields are passed as ANCHORS so new
// strings attach to them instead of duplicating.
//
// Used by apps/ingestion/src/jobthai/fields.ts (pnpm jobthai:fields, and the
// end of every JobThai batch refresh). Rows land in job_field_taxonomy with
// reviewStatus PROPOSED and are reviewed at /admin/job-fields.
//
// Batched at 200 raw strings per call (518 strings cleared the 5-mention floor
// on 2026-09-15, so the first run is three calls; later runs see only strings
// no synonym list absorbs, usually zero). New fields from one batch become
// anchors for the next, which is what keeps a discipline from being created
// twice across batches.
//
// Version-bumping rule: any change to the system prompt, output schema or
// clustering rules = bump VERSION. JobFieldTaxonomy.methodVersion records it.
// ─────────────────────────────────────────────────────────────────────────────

export const JOB_FIELD_TAXONOMY_VERSION = 'job-field-taxonomy.v1';
export const JOB_FIELD_TAXONOMY_BATCH_MAX = 200;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const JobFieldTaxonomyOutputSchema = z.object({
  newFields: z.array(
    z.object({
      slug: z.string().regex(SLUG),
      nameTh: z.string().min(1),
      nameEn: z.string().min(1),
    }),
  ),
  /** Every raw string in the input, exactly once, attached to an anchor slug or a new slug. */
  assignments: z.array(z.object({ raw: z.string().min(1), fieldSlug: z.string().regex(SLUG) })),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().max(600),
});
export type JobFieldTaxonomyOutput = z.infer<typeof JobFieldTaxonomyOutputSchema>;

export interface JobFieldTaxonomyInput {
  rawStrings: Array<{ raw: string; mentions: number }>;
  anchors: Array<{ slug: string; nameTh: string; nameEn: string; synonyms: string[] }>;
}

export function buildJobFieldTaxonomyMessages(input: JobFieldTaxonomyInput): AiMessage[] {
  if (input.rawStrings.length === 0) throw new Error('Empty rawStrings batch');
  if (input.rawStrings.length > JOB_FIELD_TAXONOMY_BATCH_MAX) {
    throw new Error(`Batch too large: ${input.rawStrings.length} > ${JOB_FIELD_TAXONOMY_BATCH_MAX} (split before calling)`);
  }

  const system = `You organise the "field of study" strings that Thai employers write in job adverts into a taxonomy of canonical fields of study, the way a university registrar would name disciplines.

Input: raw strings with how many adverts mention each, plus ANCHORS — canonical fields that already exist, with the strings they already absorb.

For EACH raw string, attach it to exactly one field: an anchor slug, or a slug you create in newFields. Create a new field only when no anchor names the same discipline.

Output STRICT JSON (no prose, no markdown fences):
{
  "newFields": [ { "slug": "kebab-case-english", "nameTh": "<Thai discipline name>", "nameEn": "<English discipline name>" } ],
  "assignments": [ { "raw": "<raw string verbatim>", "fieldSlug": "<anchor slug or new slug>" } ],
  "confidence": 0.0-1.0,
  "reasoning": "<≤600 chars, English>"
}

Rules:
1. EVERY raw string in the input MUST appear in assignments exactly once, verbatim.
2. A field is a DISCIPLINE a graduate holds (Accounting, Electrical engineering, Nursing, Logistics), not a job title and not a skill. "บัญชี", "การบัญชี", "Accounting", "บัญชี/การเงิน" are ONE field; "การเงิน" alone is Finance, a different field.
3. Prefer anchors. Attach to an anchor whenever the raw string names the same discipline or a sub-discipline of it; create a new field only for a discipline no anchor covers.
4. Granularity: a field should be recognisable as a degree major. Do not split Electrical engineering into power vs electronics; do not merge Marketing into Business administration.
5. Slugs: lowercase English kebab-case, stable and readable ("mechanical-engineering", "public-health"). Never reuse an anchor slug in newFields.
6. nameTh and nameEn are data labels: nameTh in Thai, nameEn in English. Thai strings with no natural English name get a transliteration in nameEn.
7. LANGUAGE RULE (English-only free text): \`reasoning\` MUST be written in English. \`nameTh\` stays Thai; \`raw\` is preserved verbatim regardless of language.

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

  const anchorsBlock =
    input.anchors.length === 0
      ? '(none yet — this is the first batch)'
      : input.anchors
          .map((a) => `${a.slug}: ${a.nameEn} / ${a.nameTh} — absorbs: ${a.synonyms.join(' | ')}`)
          .join('\n');
  const rawBlock = input.rawStrings.map((r, i) => `${i + 1}. ${r.raw}  (${r.mentions} adverts)`).join('\n');

  const user = `[Anchors] (slug: nameEn / nameTh — absorbs: raw strings)
${anchorsBlock}

[Raw strings to attach] (${input.rawStrings.length} strings)
${rawBlock}

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
//   - rawStrings — job_postings.required_fields_raw values with ≥ 5 mentions
//     that no existing synonym list absorbs, with mention counts so the model
//     weighs a common string more carefully than a rare one.
//   - anchors — every non-REJECTED job_field_taxonomy row (slug, names,
//     synonyms). THE closed-world set the model attaches to before creating.
//
// Deliberately omitted, with reason:
//   - strings below the 5-mention floor — the "other" bucket; counted in
//     denominators, never assigned, so never sent.
//   - the '*ANY*' sentinel — "any field" is its own line on the map, not a
//     discipline.
//   - programme names — the taxonomy describes demand; programme assignment
//     is a separate prompt (program-job-field) so demand vocabulary is not
//     bent toward what KKU happens to teach.
// ─────────────────────────────────────────────────────────────────────────────
