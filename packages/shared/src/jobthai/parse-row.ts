import { createHash } from 'node:crypto';

import { JOBTHAI_COLUMNS, JOBTHAI_DATE_COLUMN } from './columns';

/**
 * Sentinel for a posting that said ทุกสาขา — "any field of study". A real
 * and common category, not an extraction failure. Without an explicit
 * sentinel a naive capture yields a field literally named ทุก, which
 * matches no programme and would silently under-count the 12,831 postings
 * that accept any discipline.
 */
export const JOBTHAI_ANY_FIELD = '*ANY*';

export type JobRequiredEducationLevel =
  | 'UNSPECIFIED'
  | 'VOCATIONAL_CERT'
  | 'HIGHER_VOCATIONAL_CERT'
  | 'BACHELOR'
  | 'MASTER'
  | 'DOCTORATE';

/** The normalised shape every downstream phase consumes. */
export interface NormalisedJobThaiRow {
  title: string;
  jobCategory: string;
  jobSubcategory: string;
  businessType: string;
  province: string;
  descriptionRaw: string;
  qualificationRaw: string;
  requiredFieldsRaw: string[];
  minEducationLevel: JobRequiredEducationLevel;
  /** Set only when the source carries JOBTHAI_DATE_COLUMN. */
  postedDate: Date | null;
  /** SHA-256 over the seven source values — the dedupe key. */
  rowKey: string;
}

// Lowest first: extractMinEducationLevel takes the FIRST match, because
// "ปวช., ปวส.- ปริญญาตรี" means a ปวช holder is acceptable. The floor is
// what the text means; taking the highest would record 12,831
// vocational-accepting postings as requiring a degree.
const LEVELS: Array<[JobRequiredEducationLevel, RegExp]> = [
  ['VOCATIONAL_CERT', /ปวช/],
  ['HIGHER_VOCATIONAL_CERT', /ปวส/],
  ['BACHELOR', /ปริญญาตรี|ป\.ตรี/],
  ['MASTER', /ปริญญาโท/],
  ['DOCTORATE', /ปริญญาเอก/],
];

/**
 * Gender and age requirements are removed, never stored. They appear in
 * 47.5% and 55.3% of postings respectively. They are not skills, and
 * surfacing "employers want women under 30" on a Council-facing surface
 * would be the worst outcome this feature could have.
 *
 * Stripped BEFORE any field-of-study extraction runs, so a stripped phrase
 * cannot leak into a captured field name.
 */
const EXCLUDE_PATTERNS: RegExp[] = [
  /เพศ\s*(ชาย|หญิง|ไม่จำกัด)?/g,
  /อายุ\s*(ไม่เกิน|ตั้งแต่|ระหว่าง)?\s*\d+\s*(-\s*\d+)?\s*ปี?/g,
  /อายุ\s*(ไม่เกิน|ตั้งแต่)?/g,
];

const EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
// Thai mobile/landline with or without separators: 0812345678,
// 081-234-5678, 081 234 5678, 02-123-4567.
const PHONE = /0\d{1,2}[-\s]?\d{3,4}[-\s]?\d{3,4}/g;

/**
 * Social handles — LINE IDs and TikTok accounts used as recruitment
 * channels (`Line : @hr.regen`, `tiktok.com/@lst.logistics`). These are
 * business channels published deliberately in an advert rather than
 * personal data, but they carry zero analytical value and some are
 * individual staff accounts, so they go. Applied AFTER the email pass so a
 * real address is already redacted and cannot be half-matched here.
 */
const HANDLE = /@[A-Za-z0-9._-]{2,}/g;

/** Removes protected-attribute requirements, then redacts contact details. */
export function scrubPostingText(text: string): string {
  let out = text;
  for (const re of EXCLUDE_PATTERNS) out = out.replace(re, ' ');
  out = out
    .replace(EMAIL, '[redacted-email]')
    .replace(PHONE, '[redacted-phone]')
    .replace(HANDLE, '[redacted-handle]');
  return out.replace(/\s{2,}/g, ' ').trim();
}

/**
 * Tokens that survive the split but name no discipline: "other", "other
 * fields", "any one of". Dropped rather than mapped to the any-field
 * sentinel, so "electrical engineering or other fields" keeps the named
 * discipline instead of collapsing to "anything".
 */
const NON_DISCIPLINE = new Set(['อื่น', 'อื่นๆ', 'สาขา', 'ใด', 'ใดๆ', 'ที่เกี่ยวข้อง', 'ตรง']);

/** Terminators that end a field-of-study list in Thai posting prose. */
const FIELD_TERMINATORS = /เท่านั้น|ขึ้นไป|ที่เกี่ยวข้อง|หรือเทียบเท่า|มีประสบการณ์|สามารถ|\(|\)/;

/**
 * Extract fields of study from ONE text field.
 *
 * Must be called per source field, never on a concatenation of
 * qualification + description: the capture is bounded by length rather than
 * by a sentence end, so joining two fields lets prose from the second bleed
 * into a field name captured at the end of the first. That produced
 * "บัญชี จัดทำเอกสารใบแจ้งหนี้ลูกค้า" as a supposed discipline.
 */
export function extractFieldsOfStudy(text: string): string[] {
  if (/ทุกสาขา/.test(text)) return [JOBTHAI_ANY_FIELD];
  const out: string[] = [];
  const re = /สาขา(?:วิชา)?\s*([^\n]{1,120})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const tail = m[1]!.split(FIELD_TERMINATORS)[0] ?? '';
    for (const part of tail.split(/,|、|และ|หรือ|\//)) {
      // Take the first whitespace-delimited token. Thai discipline names in
      // this corpus do not contain spaces (บัญชี, การเงินการธนาคาร,
      // วิศวกรรมไฟฟ้า), whereas trailing prose always does — so this is the
      // boundary the source actually gives us. Verified against the top-30
      // extracted fields over all five real files.
      const f = (part.trim().split(/\s+/)[0] ?? '')
        // Each split part may itself repeat the marker — "สาขาวิศวกรรม
        // หรือสาขาอื่นๆ" splits into two parts that BOTH start with สาขา.
        // Without stripping it here, the literal string "สาขา" was the most
        // frequently "extracted" discipline in the corpus, 7,296 times.
        .replace(/^สาขา(?:วิชา)?/, '')
        .replace(/^วิชา\s*/, '')
        .replace(/[.,]+$/, '')
        .trim();
      if (NON_DISCIPLINE.has(f)) continue;
      // Two characters is the shortest real Thai discipline fragment worth
      // keeping. 30 is the upper bound measured over the corpus: beyond it
      // every capture was prose, not a discipline.
      if (f.length >= 2 && f.length <= 30) out.push(f);
    }
  }
  return [...new Set(out)];
}

export function extractMinEducationLevel(text: string): JobRequiredEducationLevel {
  for (const [level, re] of LEVELS) if (re.test(text)) return level;
  return 'UNSPECIFIED';
}

function str(row: Record<string, unknown>, key: string): string {
  const v = row[key];
  return v === null || v === undefined ? '' : String(v).trim();
}

export function normaliseJobThaiRow(row: Record<string, unknown>): NormalisedJobThaiRow {
  const rawDescription = str(row, 'Job Description (Raw)');
  const rawQualification = str(row, 'Qualification (Raw)');

  // Order matters: scrub first, then extract, so a removed gender or age
  // phrase can never end up inside a field-of-study name.
  const descriptionRaw = scrubPostingText(rawDescription);
  const qualificationRaw = scrubPostingText(rawQualification);
  // Education level may legitimately be read across both fields: it is a
  // keyword test, not a bounded capture, so concatenation is safe there.
  const combined = `${qualificationRaw} ${descriptionRaw}`;
  // Fields of study come from the QUALIFICATION text ONLY.
  //
  // สาขา is polysemous: "field of study" in a requirements list, but
  // "branch" (of a company) in job duties — "ตามที่ได้รับมอบหมายจากสาขา"
  // means "as assigned by the branch". Reading descriptions produced 293
  // captures longer than 40 characters, every one of them prose rather than
  // a discipline. Measured over all five 2026-09 files.
  const fields = extractFieldsOfStudy(qualificationRaw);
  // A single any-field sentinel wins: "any discipline" plus a named one is a
  // contradiction, and the permissive reading is what the posting means.
  const requiredFieldsRaw = fields.includes(JOBTHAI_ANY_FIELD) ? [JOBTHAI_ANY_FIELD] : fields;

  const dateCell = str(row, JOBTHAI_DATE_COLUMN);
  let postedDate: Date | null = null;
  if (dateCell !== '') {
    const parsed = new Date(dateCell);
    if (!Number.isNaN(parsed.getTime())) postedDate = parsed;
  }

  const rowKey = createHash('sha256')
    .update(JOBTHAI_COLUMNS.map((c) => str(row, c)).join(' '))
    .digest('hex');

  return {
    title: str(row, 'Job Title'),
    jobCategory: str(row, 'Job Category (ประเภทงานหลัก)'),
    jobSubcategory: str(row, 'Job Subcategory (ประเภทงานย่อย)'),
    businessType: str(row, 'Business (ประเภทธุรกิจ)'),
    province: str(row, 'Province'),
    descriptionRaw,
    qualificationRaw,
    requiredFieldsRaw,
    minEducationLevel: extractMinEducationLevel(combined),
    postedDate,
    rowKey,
  };
}
