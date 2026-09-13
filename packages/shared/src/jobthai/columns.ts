/**
 * The seven columns every JobThai drop carries, in source order.
 *
 * Validation compares an uploaded sheet against this list and names what is
 * missing, so an operator learns which column is absent at upload time
 * instead of watching a parse die on row 4,000.
 */
export const JOBTHAI_COLUMNS = [
  'Job Title',
  'Job Category (ประเภทงานหลัก)',
  'Job Subcategory (ประเภทงานย่อย)',
  'Business (ประเภทธุรกิจ)',
  'Province',
  'Job Description (Raw)',
  'Qualification (Raw)',
] as const;

export type JobThaiColumn = (typeof JOBTHAI_COLUMNS)[number];

/**
 * Optional. Absent from the 2026-09 drop, which is why every posting's
 * `postedDate` currently falls back to its batch receipt date with
 * `postedDateEstimated = true`. JobThai can supply it; the parser accepts it
 * the moment they do, so no migration is needed later.
 */
export const JOBTHAI_DATE_COLUMN = 'Posted Date';
