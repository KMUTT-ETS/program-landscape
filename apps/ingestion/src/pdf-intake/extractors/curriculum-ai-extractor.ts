import { z } from 'zod';
import type {
  ExtractionRecord,
  PdfContext,
  PdfExtractor,
  PdfSourceCategory,
} from '@kku/shared';
import { CurriculumHeuristicExtractor } from './curriculum-extractor';

// ─────────────────────────────────────────────────────────────────────────
// AI-backed curriculum extractor — Gemini reads Section 1 of a Thai มคอ.2
// PDF and returns the header fields as structured JSON.
//
// Why we need LLM extraction for Thai PDFs:
//   pdfjs-dist sometimes drops combining tone marks and substitutes
//   Private-Use-Area codepoints for certain embedded-font glyphs. The
//   regex heuristic can recover most fields but the *Thai text itself*
//   comes back without diacritics ("เกษตรศาสตร" instead of
//   "เกษตรศาสตร์"). An LLM fed the same degraded input can restore
//   conventional spelling from context, producing clean display text.
//
// Fallback: when no AiService is available (no GOOGLE_AI_API_KEY), or
// when the LLM call errors, delegate to the heuristic extractor so
// intake never fails the PDF solely on AI availability.
// ─────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an information extraction engine for Thai curriculum documents (มคอ.2 / TQF).
You receive the full text of Section 1 "ข้อมูลทั่วไป" of a KKU program specification, extracted from a PDF.
The input text may be noisy: combining tone marks dropped, Private-Use-Area codepoints, extra spaces inside digit strings ("25 6 5" for "2565"), Thai words split mid-syllable.

Your job: return a single JSON object matching the provided schema exactly, with Thai spelled conventionally (restore any missing ้ ่ ์ ํ tone marks you are confident about from Thai-language context).

Types (strict):
- All year fields (curriculumYear, openingYear, previousCurriculumYearBE) MUST be JSON numbers (integers), not strings. Example: 2565 not "2565".
- openingSemester: JSON number, one of 1, 2, 3.
- totalCredits: a single JSON number. When the document lists multiple plan-specific credit totals (e.g. doctoral "แบบ 1.1 48 หน่วยกิต / แบบ 2.2 80 หน่วยกิต"), return the largest.
- durationYears: a single JSON number (undergrad only).

Enums (use the exact ENGLISH CODE, not the Thai phrase):
- level: "BACHELOR" | "MASTER" | "DOCTORAL"
- language: "TH" | "EN" | "MIXED"
- admissionScope: "TH_ONLY" | "TH_AND_INTL" | "INTL_ONLY"
- approvalHistory[].body: one of —
    "FACULTY_COMMITTEE"     — คณะกรรมการประจำคณะ (any faculty)
    "UNIVERSITY_SCREENING"  — (คณะกรรมการ)กลั่นกรองหลักสูตร
    "ACADEMIC_COUNCIL"      — สภาวิชาการ
    "UNIVERSITY_COUNCIL"    — สภามหาวิทยาลัย
    "GRADUATE_SCHOOL"       — บัณฑิตวิทยาลัย
    "OTHER"                 — anything else
  NEVER return a Thai phrase for body — map to the enum code first.

Other rules:
- If a field is not clearly stated in the text, set it to null (or omit optional fields entirely).
- DO NOT invent information. If the curriculum year isn't stated, return null.
- For Thai strings, restore proper spelling (degree names, faculty name, program name, majors, careers) with tone marks.
- For English strings, keep the document's capitalisation.
- "majors" is the list of วิชาเอก (specialisation tracks). Empty array when the program has none or lists "ไม่มี".
- "programPlans" is the list of program plans — "แผน ก แบบ ก1", "แบบ 1.1" etc. Empty for undergrad programs.
- "curriculumYear" is the Thai Buddhist-Era year (พ.ศ.) from "หลักสูตรปรับปรุง พ.ศ. 25XX" on the cover.
- "approvalHistory" is the chain of committees that approved the curriculum (Section 1.6). Each entry has body (enum code — see above), meetingNo ("2/2565"), meetingDate (ISO-style "YYYY-MM-DD" when convertible, otherwise the raw Thai date string).
- "careersTh" is the parsed list of career paths from Section 1.8. Split "เช่น ก, ข, ค" into individual entries. Drop boilerplate prefix like "สามารถประกอบอาชีพ...".
`;

// Coerce a string | object | array back to a single string — Gemini
// occasionally returns { th: "...", en: "..." } or nested objects for
// string-type fields; we take the first string leaf.
function toStringLeaf(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (v === null || v === undefined) return undefined;
  if (Array.isArray(v)) {
    for (const e of v) {
      const s = toStringLeaf(e);
      if (s) return s;
    }
    return undefined;
  }
  if (typeof v === 'object') {
    // Prefer 'th' key for Thai fields, else first string value.
    const o = v as Record<string, unknown>;
    if (typeof o.th === 'string') return o.th;
    if (typeof o.en === 'string') return o.en;
    for (const val of Object.values(o)) {
      const s = toStringLeaf(val);
      if (s) return s;
    }
  }
  return undefined;
}

const nullableString = z.preprocess((v) => toStringLeaf(v), z.string().optional());
const nullableStringArray = z.preprocess(
  (v) => {
    if (v === null || v === undefined) return [];
    if (Array.isArray(v)) return v.map((e) => toStringLeaf(e)).filter(Boolean);
    const one = toStringLeaf(v);
    return one ? [one] : [];
  },
  z.array(z.string()).default([]),
);

// Permissive schema — everything optional so a partial extraction still
// validates. Uses z.preprocess where Gemini commonly returns strings for
// numbers or uses Thai phrases where we want enum codes.
const APPROVAL_BODY_CODES = [
  'FACULTY_COMMITTEE',
  'UNIVERSITY_SCREENING',
  'ACADEMIC_COUNCIL',
  'UNIVERSITY_COUNCIL',
  'GRADUATE_SCHOOL',
  'OTHER',
] as const;

// Thai-phrase → enum mapping. Partial keyword match — Gemini may include
// the specific faculty name (e.g. "คณะกรรมการประจำคณะเกษตรศาสตร์") so we
// look for the distinguishing root phrase.
function mapApprovalBody(raw: unknown): string {
  if (typeof raw !== 'string') return 'OTHER';
  if (APPROVAL_BODY_CODES.includes(raw as (typeof APPROVAL_BODY_CODES)[number])) {
    return raw;
  }
  const s = raw.replace(/\s+/g, '');
  if (/คณะกรรมการประจ[ำา]?คณะ/.test(s)) return 'FACULTY_COMMITTEE';
  if (/กลั่นกรองหลักสูตร/.test(s)) return 'UNIVERSITY_SCREENING';
  if (/สภาวิชาการ/.test(s)) return 'ACADEMIC_COUNCIL';
  if (/สภามหาวิทยาลัย/.test(s)) return 'UNIVERSITY_COUNCIL';
  if (/บัณฑิตวิทยาลัย/.test(s)) return 'GRADUATE_SCHOOL';
  return 'OTHER';
}

// Coerce numeric-looking input (stripping Thai whitespace or commas).
const nullableInt = z.preprocess((v) => {
  if (v === null || v === undefined || v === '') return undefined;
  if (typeof v === 'number') return Math.trunc(v);
  if (typeof v === 'string') {
    const n = Number(v.replace(/[\s,]/g, ''));
    return Number.isFinite(n) ? Math.trunc(n) : undefined;
  }
  if (Array.isArray(v)) {
    const nums = v.map(Number).filter(Number.isFinite);
    return nums.length ? Math.max(...nums) : undefined;
  }
  if (typeof v === 'object' && v) {
    const nums = Object.values(v as Record<string, unknown>)
      .map(Number)
      .filter(Number.isFinite);
    return nums.length ? Math.max(...nums) : undefined;
  }
  return undefined;
}, z.number().int().optional());

const ApprovalEntrySchema = z
  .object({
    body: z.preprocess((v) => mapApprovalBody(v), z.enum(APPROVAL_BODY_CODES)),
    meetingNo: z.string().nullable().optional(),
    meetingDate: z.string().nullable().optional(),
    decisionTh: z.string().nullable().optional(),
  })
  .passthrough();

const CurriculumAiPayloadSchema = z
  .object({
    programNameTh: nullableString,
    programNameEn: nullableString,
    facultyNameTh: nullableString,
    departmentNameTh: nullableString,
    level: z.enum(['BACHELOR', 'MASTER', 'DOCTORAL']).nullable().optional(),
    totalCredits: nullableInt,
    durationYears: z.preprocess((v) => {
      if (typeof v === 'string') {
        const n = Number(v);
        return Number.isFinite(n) ? n : undefined;
      }
      return v === null ? undefined : v;
    }, z.number().optional()),
    curriculumYear: nullableInt,
    degreeNameTh: nullableString,
    degreeNameEn: nullableString,
    degreeAbbrTh: nullableString,
    degreeAbbrEn: nullableString,
    majors: nullableStringArray,
    programPlans: nullableStringArray,
    language: z.enum(['TH', 'EN', 'MIXED']).nullable().optional(),
    admissionScope: z
      .enum(['TH_ONLY', 'TH_AND_INTL', 'INTL_ONLY'])
      .nullable()
      .optional(),
    isRevision: z
      .preprocess(
        (v) => (typeof v === 'string' ? /true|yes|1/i.test(v) : v),
        z.boolean().optional(),
      ),
    previousCurriculumYearBE: nullableInt,
    openingYear: nullableInt,
    openingSemester: nullableInt,
    approvalHistory: z.array(ApprovalEntrySchema).default([]),
    careersTh: nullableStringArray,
  })
  .passthrough();

type CurriculumAiPayload = z.infer<typeof CurriculumAiPayloadSchema>;

// Gemini sometimes returns alternative field names (programTh, thaiProgramName,
// abbreviationTh, …) despite explicit schema guidance. Fold every known
// alias into the canonical name.
function normalizeAliases(payload: CurriculumAiPayload): CurriculumAiPayload {
  const extra = payload as Record<string, unknown>;
  const pick = (...keys: string[]): unknown => {
    for (const k of keys) {
      if (extra[k] !== undefined && extra[k] !== null && extra[k] !== '') {
        return extra[k];
      }
    }
    return undefined;
  };
  const str = (v: unknown): string | undefined => toStringLeaf(v);
  return {
    ...payload,
    programNameTh:
      (payload.programNameTh as string | undefined) ??
      str(pick('programTh', 'nameTh', 'thaiProgramName', 'programNameThai')),
    programNameEn:
      (payload.programNameEn as string | undefined) ??
      str(pick('programEn', 'nameEn', 'englishProgramName', 'programNameEnglish')),
    facultyNameTh:
      (payload.facultyNameTh as string | undefined) ??
      str(pick('faculty', 'facultyName', 'facultyTh')),
    departmentNameTh:
      (payload.departmentNameTh as string | undefined) ??
      str(pick('department', 'departmentName', 'departmentTh')),
    degreeNameTh:
      (payload.degreeNameTh as string | undefined) ??
      str(pick('degreeTh', 'fullDegreeTh', 'thaiDegreeName')),
    degreeNameEn:
      (payload.degreeNameEn as string | undefined) ??
      str(pick('degreeEn', 'fullDegreeEn', 'englishDegreeName')),
    degreeAbbrTh:
      (payload.degreeAbbrTh as string | undefined) ??
      str(
        pick(
          'abbrTh',
          'degreeAbbreviationTh',
          'abbreviationTh',
          'degreeAbbrThai',
        ),
      ),
    degreeAbbrEn:
      (payload.degreeAbbrEn as string | undefined) ??
      str(
        pick(
          'abbrEn',
          'degreeAbbreviationEn',
          'abbreviationEn',
          'degreeAbbrEnglish',
        ),
      ),
  };
}

// Clip the text we send to the LLM: take the part most likely to contain
// Section 1 (after the cover/ToC). Pages 3-10 cover the Section-1 header
// reliably; we use the first 12 pages' worth of text capped at ~12kB to
// keep the token bill small — Gemini Flash quote is ~4c per 1M tokens.
// Smaller clip also helps with tokens that confuse the model.
function clipSection1(fullText: string): string {
  // Strip BMP Private-Use-Area glyph substitutions that pdfjs sometimes
  // injects (U+F700..U+F7FF range in particular). They appear as gibberish
  // in the LLM context without adding signal.
  const cleaned = fullText.replace(/[\uE000-\uF8FF]/g, '');
  if (cleaned.length <= 12_000) return cleaned;
  // Anchor on the REAL "หมวดที่ 1" (after TOC): find all matches, skip ones
  // immediately followed by "หมวดที่ 2" within 300 chars (signature of a
  // TOC line enumerating all sections).
  const matches = [...cleaned.matchAll(/หมวดที่\s*1/g)];
  let startIdx = 0;
  for (const m of matches) {
    const after = cleaned.slice(m.index, m.index + 300);
    if (!/หมวดที่\s*2/.test(after)) {
      startIdx = Math.max(0, m.index - 1500);
      break;
    }
  }
  return cleaned.slice(startIdx, startIdx + 12_000);
}

export class CurriculumAiExtractor implements PdfExtractor {
  readonly name = 'Gemini มคอ.2 extractor';
  readonly extractionType = 'CURRICULUM_SPEC' as const;
  readonly appliesTo: readonly PdfSourceCategory[] = ['CURRICULUM'];
  readonly methodVersion = 'gemini-v1';

  // Lazy-instantiate the heuristic so we don't pay its cost on every call.
  private readonly heuristic = new CurriculumHeuristicExtractor();

  async extract(ctx: PdfContext): Promise<ExtractionRecord[]> {
    // Fallback path: no AI provider configured. Delegate to heuristic so
    // intake still produces a row.
    if (!ctx.ai) {
      return this.heuristic.extract(ctx);
    }
    if (!ctx.fullText || ctx.fullText.length < 200) {
      return [
        {
          extractionType: this.extractionType,
          targetEntityType: 'Program',
          payload: {
            programNameTh: ctx.originalFilename.replace(/\.pdf$/i, ''),
          },
          confidence: 0,
          reasoning:
            'No extractable text in PDF (likely scanned). Gemini vision pass would be needed.',
          proposedLinks: [],
        },
      ];
    }

    const clipped = clipSection1(ctx.fullText);

    try {
      const response = await ctx.ai.extractStructured<CurriculumAiPayload>(
        {
          ctx: { module: 'pdf-intake', kind: 'curriculum.extract' },
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            {
              role: 'user',
              content:
                `Filename: ${ctx.originalFilename}\n\n` +
                `--- PDF text (Section 1 slice) ---\n${clipped}\n--- end ---\n\n` +
                `Return ONLY a JSON object matching the schema. No prose, no markdown.`,
            },
          ],
          methodVersion: this.methodVersion,
          // gemini-3-flash-preview handles Thai tone-mark restoration best
          // in tests against มคอ.2 PDFs. Override via AI_CURRICULUM_MODEL
          // (e.g. 'gemini-2.5-flash-lite' for a cheaper run if diacritics
          // aren't critical).
          model:
            process.env.AI_CURRICULUM_MODEL ?? 'gemini-3-flash-preview',
          // 2.5-flash enables "thinking" by default which eats output
          // tokens; give it plenty of headroom. Raise if we see truncated
          // JSON in production — audit log has token counts.
          maxOutputTokens: 8192,
        },
        CurriculumAiPayloadSchema,
      );

      const payload = normalizeAliases(response.parsed);
      // Score confidence by field coverage — separate from the LLM's own
      // self-rated confidence (which isn't returned by Gemini structured
      // output). Matches the heuristic's 10-core-fields scheme.
      const core = [
        payload.programNameTh,
        payload.programNameEn,
        payload.degreeNameTh,
        payload.degreeAbbrTh,
        payload.level,
        payload.totalCredits,
        payload.curriculumYear,
        payload.openingYear,
        payload.approvalHistory && payload.approvalHistory.length >= 3 ? 'ok' : undefined,
        payload.careersTh && payload.careersTh.length > 0 ? 'ok' : undefined,
      ];
      const present = core.filter((v) => v != null && v !== '').length;
      const confidence = Math.min(0.95, present / core.length);

      // Scrub `null` → omit so downstream consumers (widening Zod on apply)
      // see the same shape as the heuristic extractor.
      const cleanPayload: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(payload)) {
        if (v !== null && v !== undefined) cleanPayload[k] = v;
      }
      // courses[] is unused today but keeps payload-schema parity.
      if (!cleanPayload.courses) cleanPayload.courses = [];

      return [
        {
          extractionType: this.extractionType,
          targetEntityType: 'Program',
          payload: cleanPayload,
          confidence,
          reasoning:
            `Gemini ${response.model} extracted ${present}/${core.length} core fields. ` +
            `Tokens: ${response.tokens.input} in / ${response.tokens.output} out. ` +
            `Cost: $${response.cost.usd.toFixed(4)}.`,
          proposedLinks: [],
        },
      ];
    } catch (err) {
      // On ANY LLM/parse failure, fall back to the heuristic so intake
      // still produces a reviewable row. Log reason in the record.
      const msg = err instanceof Error ? err.message : String(err);
      const fallbackRecords = await this.heuristic.extract(ctx);
      return fallbackRecords.map((r) => ({
        ...r,
        reasoning:
          `Gemini extraction failed (${msg}); fell back to heuristic. ` +
          (r.reasoning ?? ''),
      }));
    }
  }
}
