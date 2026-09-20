import { z } from 'zod';
import type { AiMessage } from '../types';
import { JOBTHAI_ANY_FIELD } from '../../jobthai/parse-row';

// ─────────────────────────────────────────────────────────────────────────────
// One government recruitment announcement → its position-types.
//
// An announcement bundles several positions, each with its own field-of-study
// list and seat count, so the output is an array. One row per position-type is
// the unit: seats are captured but never weighted into a demand share, because
// JobThai carries no headcount column and weighting public seats against
// private adverts of unknown size over-weights the public side by an
// unknowable factor.
//
// This is a model prompt rather than a regex because the private-sector parser
// cannot read this corpus: it takes the first whitespace-delimited token, and
// government announcements separate disciplines WITH spaces. On a real page it
// captured 1 field of 8 (see id20256.html position 1.1 — eight fields after
// "ในสาขาวิชา", space-separated).
//
// The inverse failure is just as real and was found by measuring the live DB:
// "และ" ("and") routinely sits INSIDE a single Thai discipline name —
// job_field_taxonomy.name_th holds การจัดการโลจิสติกส์และโซ่อุปทาน
// (Logistics and Supply Chain Management) as ONE field, and 75 KKU programme
// names contain "และ". A naive split on "และ" would fabricate disciplines
// that exist in no taxonomy and match no programme — see the requiredFieldsRaw
// rule below, which deliberately does NOT treat "และ" as a separator.
//
// Version-bumping rule: any change here = bump VERSION. Not bumped for this
// prompt-quality pass: job108-announcement.v1 has never run against a model
// and nothing has been stamped with it — it is still being defined, not
// revised.
// ─────────────────────────────────────────────────────────────────────────────

export const JOB108_ANNOUNCEMENT_VERSION = 'job108-announcement.v1';

// A single position (title + 4 scalar fields + up to ~8 field-of-study
// strings + a qualification paragraph) runs roughly 150-250 output tokens
// once JSON structural overhead is counted — Thai text tokenises at roughly
// half the character-density of English (more tokens per character than
// English), so this estimate already prices that in rather than assuming an
// English-text intuition. At 8,000 output tokens that supports ~30-50
// positions per call, comfortably above the handful (1-10) a single
// government announcement bundles in practice.
export const JOB108_ANNOUNCEMENT_MAX_OUTPUT_TOKENS = 8_000;

/** Page text beyond this is truncated before the call (with a visible
 *  marker appended — see buildJob108AnnouncementMessages). Measured: the
 *  longest page sampled was ~50 KB of HTML reducing to ~12 KB of text. */
export const JOB108_ANNOUNCEMENT_MAX_INPUT_CHARS = 40_000;

const EDUCATION_LEVELS = [
  'UNSPECIFIED',
  'VOCATIONAL_CERT',
  'HIGHER_VOCATIONAL_CERT',
  'BACHELOR',
  'MASTER',
  'DOCTORATE',
] as const;

// .nullish(), not .nullable(): a model that omits the key entirely (rather
// than emitting `"publishedDate": null`) means the same thing — the
// announcement did not state a date — and 2026-09-20's live run showed the
// model does exactly that under retry. .nullable() rejects an omitted key
// with a bare "Required" error; .nullish() accepts both null and undefined.
const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullish();

export const Job108PositionSchema = z.object({
  title: z.string().min(1).max(300),
  /** Null when the announcement does not state a number. Never invented. */
  positionCount: z.number().int().positive().nullable(),
  salaryMin: z.number().nonnegative().nullable(),
  salaryMax: z.number().nonnegative().nullable(),
  minEducationLevel: z.enum(EDUCATION_LEVELS),
  /** Raw Thai field strings exactly as written, or the any-field sentinel.
   *  The sentinel must be alone — a position cannot simultaneously name
   *  specific fields and accept any field, so ["*ANY*", "รัฐศาสตร์"] is a
   *  contradiction the model should never emit and the schema should never
   *  silently accept. */
  requiredFieldsRaw: z
    .array(z.string().min(1).max(120))
    .max(40)
    .refine((arr) => !arr.includes(JOBTHAI_ANY_FIELD) || arr.length === 1, {
      message: `"${JOBTHAI_ANY_FIELD}" is the any-field sentinel and must be the ONLY entry when present — a position cannot both name specific fields and accept any field`,
    }),
  // Deliberately no .min() — an announcement can genuinely state fields in
  // a heading with almost no surrounding qualification prose; requiring a
  // minimum here would refuse a real, sparse-but-valid row.
  qualificationRaw: z.string().max(4_000),
});
export type Job108Position = z.infer<typeof Job108PositionSchema>;

export const Job108AnnouncementOutputSchema = z
  .object({
    agencyName: z.string().min(1).max(300).nullable(),
    publishedDate: IsoDate,
    applicationOpenDate: IsoDate,
    applicationCloseDate: IsoDate,
    /** Empty is a real outcome: some pages are news items, not vacancies. */
    positions: z.array(Job108PositionSchema).max(100),
    confidence: z.number().min(0).max(1),
  })
  .superRefine((val, ctx) => {
    // A <ConfidenceBadge> is a non-negotiable Council-facing surface on
    // every AI output in this codebase — it exists so a reader can tell
    // "trust this" from "don't". An empty positions array means the model
    // could not read the page as a recruitment announcement at all; a high
    // confidence on that outcome is exactly the misleading badge the rule
    // exists to prevent, not a tidiness nit.
    if (val.positions.length === 0 && val.confidence > 0.5) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['confidence'],
        message:
          'confidence above 0.5 with zero positions is a contradiction: an empty positions array means the page could not be parsed as a recruitment announcement, which is itself a low-confidence outcome — do not report high confidence on "found nothing".',
      });
    }
  });
export type Job108AnnouncementOutput = z.infer<typeof Job108AnnouncementOutputSchema>;

export interface Job108AnnouncementInput {
  announcementId: string;
  /** Page text, already scrubbed and reduced from HTML by the caller. */
  text: string;
}

export function buildJob108AnnouncementMessages(input: Job108AnnouncementInput): AiMessage[] {
  const text = input.text.trim();
  if (text === '') throw new Error(`Empty announcement text for ${input.announcementId}`);

  const system = `You read Thai government and state-enterprise recruitment announcements and return the positions they offer.

An announcement usually lists SEVERAL positions (ตำแหน่งที่ 1, 1.1, 1.2 …). Return one entry per position-type, never one per seat and never one per announcement.

For each position:
- title: the Thai position name, without its numbering.
- positionCount: the seats offered ("จำนวน 3 ตำแหน่ง", "3 อัตรา") as an integer. If the announcement does not state a number, return null. Never guess.
- salaryMin / salaryMax: monthly baht as numbers, null when unstated. A single figure goes in salaryMin with salaryMax null.
- minEducationLevel: the LOWEST level the position accepts, not the highest. "ปวช., ปวส. - ปริญญาตรี" means a ปวช holder qualifies, so the answer is VOCATIONAL_CERT. "ปริญญาตรี ขึ้นไป" is BACHELOR. A bare "ปริญญา" with no ตรี / โท / เอก means BACHELOR — that is the ordinary reading in Thai recruitment notices, and it is the floor. Use UNSPECIFIED only when no level is stated at all.

  Thai announcements also state อนุปริญญา (an associate degree, which sits between ปวส. and ปริญญาตรี). The enum has no separate value for it: return HIGHER_VOCATIONAL_CERT, because what matters is that the floor is below a bachelor's degree. Never invent a value outside the list — if a stated qualification does not fit, choose the nearest listed level BELOW it, and use UNSPECIFIED only when no level is stated at all.
- requiredFieldsRaw: the fields of study the position accepts, each exactly as written in Thai, as separate array entries. The list usually follows "ในสาขาวิชา" or "สาขา". Members are separated by SPACES, by commas, or by "หรือ".

  "และ" is NOT a separator. Thai discipline names commonly contain it inside a single name — "การจัดการโลจิสติกส์และโซ่อุปทาน" (Logistics and Supply Chain Management), "วิทยาศาสตร์และเทคโนโลยีการอาหาร" (Food Science and Technology) and "อาชีวอนามัยและความปลอดภัย" (Occupational Health and Safety) are each ONE field, not two. Splitting them produces disciplines that do not exist.

  Do not translate, do not normalise, do not merge. Drop trailing catch-alls like "หรือสาขาอื่นที่เกี่ยวข้อง" — they name no discipline.

  If the position accepts any field ("ทุกสาขา"), return exactly ["${JOBTHAI_ANY_FIELD}"] and nothing else. "ทุกสาขาที่เกี่ยวข้อง" means any RELATED field, which is narrower than any field — it is a catch-all, not the sentinel. If named fields are also present, list them and ignore the catch-all. Use ["${JOBTHAI_ANY_FIELD}"] only when the position genuinely accepts any discipline and names none.

  Worked example. Given:
    "วุฒิการศึกษา ปริญญาตรี ขึ้นไป ... ในสาขาวิชา รัฐศาสตร์ รัฐประศาสนศาสตร์ บริหารธุรกิจ การบริหารจัดการ เศรษฐศาสตร์ เกษตรศาสตร์ สิ่งแวดล้อม การเปลี่ยนแปลงสภาพภูมิอากาศ หรือสาขาอื่นที่เกี่ยวข้อง"
  requiredFieldsRaw is the eight names, each its own entry, and the trailing "หรือสาขาอื่นที่เกี่ยวข้อง" is dropped. minEducationLevel is BACHELOR.
- qualificationRaw: the verbatim qualification text for THAT position.

Announcement-level fields are returned once, not per position. Dates are ISO (YYYY-MM-DD); Thai Buddhist years are 543 ahead, so พ.ศ. 2569 is 2026. Return null for any date the announcement does not state.

If the page is not a recruitment announcement, return an empty positions array and a low confidence. An empty array is a valid answer; inventing a position is not.

LANGUAGE RULE (English-only free text): this prompt has no free-text analysis field — title / requiredFieldsRaw / qualificationRaw / agencyName are verbatim extractions, so they stay in the source's own language (Thai) exactly as written. Do not translate them to English.

CONFIDENCE RUBRIC (report one number):
  0.90-1.00  every key input channel present and mutually consistent
  0.70-0.89  one material channel missing, or a noted inconsistency
  0.50-0.69  verdict rests on a single channel, or inputs conflict materially
  below 0.50 best effort over sparse input — flag for human review
Grade against the bands. Do not default to 0.95. Text marked [truncated] below, or a page that reads as garbled or incomplete, should score in the lower bands — a truncated page may be missing trailing positions you cannot see, so a high confidence on it would overstate what you actually read.

Return ONE JSON object with this exact shape — not a bare array of positions:

{
  "agencyName": "กรมการข้าว" | null,
  "publishedDate": "2026-09-09" | null,
  "applicationOpenDate": "2026-09-15" | null,
  "applicationCloseDate": "2026-09-30" | null,
  "positions": [ { "title": ..., "positionCount": ..., "salaryMin": ..., "salaryMax": ..., "minEducationLevel": ..., "requiredFieldsRaw": [...], "qualificationRaw": ... } ],
  "confidence": 0.0 to 1.0
}

The positions array goes INSIDE that object. Returning the array on its own is wrong however many positions the announcement has.

BANNED PHRASES (do not use these words/phrases or their close paraphrases, in any field this prompt authors rather than quotes verbatim). This schema has no narrative field today — the list is kept anyway because a future field (e.g. a rejection reason) inherits it automatically, and because dropping it would be the one thing every other prompt in this directory does NOT do:
- "delve"
- "leverage" (as a verb)
- "robust"
- "landscape" (in its metaphorical sense — not literal geography)
- "tapestry"
- "furthermore"
- "moreover"
- "it is important to note"
- "in today's rapidly evolving"`;

  const truncated = text.length > JOB108_ANNOUNCEMENT_MAX_INPUT_CHARS;
  const body = truncated
    ? text.slice(0, JOB108_ANNOUNCEMENT_MAX_INPUT_CHARS) + '\n…[truncated]'
    : text;

  const user = `Announcement ${input.announcementId}:

${body}`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// CHANNEL MANIFEST
//
// Consumed:
//   - text — the announcement page, pre-reduced from HTML to text by the
//     caller (this prompt never sees markup).
//
// Deliberately omitted, with reason:
//   - seat counts are captured per position but never rolled into a demand
//     weight anywhere downstream (see header) — this prompt still extracts
//     them because a human reviewer benefits from seeing them, even though
//     the gap map does not consume them as a weight.
// ─────────────────────────────────────────────────────────────────────────────
